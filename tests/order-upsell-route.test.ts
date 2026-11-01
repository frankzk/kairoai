import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISOS } from "../lib/permisos";
const mocks = vi.hoisted(() => ({
  identity: { permisos: ["pedidos", "pedidos_anular", "leads_crear_pedido", "leads"], staffId: 2 },
  find: vi.fn(), reserve: vi.fn(), lock: vi.fn(), unlock: vi.fn(), resolve: vi.fn(), run: vi.fn(), connection: vi.fn(),
  db: vi.fn(), catalog: vi.fn(), create: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/lib/stores", () => ({ getRequiredStoreFromSearchParams: (p: URLSearchParams) => p.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null }));
vi.mock("@/lib/identidad", () => ({
  identidadActual: () => mocks.identity, sinPermiso: (p: string) => !mocks.identity.permisos.includes(p),
  vendedoraEfectiva: () => mocks.identity.staffId, MENSAJE_SIN_PERMISO: "Sin permiso",
}));
vi.mock("@/lib/db", () => ({ getDB: () => ({ from: mocks.db }) }));
vi.mock("@/lib/icomfly", () => ({ getIcomflyCatalogProduct: mocks.catalog, createManualIcomflyOrder: mocks.create, getIcomflyExternalStoreId: () => 71, getIcomflyOrder: vi.fn(), normalizeIcomflyOrder: vi.fn() }));
vi.mock("@/lib/icomfly-mcp", () => ({ tiendaDeLaConexion: mocks.connection, llamarHerramientaIcomfly: vi.fn() }));
vi.mock("@/lib/order-upsell-db", () => ({ findOrderUpsell: mocks.find, reserveOrderUpsell: mocks.reserve, lockOrderUpsell: mocks.lock, unlockOrderUpsell: mocks.unlock, resolveUpsellOriginal: mocks.resolve, patchOrderUpsell: vi.fn() }));
vi.mock("@/lib/order-upsell", async importOriginal => ({ ...await importOriginal<typeof import("../lib/order-upsell")>(), runUpsellReplacement: mocks.run }));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({ refreshFinanceDatasetCache: mocks.refresh }));
import { GET, POST } from "../app/api/finance/order-upsell/route";
import { sourceFingerprint } from "../lib/order-upsell";

const original = { id: 10, store_id: 71, order_number: "123", status: "Pendiente", total: 100, payment_method: "COD", collection_type: "con_recaudo", collection_value: 100,
  shipping_name: "Cliente prueba", shipping_phone: "50600000000", shipping_address: "Prueba", shipping_city: "San José", shipping_department: "San José",
  items: [{ product_id: 100, product_name: "Original", product_price: 100, quantity: 1 }] };
const receipt = { id: "request", store_id: 1, original_id: "10", original_name: "IC-W23", advisor_id: 2, advisor_name: "Asesora", canal: "llamada", payload: {}, expected: { total: 150, items: [] }, completed_at: null, replacement_name: null, replacement_id: "20" };
function request(body: object, store = "mireva-cr") {
  return new NextRequest(`http://localhost/api/finance/order-upsell?store=${store}`, { method: "POST", body: JSON.stringify({ order_name: "IC-W23", staff_id: 999, canal: "llamada", fingerprint: sourceFingerprint(original), product_id: 200, quantity: 1, price: 50, ...body }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity = { permisos: ["pedidos", "pedidos_anular", "leads_crear_pedido", "leads"], staffId: 2 };
  mocks.find.mockResolvedValue(null); mocks.resolve.mockResolvedValue(structuredClone(original));
  mocks.reserve.mockImplementation(async r => r); mocks.lock.mockResolvedValue("token");
  mocks.run.mockResolvedValue({ complete: false }); mocks.connection.mockResolvedValue({ id: 71 });
  mocks.catalog.mockResolvedValue({ id: 200, store_id: 71, name: "Upsell", price: 50, variants: [] });
  const staffQuery = { select: () => staffQuery, eq: () => staffQuery, maybeSingle: async () => ({ data: { id: 2, name: "Asesora", active: true }, error: null }) };
  mocks.db.mockReturnValue(staffQuery);
});
describe("API de upsell", () => {
  it.each((PERMISOS as readonly string[]).includes("pedidos_anular") ? ["pedidos", "pedidos_anular", "leads_crear_pedido"] : ["pedidos", "leads"])("exige %s antes de tocar Icomfly", async permission => {
    mocks.identity.permisos = mocks.identity.permisos.filter(p => p !== permission);
    expect((await POST(request({}))).status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("bloquea solo lectura y una tienda ajena", async () => {
    mocks.identity.permisos.push("solo_lectura"); expect((await POST(request({}))).status).toBe(403);
    expect((await POST(request({}, "otra"))).status).toBe(400);
  });
  it("no registra un precio visto antes de cambiar el pedido", async () => {
    expect((await POST(request({ fingerprint: "old" }))).status).toBe(409);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("atribuye a la asesora efectiva del servidor, no al ID del navegador", async () => {
    // First read has no receipt. The read after obtaining the lock gets the reserved receipt.
    let saved: unknown;
    mocks.reserve.mockImplementation(async r => { saved = r; return r; });
    mocks.find.mockImplementation(async () => saved ?? null);
    const res = await POST(request({}));
    expect(res.status).toBe(202);
    expect(mocks.reserve.mock.calls[0][0]).toMatchObject({ advisor_id: 2, advisor_name: "Asesora", expected: { total: 150 } });
    expect(mocks.unlock).toHaveBeenCalled();
  });
  it("dos solicitudes simultáneas no ejecutan la misma operación", async () => {
    mocks.find.mockResolvedValue(structuredClone(receipt)); mocks.lock.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(202);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("retoma el recibo guardado aunque el navegador mande otro producto", async () => {
    mocks.find.mockResolvedValue(structuredClone(receipt));
    expect((await POST(request({ product_id: 999 }))).status).toBe(202);
    expect(mocks.catalog).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.run.mock.calls[0][0]).toMatchObject({ replacement_id: "20" });
  });
  it("un recibo completo no llama a Icomfly", async () => {
    mocks.find.mockResolvedValue({ ...receipt, completed_at: "now" });
    const body = await (await POST(request({}))).json();
    expect(body.ok).toBe(true); expect(mocks.lock).not.toHaveBeenCalled(); expect(mocks.connection).not.toHaveBeenCalled();
  });
  it("rechaza un conector de otra tienda antes de cualquier escritura", async () => {
    mocks.find.mockResolvedValue(structuredClone(receipt)); mocks.connection.mockResolvedValue({ id: 72 });
    expect((await POST(request({}))).status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.unlock).toHaveBeenCalled();
  });
  it("el popup recupera el estado pendiente sin releer un original anulado", async () => {
    mocks.find.mockResolvedValue(structuredClone(receipt));
    const res = await GET(new NextRequest("http://localhost/api/finance/order-upsell?store=mireva-cr&order=IC-W23"));
    expect((await res.json()).receipt.replacement_id).toBe("20"); expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
