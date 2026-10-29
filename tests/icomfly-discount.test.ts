import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpectedIcomflyOrder } from "../lib/icomfly-manual-order";

const state = vi.hoisted(() => ({
  order: {} as Record<string, unknown>, writes: [] as Array<{ name: string; args: Record<string, unknown> }>,
  store: 71 as number | null, catalogMatches: true, loseUpdateResponse: false, ignoreUpdate: false,
}));
vi.mock("@/lib/icomfly", () => ({ getIcomflyExternalStoreId: () => 71 }));
vi.mock("@/lib/icomfly-confirmation", () => ({
  verifyCreatedIcomflyOrder: async (_store: string, _id: string, expected: ExpectedIcomflyOrder) =>
    state.catalogMatches && Number(state.order.total) === expected.total ? { orderNumber: state.order.order_number } : null,
}));
vi.mock("@/lib/icomfly-mcp", () => ({
  tiendaDeLaConexion: async () => ({ id: state.store }),
  llamarHerramientaIcomfly: async (_store: string, name: string, args: Record<string, unknown>) => {
    if (name === "detalle_pedido") return { pedido: { ...state.order } };
    state.writes.push({ name, args });
    if (name === "actualizar_pedido") {
      if (!state.ignoreUpdate) state.order.total = args.total;
      if (state.loseUpdateResponse) { state.loseUpdateResponse = false; throw new Error("timeout después de guardar"); }
    } else if (name === "definir_tipo_recaudo") {
      state.order.tipo_recaudo = "con_recaudo";
      state.order.valor_a_recaudar = state.order.total;
    } else throw new Error("Escritura no permitida en este flujo: " + name);
    return { ok: true };
  },
}));
import { ensureManualOrderDiscount } from "../lib/icomfly-discount";

const expected: ExpectedIcomflyOrder = {
  items: [{ product_id: 1561, variant_id: null, quantity: 1 }, { product_id: 3595, variant_id: null, quantity: 1 }],
  total: 33830, discount_adjustment: { subtotal: 39800, order_number: "MANUAL-KAIRO-test", cod: true },
};
beforeEach(() => {
  state.order = { id: 792305, order_number: "MANUAL-KAIRO-test", status: "Pendiente", total: "39800.00", tipo_recaudo: "con_recaudo", valor_a_recaudar: "39800.00" };
  state.writes = []; state.store = 71; state.catalogMatches = true; state.loseUpdateResponse = false; state.ignoreUpdate = false;
});
describe("Descuento ignorado por la creación nativa de un carrito", () => {
  it("corrige el total recalculado y el COD antes de permitir la verificación final", async () => {
    await ensureManualOrderDiscount("mireva-cr", "792305", expected);
    expect(state.order).toMatchObject({ total: 33830, valor_a_recaudar: 33830 });
    expect(state.writes).toEqual([
      { name: "actualizar_pedido", args: { order_id: 792305, total: 33830 } },
      { name: "definir_tipo_recaudo", args: { order_id: 792305, tipo_recaudo: "contra_entrega" } },
    ]);
    await ensureManualOrderDiscount("mireva-cr", "792305", expected);
    expect(state.writes).toHaveLength(2);
  });
  it("recupera un timeout después de guardar sin crear otro pedido ni aplicar dos descuentos", async () => {
    state.loseUpdateResponse = true;
    await expect(ensureManualOrderDiscount("mireva-cr", "792305", expected)).rejects.toThrow("timeout");
    await ensureManualOrderDiscount("mireva-cr", "792305", expected);
    expect(state.writes.filter(w => w.name === "actualizar_pedido")).toHaveLength(1);
    expect(state.order.valor_a_recaudar).toBe(33830);
  });
  it.each([
    { status: "Confirmada" }, { status: "Enviada" }, { tracking_number: "123" },
    { carrier_name: "Moovin" }, { total: 35000 }, { tipo_recaudo: "sin_recaudo" }, { id: 999 },
  ])("no sobrescribe pedidos modificados, enviados o cobrados: %j", async change => {
    Object.assign(state.order, change);
    await expect(ensureManualOrderDiscount("mireva-cr", "792305", expected)).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
  it.each([null, 90])("rechaza tienda desconocida o cruzada: %s", async store => {
    state.store = store;
    await expect(ensureManualOrderDiscount("mireva-cr", "792305", expected)).rejects.toThrow(/tienda/);
    expect(state.writes).toEqual([]);
  });
  it("requiere todos los productos del intento original", async () => {
    state.catalogMatches = false;
    await expect(ensureManualOrderDiscount("mireva-cr", "792305", expected)).rejects.toThrow(/coincide/);
    expect(state.writes).toEqual([]);
  });
  it("no confirma el importe si iComfly ignora también la actualización", async () => {
    state.ignoreUpdate = true;
    await expect(ensureManualOrderDiscount("mireva-cr", "792305", expected)).rejects.toThrow(/todavía/);
  });
  it("corrige una transferencia sin marcarla pagada ni cambiar el recaudo", async () => {
    await ensureManualOrderDiscount("mireva-cr", "792305", { ...expected, discount_adjustment: { ...expected.discount_adjustment!, cod: false } });
    expect(state.writes.map(w => w.name)).toEqual(["actualizar_pedido"]);
  });
  it("no intenta modificar recibos antiguos sin la autorización financiera guardada", async () => {
    await ensureManualOrderDiscount("mireva-cr", "792305", { items: expected.items, total: 33830 });
    expect(state.writes).toEqual([]);
  });
});
