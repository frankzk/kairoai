// Respaldo completo de Shopify antes de que se suspendan las tiendas (28/10/2026).
//
// POR QUE ESTE TEST EXISTE: el respaldo es lo unico que queda despues del 28.
// Si la URL pidiera `fields=` volveria a guardar un recorte; si la paginacion se
// cortara, faltarian pedidos sin que nadie lo note; y si las fotos se bajaran de
// cualquier URL, el servidor pediria lo que un payload raro le dijera.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONFIG_RECURSOS,
  RECURSOS_ARCHIVO,
  esUrlDeImagenShopify,
  filasArchivo,
  idDeItem,
  imagenesDeContenido,
  imagenesDeProducto,
  itemsDeRespuesta,
  rutaImagen,
  siguientePadre,
  siguienteUrl,
  tocaPasada,
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

// Desde el 25/10: todo lo demas del Admin API, para las cinco tiendas. Si un
// recurso pidiera una ruta mal o se saltara un padre, faltaria sin que nadie lo
// vea hasta despues del 28, cuando ya no hay como sacarlo.
describe("el resto de la tienda", () => {
  it("cada recurso con padre se pide colgado de su padre, y va después de él", () => {
    expect(new URL(urlArchivo("article", SHOP, null, "55")).pathname).toBe("/admin/api/2024-01/blogs/55/articles.json");
    expect(new URL(urlArchivo("discount_code", SHOP, null, "9")).pathname).toBe("/admin/api/2024-01/price_rules/9/discount_codes.json");
    expect(new URL(urlArchivo("product_metafield", SHOP, null, "77")).pathname).toBe("/admin/api/2024-01/products/77/metafields.json");
    const inventario = new URL(urlArchivo("inventory_level", SHOP, null, "31"));
    expect(inventario.pathname).toBe("/admin/api/2024-01/inventory_levels.json");
    expect(inventario.searchParams.get("location_ids")).toBe("31");
    for (const recurso of RECURSOS_ARCHIVO) {
      const padre = CONFIG_RECURSOS[recurso].padre;
      if (padre) expect(RECURSOS_ARCHIVO.indexOf(padre)).toBeLessThan(RECURSOS_ARCHIVO.indexOf(recurso));
    }
  });

  it("updated_at_min solo a los que lo aceptan; los demás se vuelven a sacar enteros cada tanto", () => {
    expect(new URL(urlArchivo("checkout", SHOP, "2026-10-25T00:00:00Z")).searchParams.get("updated_at_min")).toBe("2026-10-25T00:00:00Z");
    expect(new URL(urlArchivo("redirect", SHOP, "2026-10-25T00:00:00Z")).searchParams.has("updated_at_min")).toBe(false);
    for (const recurso of RECURSOS_ARCHIVO) {
      const cfg = CONFIG_RECURSOS[recurso];
      expect(Boolean(cfg.incremental) || Boolean(cfg.cadaHoras)).toBe(true);
      expect(new URL(urlArchivo(recurso, SHOP, null, "1")).searchParams.has("fields")).toBe(false);
    }
  });

  it("la tienda viene como objeto suelto; el resto como lista", () => {
    expect(itemsDeRespuesta("shop", { shop: { id: 1, name: "Mireva" } })).toEqual([{ id: 1, name: "Mireva" }]);
    expect(itemsDeRespuesta("checkout", { checkouts: [{ id: 2 }, null] })).toEqual([{ id: 2 }]);
    expect(itemsDeRespuesta("page", { errors: "Not Found" })).toEqual([]);
    expect(itemsDeRespuesta("page", null)).toEqual([]);
  });

  it("las políticas no traen id y el inventario es artículo por bodega", () => {
    expect(idDeItem("policy", { title: "Política de reembolso", handle: "refund-policy" })).toBe("refund-policy");
    expect(idDeItem("inventory_level", { inventory_item_id: 808, location_id: 31, available: 4 })).toBe("808:31");
    expect(idDeItem("inventory_level", { inventory_item_id: 808 })).toBeNull();
    const filas = filasArchivo("inventory_level", [{ inventory_item_id: 808, location_id: 31 }, { inventory_item_id: 808, location_id: 32 }], 3, new Date());
    expect(filas.map((f) => f.shopify_id)).toEqual(["808:31", "808:32"]);
  });

  it("los padres se recorren en orden numérico, sin repetir", () => {
    const padres = ["10", "2", "100", "2"];
    expect(siguientePadre(padres, null)).toBe("2");
    expect(siguientePadre(padres, "2")).toBe("10");
    expect(siguientePadre(padres, "10")).toBe("100");
    expect(siguientePadre(padres, "100")).toBeNull();
    // Un padre que se borro a mitad de pasada: sigue con el que viene despues.
    expect(siguientePadre(["2", "100"], "10")).toBe("100");
    expect(siguientePadre([], null)).toBeNull();
  });

  it("vuelve a sacar un recurso entero solo cuando pasaron sus horas", () => {
    const ahora = Date.parse("2026-10-25T12:00:00Z");
    const hecho = { completo: true, next_url: null, pasada_iniciada_at: "2026-10-25T10:00:00Z" };
    expect(tocaPasada("redirect", hecho, ahora)).toBe(false); // cada 12 h
    expect(tocaPasada("redirect", { ...hecho, pasada_iniciada_at: "2026-10-24T23:00:00Z" }, ahora)).toBe(true);
    expect(tocaPasada("redirect", { ...hecho, next_url: "https://x" }, ahora)).toBe(true); // a mitad: sigue
    expect(tocaPasada("redirect", { ...hecho, completo: false }, ahora)).toBe(true);
    expect(tocaPasada("checkout", hecho, ahora)).toBe(true); // incremental: cada corrida
  });

  it("la base acepta exactamente los recursos del código (migración 0052)", () => {
    const sql = readFileSync("supabase/migrations/0052_shopify_archivo_todo.sql", "utf8");
    const checks = Array.from(sql.matchAll(/CHECK \(recurso IN \(([^)]*)\)\)/g)).map((m) =>
      Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1])
    );
    expect(checks).toHaveLength(2);
    for (const lista of checks) expect([...lista].sort()).toEqual([...RECURSOS_ARCHIVO].sort());
  });
});

