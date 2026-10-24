// El catalogo desde el respaldo de Shopify (migracion 0049), para cuando
// Shopify no responde.
//
// Desde el 28/10/2026 las tiendas de Shopify estan suspendidas y
// /api/shopify/products devolvia error: Upsell, el selector de productos de
// Leads y Finanzas -> Productos se quedaban sin catalogo. Aca sale de
// shopify_archivo con la MISMA forma (ShopifyProductOption). Las fotos salen de
// la copia en el bucket privado con URL firmada: la del CDN de Shopify puede
// dejar de servir cuando la tienda se suspende.
//
// productosDelRespaldo es puro (tests/catalogo-respaldo.test.ts).

import { getDB } from "@/lib/db";
import type { ShopifyProductOption } from "@/app/api/shopify/products/route";

const BUCKET = "shopify-archivo";
/** Lo que dura la URL firmada de cada foto (la pantalla la pide de nuevo al recargar). */
const FOTO_TTL_SEGUNDOS = 6 * 60 * 60;

export interface ProductoRespaldo {
  id?: unknown;
  title?: unknown;
  variants?: unknown;
  image?: unknown;
}

export function productosDelRespaldo(
  productos: ProductoRespaldo[],
  fotoPorImagen: Map<string, string> = new Map()
): ShopifyProductOption[] {
  const out: ShopifyProductOption[] = [];
  for (const product of productos) {
    const productId = Number(product.id);
    const titulo = String(product.title ?? "").trim();
    if (!Number.isFinite(productId) || !titulo) continue;
    const imagen = product.image && typeof product.image === "object" ? (product.image as Record<string, unknown>) : null;
    const imageUrl = imagen
      ? fotoPorImagen.get(String(imagen.id ?? "")) ?? (typeof imagen.src === "string" ? imagen.src : undefined)
      : undefined;
    const variantes = Array.isArray(product.variants) ? (product.variants as Array<Record<string, unknown>>) : [];
    for (const variant of variantes) {
      const variantId = Number(variant?.id);
      if (!Number.isFinite(variantId)) continue;
      const variantTitle = String(variant.title ?? "");
      const variantLabel = variantTitle && variantTitle !== "Default Title" ? ` - ${variantTitle}` : "";
      out.push({
        variant_id: variantId,
        product_id: productId,
        product_title: titulo,
        variant_title: variantTitle,
        display_name: `${titulo}${variantLabel}`,
        sku: String(variant.sku ?? ""),
        price: Math.round(parseFloat(String(variant.price ?? "0")) || 0),
        image_url: imageUrl,
      });
    }
  }
  return out;
}

/** El catalogo de una tienda desde el respaldo, con las fotos de la copia propia. */
export async function cargarCatalogoRespaldo(storeId: number): Promise<ShopifyProductOption[]> {
  const db = getDB();
  const { data, error } = await db
    .from("shopify_archivo")
    .select("id:payload->id,title:payload->>title,variants:payload->variants,image:payload->image")
    .eq("store_id", storeId)
    .eq("recurso", "product")
    .limit(5000);
  if (error) throw new Error(`cargarCatalogoRespaldo: ${error.message}`);
  const productos = (data ?? []) as unknown as ProductoRespaldo[];

  // Fotos: best-effort. Si no se pueden firmar, queda la URL original.
  const fotoPorImagen = new Map<string, string>();
  try {
    const ids = productos
      .map((p) => (p.image && typeof p.image === "object" ? String((p.image as Record<string, unknown>).id ?? "") : ""))
      .filter(Boolean);
    if (ids.length) {
      const { data: copias } = await db
        .from("shopify_archivo_imagenes")
        .select("image_id,storage_path")
        .eq("store_id", storeId)
        .in("image_id", ids);
      const filas = (copias ?? []) as Array<{ image_id: string; storage_path: string }>;
      if (filas.length) {
        const { data: firmadas } = await db.storage.from(BUCKET).createSignedUrls(
          filas.map((f) => f.storage_path),
          FOTO_TTL_SEGUNDOS
        );
        const porRuta = new Map((firmadas ?? []).filter((f) => f.signedUrl).map((f) => [f.path, f.signedUrl]));
        for (const fila of filas) {
          const url = porRuta.get(fila.storage_path);
          if (url) fotoPorImagen.set(fila.image_id, url);
        }
      }
    }
  } catch (err) {
    console.warn("[catalogo-respaldo] fotos:", err instanceof Error ? err.message : err);
  }
  return productosDelRespaldo(productos, fotoPorImagen);
}
