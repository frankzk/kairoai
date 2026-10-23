// Respaldo completo de Shopify antes de que se suspendan las tiendas (28/10/2026).
//
// POR QUE EXISTE: shopify_orders guarda un recorte de 19 campos por pedido y el
// catalogo de productos no se guardaba en ningun lado (el selector de productos
// lo leia en vivo). Despues del 28 Shopify deja de responder. Esto guarda el
// objeto ENTERO que devuelve el Admin API para pedidos, clientes y productos, y
// copia las fotos del catalogo a un bucket propio.
//
// Una pasada completa por recurso, reanudable entre corridas con el cursor del
// header Link; cuando termina, cada corrida trae solo lo que cambio desde que
// empezo la pasada anterior. Todo pide al Admin API por fetchShopifyPage, que
// valida que el token solo vaya a la propia tienda.

import { getDB } from "@/lib/db";
import { getShopifyCredentials, type FinanceStoreConfig } from "@/lib/stores";
import { PAGE_DELAY_MS, fetchShopifyPage, sleep } from "@/lib/shopify-sync";

export type RecursoArchivo = "order" | "customer" | "product";
export const RECURSOS_ARCHIVO: RecursoArchivo[] = ["order", "customer", "product"];

const ENDPOINT: Record<RecursoArchivo, string> = { order: "orders", customer: "customers", product: "products" };
const API_VERSION = "2024-01";
export const ARCHIVO_BUCKET = "shopify-archivo";
// Margen al pasar a modo incremental: lo que cambio mientras corria la pasada.
const MARGEN_INCREMENTAL_MS = 10 * 60_000;
// Filas por upsert: 250 pedidos completos pesan varios MB.
const LOTE_UPSERT = 50;

// ─── Puro ────────────────────────────────────────────────────────────────────

/**
 * URL del Admin API SIN `fields`: devuelve el objeto completo. Pedidos con
 * status=any (anulados y cerrados incluidos). `updatedAtMin` = modo incremental.
 */
export function urlArchivo(recurso: RecursoArchivo, shop: string, updatedAtMin?: string | null): string {
  const params = new URLSearchParams({ limit: "250" });
  if (recurso === "order") params.set("status", "any");
  if (updatedAtMin) params.set("updated_at_min", updatedAtMin);
  return `https://${shop}/admin/api/${API_VERSION}/${ENDPOINT[recurso]}.json?${params.toString()}`;
}

/** Siguiente pagina segun el header Link de Shopify, o null si no hay. */
export function siguienteUrl(link: string | null | undefined): string | null {
  const match = String(link ?? "").match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

export interface FilaArchivo {
  store_id: number;
  recurso: RecursoArchivo;
  shopify_id: string;
  payload: Record<string, unknown>;
  shopify_updated_at: string | null;
  archivado_at: string;
}

export function filasArchivo(
  recurso: RecursoArchivo,
  items: Array<Record<string, unknown>>,
  storeId: number,
  ahora: Date
): FilaArchivo[] {
  return items
    .filter((item) => item && item.id != null)
    .map((item) => ({
      store_id: storeId,
      recurso,
      shopify_id: String(item.id),
      payload: item,
      shopify_updated_at: typeof item.updated_at === "string" ? item.updated_at : null,
      archivado_at: ahora.toISOString(),
    }));
}

export interface ImagenProducto {
  product_id: string;
  image_id: string;
  src: string;
}

/** Fotos de un producto del Admin API (product.images). */
export function imagenesDeProducto(productId: string, images: unknown): ImagenProducto[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img): img is Record<string, unknown> => Boolean(img) && typeof img === "object")
    .filter((img) => img.id != null && typeof img.src === "string" && esUrlDeImagenShopify(img.src))
    .map((img) => ({ product_id: productId, image_id: String(img.id), src: String(img.src) }));
}

/**
 * Solo se descargan fotos del CDN de Shopify. La URL viene del payload; sin
 * esto, una URL rara haria que el servidor pidiera cualquier cosa.
 */
