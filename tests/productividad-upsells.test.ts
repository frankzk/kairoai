import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ calls: [] as Array<[string, ...unknown[]]>, pages: [] as Array<{ data: unknown[] | null; error: unknown }>, attribution: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDB: () => {
    const chain: unknown = new Proxy({}, { get: (_, name) => {
      if (name === "then") return (resolve: (r: unknown) => unknown) => Promise.resolve(mocks.pages.shift() ?? { data: [], error: null }).then(resolve);
      return (...args: unknown[]) => { mocks.calls.push([String(name), ...args]); return chain; };
    } });
    return chain;
  },
}));
vi.mock("@/lib/finance", () => ({ listAtribucionDespacho: mocks.attribution }));
vi.mock("@/lib/identidad", () => ({ tiendasPermitidas: () => ["mireva-cr", "mireva-hn"] }));
import { listUpsellsCompletados } from "../lib/productividad-upsells-db";
import { GET } from "../app/api/finance/productividad/route";

const from = "2026-10-23T06:00:00.000Z", to = "2026-10-24T06:00:00.000Z";
beforeEach(() => {
  mocks.calls.length = 0; mocks.pages.length = 0;
  mocks.attribution.mockReset(); mocks.attribution.mockResolvedValue([]);
});
describe("lectura de upsells", () => {
  it("lee solo la tienda y las fechas de cierre solicitadas, sin datos del cliente", async () => {
    await listUpsellsCompletados(2, from, to);
    expect(mocks.calls).toEqual(expect.arrayContaining([
      ["from", "order_upsell_replacements"], ["select", "id,advisor_name,completed_at"], ["eq", "store_id", 2],
      ["gte", "completed_at", from], ["lt", "completed_at", to], ["range", 0, 999],
    ]));
  });
  it("pagina más de mil cierres con un orden estable", async () => {
    const page = Array.from({ length: 1000 }, (_, id) => ({ id: String(id), advisor_name: "Asesora", completed_at: from }));
    mocks.pages.push({ data: page, error: null }, { data: [{ ...page[0], id: "1000" }], error: null });
    expect(await listUpsellsCompletados(1, from, to)).toHaveLength(1001);
    expect(mocks.calls).toContainEqual(["range", 1000, 1999]);
    expect(mocks.calls).toContainEqual(["order", "id", { ascending: true }]);
  });
  it("un fallo de consulta no se presenta como cero ventas", async () => {
    mocks.pages.push({ data: null, error: { message: "unavailable" } });
    await expect(listUpsellsCompletados(1, from, to)).rejects.toThrow(/upsells completados/);
  });
});
describe("productividad con upsells", () => {
  it("usa el mismo periodo local que el resto del popup e incluye asesoras que solo cerraron upsells", async () => {
    mocks.pages.push({ data: [{ id: "1", advisor_name: "Leonor", completed_at: "2026-10-24T05:30:00Z" }], error: null });
    const response = await GET(new NextRequest("http://localhost/api/finance/productividad?store=mireva-cr&from=2026-10-23&to=2026-10-23"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ from, to, upsells: 1, personas: [{ nombre: "Leonor", despachados: 0, confirmados: 0, upsells: 1 }] });
    expect(mocks.attribution).toHaveBeenCalledWith(1, from, to);
    expect(mocks.calls).toContainEqual(["gte", "completed_at", from]);
  });
  it("un rango inválido y una tienda ausente se rechazan antes de consultar", async () => {
    expect((await GET(new NextRequest("http://localhost/api/finance/productividad?store=mireva-cr&from=2026-10-24&to=2026-10-23"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/finance/productividad?range=hoy"))).status).toBe(400);
    expect(mocks.calls).toEqual([]); expect(mocks.attribution).not.toHaveBeenCalled();
  });
});