describe("fotos dentro de descripciones, páginas y colecciones", () => {
  it("toma las del CDN de Shopify, también las que vienen sin https:", () => {
    const html =
      '<p><img src="//cdn.shopify.com/s/files/1/a.jpg?v=12"></p>' +
      "<img src='https://cdn.shopify.com/s/files/1/b.webp'>" +
      '<img src="https://ae01.alicdn.com/kf/c.jpg">' + // no depende de Shopify
      '<a href="https://cdn.shopify.com/s/files/1/manual.pdf">PDF</a>' +
      '<img src="https://cdn.shopify.com/s/files/1/a.jpg?v=99&amp;width=600">'; // la misma foto, otra version
    const imgs = imagenesDeContenido("page:5", html, "https://cdn.shopify.com/s/files/1/portada.png");
    expect(imgs.map((i) => i.src)).toEqual([
      "https://cdn.shopify.com/s/files/1/portada.png",
      "https://cdn.shopify.com/s/files/1/a.jpg?v=12",
      "https://cdn.shopify.com/s/files/1/b.webp",
    ]);
    expect(imgs.every((i) => i.product_id === "page:5" && i.image_id.startsWith("url-"))).toBe(true);
    expect(imagenesDeContenido("page:5", null)).toEqual([]);
  });

  it("la misma foto en dos productos es una sola, y va a su carpeta", () => {
    const [a] = imagenesDeContenido("product:1", '<img src="https://cdn.shopify.com/s/files/1/x.jpg?v=1">');
    const [b] = imagenesDeContenido("product:2", '<img src="https://cdn.shopify.com/s/files/1/x.jpg?v=2">');
    expect(a.image_id).toBe(b.image_id);
    expect(rutaImagen("kenku-mx", a, "image/jpeg")).toBe(`kenku-mx/contenido/${a.image_id.slice(4)}.jpg`);
  });
});
