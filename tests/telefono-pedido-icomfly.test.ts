// Telefono de un pedido de iComfly para el boton "Llamar" de Gestion.
//
// POR QUE ESTE TEST EXISTE: desde el 28/10/2026 Shopify esta cerrado y los
// pedidos nuevos solo existen en iComfly. "Llamar" buscaba el telefono solo en
// shopify_orders y decia que el pedido no tenia telefono. El nombre que ve la
// asesora (IC-W409, IC-<numero>) tiene que llevar al pedido correcto de ESA
// tienda.

import { beforeEach, describe, expect, it, vi } from "vitest";

const consultas: Array<{ tabla: string; eq: Array<[string, unknown]>; or: string | null }> = [];
let respuesta: Record<string, Record<string, unknown>[]> = {};

vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (tabla: string) => {
      const q = { tabla, eq: [] as Array<[string, unknown]>, or: null as string | null };
      consultas.push(q);
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (c: string, v: unknown) => (q.eq.push([c, v]), api),
        or: (f: string) => ((q.or = f), api),
        limit: () => api,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: respuesta[tabla] ?? [], error: null }).then(ok),
      };
      return api;
    },
  }),
}));

beforeEach(() => {
  consultas.length = 0;
  respuesta = {};
});

describe("telefono de un pedido de iComfly", () => {
  it("IC-W409 busca la secuencia web en la tienda", async () => {
    const { getIcomflyOrderPhone } = await import("../lib/zadarma-calls");
    respuesta.icomfly_order_payloads = [{ customer_phone: "50661204473", shipping_name: "Ana" }];
    expect(await getIcomflyOrderPhone(1, "IC-W409")).toEqual({ phone: "50661204473", customerName: "Ana" });
    expect(consultas[0]).toMatchObject({ tabla: "icomfly_order_payloads", eq: [["store_id", 1]], or: "payload->>store_web_seq.eq.409" });
  });

  it("IC-<numero> busca por id y por numero de pedido (con y sin #)", async () => {
    const { getIcomflyOrderPhone } = await import("../lib/zadarma-calls");
    respuesta.icomfly_order_payloads = [{ customer_phone: null, shipping_phone: "50498584179" }];
    expect((await getIcomflyOrderPhone(2, "IC-1793512711338041858"))?.phone).toBe("50498584179");
    expect(consultas[0].or).toBe(
      "icomfly_order_id.eq.1793512711338041858,payload->>order_number.eq.1793512711338041858,payload->>order_number.eq.#1793512711338041858"
    );
  });

  it("Gestion: si no esta en Shopify, lo busca en iComfly", async () => {
    const { getOrderPhone } = await import("../lib/zadarma-calls");
    respuesta.icomfly_order_payloads = [{ customer_phone: "50663968153", shipping_name: "Luis" }];
    expect(await getOrderPhone(1, "IC-W407")).toEqual({ phone: "50663968153", customerName: "Luis" });
    expect(consultas.map((c) => c.tabla)).toEqual(["shopify_orders", "icomfly_order_payloads"]);
  });

  it("un nombre raro no llega al filtro", async () => {
    const { getIcomflyOrderPhone } = await import("../lib/zadarma-calls");
    expect(await getIcomflyOrderPhone(1, "IC-1,store_id.eq.2")).toBeNull();
    expect(consultas).toEqual([]);
  });
});
