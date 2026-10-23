// Respaldo completo de Shopify antes de que se suspendan las tiendas (28/10/2026).
//
// POR QUE ESTE TEST EXISTE: el respaldo es lo unico que queda despues del 28.
// Si la URL pidiera `fields=` volveria a guardar un recorte; si la paginacion se
// cortara, faltarian pedidos sin que nadie lo note; y si las fotos se bajaran de
// cualquier URL, el servidor pediria lo que un payload raro le dijera.

import { describe, expect, it } from "vitest";
import {
  esUrlDeImagenShopify,
  filasArchivo,
  imagenesDeProducto,
  rutaImagen,
  siguienteUrl,
  urlArchivo,
} from "../lib/shopify-archivo";

const SHOP = "mireva-cr.myshopify.com";

describe("URL del Admin API", () => {
  it("pide el objeto completo: sin `fields`", () => {
    for (const recurso of ["order", "customer", "product"] as const) {
      const url = new URL(urlArchivo(recurso, SHOP));
      expect(url.searchParams.has("fields")).toBe(false);
      expect(url.searchParams.get("limit")).toBe("250");
      expect(url.host).toBe(SHOP);
      expect(url.pathname.startsWith("/admin/api/")).toBe(true);
    }
  });
  it("los pedidos incluyen anulados y cerrados", () => {
    expect(new URL(urlArchivo("order", SHOP)).searchParams.get("status")).toBe("any");
    expect(new URL(urlArchivo("product", SHOP)).searchParams.has("status")).toBe(false);
  });
  it("en modo incremental trae solo lo que cambió", () => {
    const url = new URL(urlArchivo("order", SHOP, "2026-10-23T10:00:00.000Z"));
    expect(url.searchParams.get("updated_at_min")).toBe("2026-10-23T10:00:00.000Z");
    expect(new URL(urlArchivo("order", SHOP)).searchParams.has("updated_at_min")).toBe(false);
  });
});

describe("paginación", () => {
  it("sigue el rel=next del header Link y para cuando no hay", () => {
    const next = `https://${SHOP}/admin/api/2024-01/orders.json?limit=250&page_info=abc`;
    expect(siguienteUrl(`<https://${SHOP}/admin/api/2024-01/orders.json?page_info=zzz>; rel="previous", <${next}>; rel="next"`)).toBe(next);
    expect(siguienteUrl(`<https://${SHOP}/x>; rel="previous"`)).toBeNull();
    expect(siguienteUrl(null)).toBeNull();
  });
});

describe("filas", () => {
  it("guarda el objeto entero, con su id y su fecha de cambio", () => {
    const pedido = { id: 6123, name: "#MCRC1", discount_codes: [{ code: "X" }], refunds: [], updated_at: "2026-10-20T10:00:00-06:00" };
    const [fila] = filasArchivo("order", [pedido, { name: "sin id" }], 1, new Date("2026-10-23T00:00:00Z"));
    expect(fila).toMatchObject({ store_id: 1, recurso: "order", shopify_id: "6123", shopify_updated_at: "2026-10-20T10:00:00-06:00" });
    expect(fila.payload).toBe(pedido);
  });
  it("descarta lo que no trae id", () => {
    expect(filasArchivo("customer", [{ email: "x" }], 1, new Date())).toHaveLength(0);
  });
});

describe("fotos del catálogo", () => {
  it("toma las fotos del producto, solo del CDN de Shopify", () => {
    const imgs = imagenesDeProducto("77", [
      { id: 1, src: "https://cdn.shopify.com/s/files/1/a.jpg" },
      { id: 2, src: "https://evil.example/x.jpg" },
      { id: 3, src: "http://cdn.shopify.com/b.jpg" },
      { src: "https://cdn.shopify.com/sin-id.jpg" },
    ]);
    expect(imgs).toEqual([{ product_id: "77", image_id: "1", src: "https://cdn.shopify.com/s/files/1/a.jpg" }]);
    expect(imagenesDeProducto("77", null)).toEqual([]);
  });
  it("valida el host, no un prefijo engañoso", () => {
    expect(esUrlDeImagenShopify("https://cdn.shopify.com@evil.example/a.jpg")).toBe(false);
    expect(esUrlDeImagenShopify("https://cdn.shopify.com.evil.example/a.jpg")).toBe(false);
    expect(esUrlDeImagenShopify("no es url")).toBe(false);
  });
  it("la ruta en el bucket va por tienda y producto, con la extensión del tipo real", () => {
    const img = { product_id: "77", image_id: "1", src: "https://cdn.shopify.com/a" };
    expect(rutaImagen("mireva-cr", img, "image/webp")).toBe("mireva-cr/77/1.webp");
    expect(rutaImagen("mireva-hn", img, "image/png; charset=binary")).toBe("mireva-hn/77/1.png");
    expect(rutaImagen("mireva-cr", img, null)).toBe("mireva-cr/77/1.jpg");
  });
});
