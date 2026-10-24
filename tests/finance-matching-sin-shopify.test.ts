// Importar liquidaciones o logistica cuando Shopify no responde.
//
// POR QUE ESTE TEST EXISTE: al importar, el emparejamiento le pide a Shopify
// los pedidos mas nuevos que la base. Desde el 28/10/2026 las tiendas de
// Shopify estan suspendidas: si esa consulta tumbara o colgara la importacion,
// no se podria cargar ninguna liquidacion aunque los pedidos esten guardados.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadShopifyOrdersForMatching } from "../lib/finance-matching";

const GUARDADO = {
  shopify_order_id: 6123,
  order_number: 26800,
  name: "#MCRC26800",
  financial_status: "pending",
  fulfillment_status: null,
  cancelled_at: null,
  total_price: "19900",
  shopify_created_at: "2026-10-20T10:00:00Z",
  shopify_updated_at: "2026-10-21T10:00:00Z",
  line_items: [],
  note: "",
  note_attributes: [],
};

vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ range: async () => ({ data: [GUARDADO], error: null }) }) }),
      }),
    }),
  }),
}));

describe("emparejar sin Shopify", () => {
  beforeEach(() => {
    process.env.SHOPIFY_CR_SHOP_DOMAIN = "mireva-cr.myshopify.com";
    process.env.SHOPIFY_CR_ACCESS_TOKEN = "token-de-prueba";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("si Shopify contesta con error (tienda suspendida), usa lo guardado", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"errors":"Unavailable Shop"}', { status: 402 }));
    const pedidos = await loadShopifyOrdersForMatching(null, 1);
    expect(pedidos.map((p) => p.name)).toEqual(["#MCRC26800"]);
  });

  it("si la conexión falla, no tumba la importación", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const pedidos = await loadShopifyOrdersForMatching(null, 1);
    expect(pedidos.map((p) => p.name)).toEqual(["#MCRC26800"]);
  });

  it("si Shopify no contesta, deja de esperarlo", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const promesa = loadShopifyOrdersForMatching(null, 1);
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(promesa).resolves.toHaveLength(1);
  });
});
