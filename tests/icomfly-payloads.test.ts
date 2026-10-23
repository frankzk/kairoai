// El pedido completo de iComfly (migracion 0050).
//
// POR QUE ESTE TEST EXISTE: desde el 28/10/2026 la venta sigue por las paginas
// de iComfly y Kairo necesita el pedido entero (cliente, productos, total), no
// solo el despacho. Si el crudo quedara emparejado con el id equivocado, un
// cliente quedaria con los productos de otro. Y guardarlo nunca puede romper el
// sync de despacho que ya funciona.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { filasDePayload } from "../lib/icomfly-payloads";
import type { NormalizedIcomflyOrder } from "../lib/dispatch";

const pedido = (id: string): NormalizedIcomflyOrder => ({
  storeId: 1,
  icomflyOrderId: id,
  orderNumber: id,
  shopifyDisplayNumber: "",
  status: "",
  carrierName: "",
  trackingNumber: "",
  shippedAt: null,
  createdAt: null,
  attribution: {},
});

describe("emparejar el pedido crudo con su id", () => {
  it("cada crudo va con el pedido de su misma posición", () => {
    const filas = filasDePayload(1, [pedido("A"), pedido("B")], [{ id: "A", cliente: "Ana" }, { id: "B", cliente: "Beto" }]);
    expect(filas).toEqual([
      { store_id: 1, icomfly_order_id: "A", payload: { id: "A", cliente: "Ana" } },
      { store_id: 1, icomfly_order_id: "B", payload: { id: "B", cliente: "Beto" } },
    ]);
  });
  it("descarta lo que no tiene id o no es un objeto", () => {
    const filas = filasDePayload(1, [pedido(""), pedido("B"), pedido("C")], [{ x: 1 }, null, [1, 2]]);
    expect(filas).toEqual([]);
  });
  it("si un pedido aparece dos veces, queda la última versión vista", () => {
    const filas = filasDePayload(1, [pedido("A"), pedido("A")], [{ v: 1 }, { v: 2 }]);
    expect(filas).toEqual([{ store_id: 1, icomfly_order_id: "A", payload: { v: 2 } }]);
  });
});

// ── El sync de despacho no se entera si el pedido completo falla ─────────────

const llamadas: string[] = [];
let fallaPayloads = false;

vi.mock("@/lib/finance", () => ({
  listPayrollStaff: async () => [],
  getDispatchedBoxfulKeys: async () => new Set<string>(),
  upsertIcomflyAgents: async () => {},
  updatePayrollStaffIcomfly: async () => {},
  upsertIcomflyOrders: async (rows: unknown[]) => {
    llamadas.push(`despacho:${rows.length}`);
  },
  upsertIcomflyOrderPayloads: async (rows: unknown[]) => {
    llamadas.push(`completo:${rows.length}`);
    if (fallaPayloads) throw new Error("tabla nueva caida");
  },
}));
vi.mock("@/lib/icomfly", () => ({
  resolveIcomflyStoreContext: () => ({ store: { id: 1, code: "mireva-cr" }, externalStoreId: 71 }),
  listAgents: async () => [],
  listOrdersWithAttribution: async () => ({
    orders: [pedido("A"), pedido("B")],
    raw: [{ id: "A" }, { id: "B" }],
    hasMore: false,
  }),
}));

describe("el sync de iComfly", () => {
  beforeEach(() => {
    llamadas.length = 0;
    fallaPayloads = false;
  });
  it("guarda el despacho y después el pedido completo", async () => {
    const { runIcomflySync } = await import("../lib/icomfly-sync");
    const res = await runIcomflySync({ store: "mireva-cr" });
    expect(res.synced).toBe(2);
    expect(llamadas).toEqual(["despacho:2", "completo:2"]);
  });
  it("si guardar el pedido completo falla, el sync de despacho sigue igual", async () => {
    fallaPayloads = true;
    const { runIcomflySync } = await import("../lib/icomfly-sync");
    await expect(runIcomflySync({ store: "mireva-cr" })).resolves.toMatchObject({ synced: 2 });
    expect(llamadas).toEqual(["despacho:2", "completo:2"]);
  });
});
