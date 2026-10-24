// El catalogo cuando Shopify no responde.
//
// POR QUE ESTE TEST EXISTE: desde el 28/10/2026 las tiendas de Shopify estan
// suspendidas. /api/shopify/products devolvia error y Upsell, el selector de
// productos de Leads y Finanzas -> Productos se quedaban sin catalogo. El
// respaldo (shopify_archivo) tiene los mismos productos: tiene que servirlos
// con la misma forma, y con la foto de la copia propia.

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { productosDelRespaldo } from "../lib/catalogo-respaldo";

const AUTOGRIP = {
  id: 8210,
  title: "Autogrip",
  image: { id: 555, src: "https://cdn.shopify.com/autogrip.jpg" },
  variants: [{ id: 1, title: "Default Title", sku: "AUTO-01", price: "19900.00" }],
};
const SHORTS = {
  id: 9001,
  title: "Fat-Burn Shorts",
  image: null,
  variants: [
    { id: 2, title: "Beige / M", sku: "FBS-BM", price: "24900" },
    { id: 3, title: "Café / M", sku: "FBS-CM", price: "24900" },
  ],
};

describe("productos del respaldo", () => {
  it("misma forma que el catálogo en vivo: una opción por variante", () => {
    expect(productosDelRespaldo([SHORTS]).map((p) => p.display_name)).toEqual(["Fat-Burn Shorts - Beige / M", "Fat-Burn Shorts - Café / M"]);
    expect(productosDelRespaldo([AUTOGRIP])[0]).toEqual({
      variant_id: 1,
      product_id: 8210,
      product_title: "Autogrip",
      variant_title: "Default Title",
      display_name: "Autogrip",
      sku: "AUTO-01",
      price: 19900,
      image_url: "https://cdn.shopify.com/autogrip.jpg",
    });
  });
  it("la foto sale de la copia propia si está; si no, la original", () => {
    const fotos = new Map([["555", "https://supabase/firmada/autogrip.jpg"]]);
    expect(productosDelRespaldo([AUTOGRIP], fotos)[0].image_url).toBe("https://supabase/firmada/autogrip.jpg");
    expect(productosDelRespaldo([SHORTS], fotos)[0].image_url).toBeUndefined();
  });
  it("descarta lo que no tiene id o título", () => {
    expect(productosDelRespaldo([{ title: "Sin id", variants: [{ id: 1 }] }, { id: 5, title: "", variants: [{ id: 1 }] }])).toEqual([]);
  });
});

vi.mock("@/lib/catalogo-respaldo", async (original) => ({
  ...(await original<typeof import("../lib/catalogo-respaldo")>()),
  cargarCatalogoRespaldo: async () => [
    { variant_id: 1, product_id: 8210, product_title: "Autogrip", variant_title: "", display_name: "Autogrip", sku: "AUTO-01", price: 19900 },
  ],
}));

describe("/api/shopify/products cuando Shopify no está", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const pedir = async () => {
    const { GET } = await import("../app/api/shopify/products/route");
    return GET(new NextRequest("http://localhost/api/shopify/products?store=mireva-cr"));
  };

  it("tienda suspendida (402): sirve el catálogo del respaldo", async () => {
    vi.stubEnv("SHOPIFY_CR_SHOP_DOMAIN", "mireva-cr.myshopify.com");
    vi.stubEnv("SHOPIFY_CR_ACCESS_TOKEN", "t");
    vi.stubGlobal("fetch", async () => new Response('{"errors":"Unavailable Shop"}', { status: 402 }));
    const res = await pedir();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ fuente: "respaldo", motivo: "Shopify error 402", store: "mireva-cr" });
    expect(json.products.map((p: { sku: string }) => p.sku)).toEqual(["AUTO-01"]);
  });

  it("sin conexión, igual", async () => {
    vi.stubEnv("SHOPIFY_CR_SHOP_DOMAIN", "mireva-cr.myshopify.com");
    vi.stubEnv("SHOPIFY_CR_ACCESS_TOKEN", "t");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const res = await pedir();
    expect(res.status).toBe(200);
    expect((await res.json()).fuente).toBe("respaldo");
  });

  it("con Shopify funcionando, sigue en vivo", async () => {
    vi.stubEnv("SHOPIFY_CR_SHOP_DOMAIN", "mireva-cr.myshopify.com");
    vi.stubEnv("SHOPIFY_CR_ACCESS_TOKEN", "t");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ products: [AUTOGRIP] }), { status: 200 }));
    const json = await (await pedir()).json();
    expect(json.fuente).toBeUndefined();
    expect(json.products[0].sku).toBe("AUTO-01");
  });
});