export function esUrlDeImagenShopify(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && (url.host === "cdn.shopify.com" || url.host.endsWith(".myshopify.com"));
  } catch {
    return false;
  }
}

export function rutaImagen(storeCode: string, img: ImagenProducto, contentType: string | null): string {
  const porTipo: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  const ext = (contentType && porTipo[contentType.split(";")[0].trim()]) || "jpg";
  return `${storeCode}/${img.product_id}/${img.image_id}.${ext}`;
}

// ─── Base ────────────────────────────────────────────────────────────────────

interface EstadoArchivo {
  store_id: number;
  recurso: RecursoArchivo;
  next_url: string | null;
  completo: boolean;
  archivados: number;
  pasada_iniciada_at: string | null;
  completado_at: string | null;
  incremental_desde: string | null;
  ultimo_error: string | null;
}

async function leerEstado(storeId: number, recurso: RecursoArchivo): Promise<EstadoArchivo> {
  const { data, error } = await getDB()
    .from("shopify_archivo_estado")
    .select("store_id,recurso,next_url,completo,archivados,pasada_iniciada_at,completado_at,incremental_desde,ultimo_error")
    .eq("store_id", storeId)
    .eq("recurso", recurso)
    .maybeSingle();
  if (error) throw new Error(`leerEstado(${recurso}): ${error.message}`);
  return (
    (data as EstadoArchivo | null) ?? {
      store_id: storeId,
      recurso,
      next_url: null,
      completo: false,
      archivados: 0,
      pasada_iniciada_at: null,
      completado_at: null,
      incremental_desde: null,
      ultimo_error: null,
    }
  );
}

async function guardarEstado(estado: EstadoArchivo): Promise<void> {
  const { error } = await getDB()
    .from("shopify_archivo_estado")
    .upsert({ ...estado, actualizado_at: new Date().toISOString() }, { onConflict: "store_id,recurso" });
  if (error) throw new Error(`guardarEstado(${estado.recurso}): ${error.message}`);
}

async function guardarFilas(filas: FilaArchivo[]): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE_UPSERT) {
    const { error } = await getDB()
      .from("shopify_archivo")
      .upsert(filas.slice(i, i + LOTE_UPSERT), { onConflict: "store_id,recurso,shopify_id" });
    if (error) throw new Error(`guardarFilas: ${error.message}`);
  }
}

// ─── Corrida ─────────────────────────────────────────────────────────────────

export interface ResumenRecurso {
  recurso: RecursoArchivo;
  modo: "completo" | "incremental";
  paginas: number;
  filas: number;
  completo: boolean;
  archivados: number;
  error?: string;
}

