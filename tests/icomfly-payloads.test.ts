// El pedido completo de iComfly (migracion 0050).
//
// POR QUE ESTE TEST EXISTE: desde el 28/10/2026 la venta sigue por las paginas
// de iComfly y Kairo necesita el pedido entero (cliente, productos, total), no
// solo el despacho. Si el crudo quedara emparejado con el id equivocado, un
// cliente quedaria con los productos de otro. Y guardarlo nunca puede romper el
// sync de despacho que ya funciona.
//
// Y si iComfly contesta con pedidos de OTRA tienda (Honduras recibio los de
// Costa Rica desde julio porque la API responde con la tienda que el usuario
// ve), no se guardan y el cron lo marca como error.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { deLaTienda, filasDePayload } from "../lib/icomfly-payloads";
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
let paginas = 0;
vi.mock("@/lib/icomfly", () => ({
  credencialIcomfly: () => ({ origen: "ICOMFLY_TOKEN" }),
  // Costa Rica es la tienda 71 de iComfly; Honduras, otra.
  resolveIcomflyStoreContext: (opts: { store?: string }) =>
    opts.store === "mireva-hn"
      ? { store: { id: 2, code: "mireva-hn" }, externalStoreId: 99 }
      : { store: { id: 1, code: "mireva-cr" }, externalStoreId: 71 },
  listAgents: async () => [],
  // La API responde siempre con Costa Rica, como hace en produccion. Siempre
  // dice que hay mas paginas.
  listOrdersWithAttribution: async () => {
    paginas += 1;
    return {
      orders: [pedido("A"), pedido("B")],
      raw: [
        { id: "A", store_id: 71, store_name: "Mireva Costa Rica" },
        { id: "B", store_id: "71", store_name: "Mireva Costa Rica" },
      ],
      hasMore: paginas < 2,
    };
  },
}));

describe("el sync de iComfly", () => {
  beforeEach(() => {
    llamadas.length = 0;
    fallaPayloads = false;
    paginas = 0;
  });
  it("guarda el despacho y después el pedido completo", async () => {
    const { runIcomflySync } = await import("../lib/icomfly-sync");
    const res = await runIcomflySync({ store: "mireva-cr" });
    expect(res.synced).toBe(2);
    expect(res.otra_tienda).toBe(0);
    expect(llamadas).toEqual(["despacho:2", "completo:2"]);
  });
  it("un pedido que sale en dos páginas se guarda una sola vez", async () => {
    // Postgres rechaza el upsert entero si la misma llave viene dos veces.
    const { runIcomflySync } = await import("../lib/icomfly-sync");
    const res = await runIcomflySync({ store: "mireva-cr" });
    expect(res.pages_fetched).toBe(2);
    expect(llamadas).toEqual(["despacho:2", "completo:2"]);
  });
  it("si guardar el pedido completo falla, el sync de despacho sigue igual", async () => {
    fallaPayloads = true;
    const { runIcomflySync } = await import("../lib/icomfly-sync");
    await expect(runIcomflySync({ store: "mireva-cr" })).resolves.toMatchObject({ synced: 2 });
    expect(llamadas).toEqual(["despacho:2", "completo:2"]);
  });
  it("la página siguiente es la que viene después de la última leída", async () => {
    // El historial reanuda desde next_page: antes se salteaba una.
    const { runIcomflySync } = await import("../lib/icomfly-sync");
    const res = await runIcomflySync({ store: "mireva-cr", maxPages: 1 });
    expect(res).toMatchObject({ pages_fetched: 1, has_more: true, next_page: 2 });
  });
  it("los pedidos de otra tienda no se guardan, y no sigue paginando", async () => {
    const { runIcomflySync } = await import("../lib/icomfly-sync");
    const res = await runIcomflySync({ store: "mireva-hn" });
    expect(res).toMatchObject({
      synced: 0,
      otra_tienda: 2,
      pages_fetched: 1,
      tiendas_ajenas: ["71 (Mireva Costa Rica)"],
      credencial: "ICOMFLY_TOKEN",
    });
    expect(llamadas).toEqual(["despacho:0", "completo:0"]);
  });
});

describe("filtrar por tienda", () => {
  it("queda lo de la tienda pedida, venga el id como número o texto", () => {
    const p = deLaTienda(71, [pedido("A"), pedido("B"), pedido("C")], [{ store_id: 71 }, { store_id: "71" }, { store_id: 72, store_name: "Mireva Honduras" }]);
    expect(p.orders.map((o) => o.icomflyOrderId)).toEqual(["A", "B"]);
    expect(p.raw).toEqual([{ store_id: 71 }, { store_id: "71" }]);
    expect(p).toMatchObject({ ajenos: 1, tiendasAjenas: ["72 (Mireva Honduras)"] });
  });
  it("lo que no dice de qué tienda es se acepta", () => {
    const p = deLaTienda(71, [pedido("A"), pedido("B")], [{ id: "A" }, { store_id: "" }]);
    expect(p.orders).toHaveLength(2);
    expect(p.ajenos).toBe(0);
  });
});

describe("el cron marca el error", () => {
  const limpio = { synced: 4, otra_tienda: 0, tiendas_ajenas: [] };
  it("dice qué tienda recibió pedidos ajenos y de dónde", async () => {
    const { errorDeTienda } = await import("../lib/icomfly-sync");
    const error = errorDeTienda([
      { store: "mireva-cr", result: limpio as never },
      { store: "mireva-hn", result: { synced: 0, otra_tienda: 100, tiendas_ajenas: ["71 (Mireva Costa Rica)"], credencial: "ICOMFLY_TOKEN" } as never },
    ]);
    expect(error).toContain("mireva-hn: iComfly devolvió 100 pedidos de la tienda 71 (Mireva Costa Rica) y se descartaron (clave: ICOMFLY_TOKEN)");
    expect(error).not.toContain("mireva-cr");
  });
  it("si todo vino de su tienda, no hay error", async () => {
    const { errorDeTienda } = await import("../lib/icomfly-sync");
    expect(errorDeTienda([{ store: "mireva-cr", result: limpio as never }])).toBeNull();
  });
});
