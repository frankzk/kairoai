// Los couriers y las novedades con las guias de iComfly.
//
// POR QUE ESTE TEST EXISTE: los crons de Moovin, Forza, WYN, c807 y Cargo
// Expreso descubrian las guias nuevas en shopify_orders (y Boxful). Desde el
// 28/10/2026 los pedidos nuevos estan solo en iComfly: sin leer sus guias,
// ningun envio nuevo se rastrearia, no saldrian novedades y los pedidos
// quedarian "en reparto" para siempre. Y una novedad sin el pedido de iComfly
// saldria sin cliente ni telefono: nadie sabria a quien llamar.

import { beforeEach, describe, expect, it, vi } from "vitest";

const tablas: Record<string, unknown[]> = {};
const consultas: Record<string, string[]> = {};

// Cadena de supabase-js simulada: cualquier metodo devuelve la cadena y al
// esperarla responde con las filas de la tabla.
function cadena(tabla: string): unknown {
  const registro: string[] = (consultas[tabla] ??= []);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) =>
            Promise.resolve({ data: tablas[tabla] ?? [], error: null }).then(ok, mal);
        }
        if (prop === "maybeSingle") return async () => ({ data: (tablas[tabla] ?? [])[0] ?? null, error: null });
        return (...args: unknown[]) => {
          registro.push(`${String(prop)}:${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join("|")}`);
          return proxy;
        };
      },
    }
  );
  return proxy;
}

vi.mock("@/lib/db", () => ({ getDB: () => ({ from: (tabla: string) => cadena(tabla) }) }));

// El pedido completo tal como lo selecciona listIcomflyGuides.
const guia = (guide: string, over: Record<string, unknown> = {}) => ({
  guide,
  created_at: "2026-10-29T15:00:00.000Z",
  status: "Guia_Generada",
  full_name: "Ana Mora Solís",
  shipping_name: "Ana Mora",
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  for (const k of Object.keys(consultas)) delete consultas[k];
});

describe("los couriers conocen las guías que solo están en iComfly", () => {
  it("Moovin: la guía entra con el nombre del envío (de ahí saca los apellidos)", async () => {
    tablas.icomfly_order_payloads = [guia("2712707"), guia("2712708", { status: "Cancelado" })];
    const { listMoovinSyncCandidates } = await import("../lib/finance");
    const candidatos = await listMoovinSyncCandidates(50, 30);
    // El nombre del envio: el de la etiqueta que lleva Moovin.
    expect(candidatos).toEqual([{ idPackage: "2712707", lastName: "", fullName: "Ana Mora" }]);
  });

  it("Moovin: si Shopify ya tiene la guía, va una sola vez con los datos de Shopify", async () => {
    tablas.shopify_orders = [{ tracking_number: "2712707", last_name: "Mora", customer_name: "Ana Mora" }];
    tablas.icomfly_order_payloads = [guia("2712707")];
    const { listMoovinSyncCandidates } = await import("../lib/finance");
    expect(await listMoovinSyncCandidates(50, 30)).toEqual([{ idPackage: "2712707", lastName: "Mora", fullName: "Ana Mora" }]);
  });

  it("Forza (Honduras): solo las FD", async () => {
    tablas.icomfly_order_payloads = [guia("FD123456789"), guia("2712707")];
    const { listForzaSyncCandidates } = await import("../lib/finance");
    const r = await listForzaSyncCandidates(2, { limit: 50, freshWindowMinutes: 30, discoveryDays: 60 });
    expect(r).toEqual(["FD123456789"]);
  });

  it("WYN: las MLCR", async () => {
    tablas.icomfly_order_payloads = [guia("MLCR0001234"), guia("2712707")];
    const { listWynSyncCandidates } = await import("../lib/finance");
    expect(await listWynSyncCandidates(50, 30, 1)).toEqual(["MLCR0001234"]);
  });

  it("Cargo Expreso (Honduras): con su formato", async () => {
    tablas.icomfly_order_payloads = [guia("bh000123456-1"), guia("FD123456789")];
    const { listShipmentSyncCandidates } = await import("../lib/finance");
    const r = await listShipmentSyncCandidates(2, "cargoexpreso", { limit: 50, freshWindowMinutes: 30, discoveryDays: 60 });
    expect(r).toEqual(["BH000123456-1"]);
  });

  it("lee solo pedidos con guía desde la fecha pedida, de la tienda pedida", async () => {
    tablas.icomfly_order_payloads = [];
    const { listIcomflyGuides } = await import("../lib/finance");
    await listIcomflyGuides(2, "2026-10-05");
    expect(consultas.icomfly_order_payloads).toEqual(
      expect.arrayContaining(["eq:store_id|2", "gte:payload->>created_at|2026-10-05", "neq:payload->>tracking_number|"])
    );
  });
});

describe("las novedades saben de quién es el envío", () => {
  it("una guía que solo está en iComfly trae cliente, teléfono, pedido y monto", async () => {
    tablas.shopify_orders = [];
    tablas.icomfly_order_payloads = [
      {
        id: "730001",
        order_number: "56900",
        status: "En_Reparto",
        created_at: "2026-10-29T15:00:00.000Z",
        total: "13930.00",
        customer: { fullName: "Ana Mora", phone: "+50688887777" },
        items: [{ product_name: "Antena TV", quantity: 1, product_price: 13930 }],
        tracking_number: "2712707",
      },
    ];
    const { loadShopifyByGuide } = await import("../lib/incidents-run");
    const pedido = (await loadShopifyByGuide(1)).get("2712707");
    expect(pedido).toMatchObject({ name: "IC-56900", customer_name: "Ana Mora", phone: "+50688887777", total_price: 13930 });
  });
});