async function archivarRecurso(
  store: FinanceStoreConfig,
  shop: string,
  recurso: RecursoArchivo,
  deadline: number
): Promise<ResumenRecurso> {
  const estado = await leerEstado(store.id, recurso);
  const modo = estado.completo ? "incremental" : "completo";
  const resumen: ResumenRecurso = { recurso, modo, paginas: 0, filas: 0, completo: estado.completo, archivados: estado.archivados };

  // Pasada nueva: arranca desde el principio (completa) o desde lo que cambio
  // despues de que empezo la pasada anterior (incremental).
  if (!estado.next_url) {
    estado.pasada_iniciada_at = new Date().toISOString();
    estado.next_url = urlArchivo(recurso, shop, modo === "incremental" ? estado.incremental_desde : null);
  }

  while (Date.now() < deadline && estado.next_url) {
    const res = await fetchShopifyPage(estado.next_url, store);
    if (!res.ok) {
      const texto = (await res.text().catch(() => "")).slice(0, 200);
      estado.ultimo_error = `Shopify ${res.status}: ${texto}`;
      resumen.error = estado.ultimo_error;
      await guardarEstado(estado);
      return resumen;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const items = (data[ENDPOINT[recurso]] as Array<Record<string, unknown>>) ?? [];
    await guardarFilas(filasArchivo(recurso, items, store.id, new Date()));
    resumen.paginas += 1;
    resumen.filas += items.length;
    if (modo === "completo") estado.archivados += items.length;
    estado.ultimo_error = null;

    const next = siguienteUrl(res.headers.get("link"));
    if (next) {
      estado.next_url = next;
    } else {
      // Termino la pasada: la proxima trae lo que cambio desde que esta empezo.
      const inicio = Date.parse(estado.pasada_iniciada_at ?? new Date().toISOString());
      estado.incremental_desde = new Date(inicio - MARGEN_INCREMENTAL_MS).toISOString();
      estado.next_url = null;
      if (modo === "completo") {
        estado.completo = true;
        estado.completado_at = new Date().toISOString();
      }
    }
    await guardarEstado(estado);
    if (next) await sleep(PAGE_DELAY_MS);
  }

  resumen.completo = estado.completo;
  resumen.archivados = estado.archivados;
  return resumen;
}

/** Copia al bucket las fotos de productos ya archivados que aun no estan. */
async function archivarImagenes(
  store: FinanceStoreConfig,
  deadline: number
): Promise<{ copiadas: number; pendientes: number; errores: number }> {
  const [{ data: productos, error: errP }, { data: hechas, error: errH }] = await Promise.all([
    getDB().from("shopify_archivo").select("shopify_id, images:payload->images").eq("store_id", store.id).eq("recurso", "product"),
    getDB().from("shopify_archivo_imagenes").select("image_id").eq("store_id", store.id),
  ]);
  if (errP) throw new Error(`archivarImagenes(productos): ${errP.message}`);
  if (errH) throw new Error(`archivarImagenes(hechas): ${errH.message}`);
  const ya = new Set(((hechas ?? []) as Array<{ image_id: string }>).map((h) => h.image_id));
  const pendientes = ((productos ?? []) as Array<{ shopify_id: string; images: unknown }>)
    .flatMap((p) => imagenesDeProducto(p.shopify_id, p.images))
    .filter((img) => !ya.has(img.image_id));

  let copiadas = 0;
  let errores = 0;
  for (const img of pendientes) {
    if (Date.now() >= deadline) break;
    try {
      const res = await fetch(img.src, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type");
      const bytes = await res.arrayBuffer();
      const path = rutaImagen(store.code, img, contentType);
      const { error: errSubida } = await getDB()
        .storage.from(ARCHIVO_BUCKET)
        .upload(path, bytes, { contentType: contentType ?? "image/jpeg", upsert: true });
      if (errSubida) throw new Error(errSubida.message);
      const { error: errFila } = await getDB().from("shopify_archivo_imagenes").upsert(
        {
          store_id: store.id,
          product_id: img.product_id,
          image_id: img.image_id,
          src: img.src,
          storage_path: path,
          content_type: contentType,
          bytes: bytes.byteLength,
        },
        { onConflict: "store_id,image_id" }
      );
      if (errFila) throw new Error(errFila.message);
      copiadas += 1;
    } catch (err) {
      errores += 1;
      console.warn(`[shopify-archivo] foto ${img.image_id} (${store.code}):`, err);
    }
  }
  return { copiadas, pendientes: pendientes.length - copiadas, errores };
}

export interface ResumenTienda {
  store: string;
  recursos: ResumenRecurso[];
  imagenes?: { copiadas: number; pendientes: number; errores: number };
  error?: string;
}

/** Una corrida para una tienda: pedidos, clientes, productos y despues fotos. */
export async function archivarTienda(store: FinanceStoreConfig, deadline: number): Promise<ResumenTienda> {
  const { shop, token, missing } = getShopifyCredentials(store);
  if (!shop || !token) return { store: store.code, recursos: [], error: `Faltan ${missing.join(" y ")}` };
  const recursos: ResumenRecurso[] = [];
  for (const recurso of RECURSOS_ARCHIVO) {
    if (Date.now() >= deadline) break;
    recursos.push(await archivarRecurso(store, shop, recurso, deadline));
  }
  const productos = recursos.find((r) => r.recurso === "product");
  const imagenes =
    Date.now() < deadline && (productos?.completo || productos?.modo === "incremental")
      ? await archivarImagenes(store, deadline)
      : undefined;
  return { store: store.code, recursos, imagenes };
}
