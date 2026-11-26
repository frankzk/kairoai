// La lectura completa de shopify_orders se guarda en memoria 6 horas.
//
// POR QUE: Shopify cerró el 28/10/2026 y la tabla no cambia desde el 04/11,
// pero el dataset de Gestión y Novedades la releían entera cada vez (~2.000
// lecturas de 1.000 filas en las 3 horas antes de que la base dejara de
// responder el 25/11/2026).
import { beforeEach, describe, expect, it, vi } from "vitest";

const leidas: string[] = [];
let falla = false;
vi.mock("@/lib/db", () => {
  const cadena = (tabla: string): unknown => {
    const api: Record<string, unknown> = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") {
            leidas.push(tabla);
            const result = falla
              ? { data: null, error: { message: "Supabase no responde" } }
              : { data: [{ id: 3, name: "#MCRC3" }, { id: 2, name: "#MCRC2" }], error: null };
            return (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
          }
          return () => api;
        },
      },
    );
    return api;
  };
  return { getDB: () => ({ from: (t: string) => cadena(t) }) };
});

beforeEach(async () => {
  leidas.length = 0;
  falla = false;
  const { clearPersistedShopifyOrdersCache } = await import("../lib/finance");
  clearPersistedShopifyOrdersCache();
});

describe("lectura completa de pedidos de Shopify", () => {
  it("la segunda lectura completa de la misma tienda no vuelve a la base", async () => {
    const { listPersistedShopifyOrders } = await import("../lib/finance");
    const a = await listPersistedShopifyOrders(100_000, 0, 1);
    const b = await listPersistedShopifyOrders(100_000, 0, 1);
    expect(b).toEqual(a);
    expect(a).toHaveLength(2);
    expect(leidas).toEqual(["shopify_orders"]);
  });

  it("otra tienda se lee aparte", async () => {
    const { listPersistedShopifyOrders } = await import("../lib/finance");
    await listPersistedShopifyOrders(100_000, 0, 1);
    await listPersistedShopifyOrders(100_000, 0, 2);
    expect(leidas).toHaveLength(2);
  });

  it("una página suelta (offset) siempre va a la base", async () => {
    const { listPersistedShopifyOrders } = await import("../lib/finance");
    await listPersistedShopifyOrders(50, 100, 1);
    await listPersistedShopifyOrders(50, 100, 1);
    expect(leidas).toHaveLength(2);
  });

  it("una lectura que falló no se guarda", async () => {
    const { listPersistedShopifyOrders } = await import("../lib/finance");
    falla = true;
    await expect(listPersistedShopifyOrders(100_000, 0, 1)).rejects.toThrow();
    falla = false;
    await expect(listPersistedShopifyOrders(100_000, 0, 1)).resolves.toHaveLength(2);
    expect(leidas).toHaveLength(2);
  });
});
