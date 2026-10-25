// Respaldo completo de Shopify antes de que se suspendan las tiendas (28/10/2026).
//
// POR QUE EXISTE: shopify_orders guarda un recorte de 19 campos por pedido y el
// catalogo de productos no se guardaba en ningun lado (el selector de productos
// lo leia en vivo). Despues del 28 Shopify deja de responder. Esto guarda el
// objeto ENTERO que devuelve el Admin API para pedidos, clientes y productos, y
// copia las fotos del catalogo a un bucket propio.
//
// Desde el 25/10 tambien guarda todo lo demas que da el Admin API (carritos
// abandonados, colecciones, paginas, blog, politicas, redirecciones,
// descuentos, borradores, inventario, metacampos) y las fotos que estan dentro
// de las descripciones, para las tiendas de Kairo y las de solo respaldo
// (TIENDAS_SOLO_RESPALDO en lib/stores.ts).
//
// Una pasada completa por recurso, reanudable entre corridas con el cursor del
// header Link; cuando termina, cada corrida trae solo lo que cambio desde que
// empezo la pasada anterior (o, si el recurso no filtra por fecha, lo vuelve a
// sacar entero cada `cadaHoras`). Todo pide al Admin API por fetchShopifyPage,
// que valida que el token solo vaya a la propia tienda.

import { createHash } from "node:crypto";
import { getDB } from "@/lib/db";
import { getShopifyCredentials, type TiendaShopify } from "@/lib/stores";
import { tokenShopify } from "@/lib/shopify-token";
import { PAGE_DELAY_MS, fetchShopifyPage, sleep } from "@/lib/shopify-sync";

export type RecursoArchivo =
  | "order"
  | "customer"
  | "product"
  | "checkout"
  | "custom_collection"
  | "smart_collection"
  | "collect"
  | "page"
  | "blog"
  | "article"
  | "policy"
  | "shop"
  | "redirect"
  | "price_rule"
  | "discount_code"
  | "draft_order"
  | "location"
  | "inventory_level"
  | "shop_metafield"
  | "product_metafield";

interface ConfigRecurso {
  /** Ruta bajo /admin/api/<version>/, sin ".json". Con padre, recibe su id. */
  ruta: (padre: string) => string;
  /** Clave de la respuesta: la lista (o el objeto, en `shop`). */
  clave: string;
  /** Se pide una vez por cada fila ya archivada de este recurso. */
  padre?: RecursoArchivo;
  /** Acepta updated_at_min: despues de la primera pasada trae solo lo que cambio. */
  incremental?: boolean;
  /** Sin incremental: cada cuantas horas se vuelve a sacar entero. */
  cadaHoras?: number;
  params?: (padre: string) => Record<string, string>;
}

/**
 * Que se respalda y en que orden: primero lo que mas importa, y cada recurso
 * con padre despues de su padre. El permiso de la app que pide cada uno esta en
 * lib/shopify-scopes.ts; sin ese permiso el recurso anota el error y los demas
 * siguen.
 */
export const CONFIG_RECURSOS: Record<RecursoArchivo, ConfigRecurso> = {
  order: { ruta: () => "orders", clave: "orders", incremental: true, params: () => ({ status: "any" }) },
  customer: { ruta: () => "customers", clave: "customers", incremental: true },
  product: { ruta: () => "products", clave: "products", incremental: true },
  // Carritos abandonados: telefono y productos de quien no termino de comprar.
  checkout: { ruta: () => "checkouts", clave: "checkouts", incremental: true },
  custom_collection: { ruta: () => "custom_collections", clave: "custom_collections", incremental: true },
  smart_collection: { ruta: () => "smart_collections", clave: "smart_collections", incremental: true },
  // Que producto esta en que coleccion manual.
  collect: { ruta: () => "collects", clave: "collects", cadaHoras: 6 },
  page: { ruta: () => "pages", clave: "pages", incremental: true },
  blog: { ruta: () => "blogs", clave: "blogs", cadaHoras: 6 },
  article: { ruta: (blog) => `blogs/${blog}/articles`, clave: "articles", padre: "blog", cadaHoras: 6 },
  policy: { ruta: () => "policies", clave: "policies", cadaHoras: 12 },
  shop: { ruta: () => "shop", clave: "shop", cadaHoras: 12 },
  redirect: { ruta: () => "redirects", clave: "redirects", cadaHoras: 12 },
  price_rule: { ruta: () => "price_rules", clave: "price_rules", cadaHoras: 6 },
  discount_code: {
    ruta: (regla) => `price_rules/${regla}/discount_codes`,
    clave: "discount_codes",
    padre: "price_rule",
    cadaHoras: 6,
  },
  draft_order: { ruta: () => "draft_orders", clave: "draft_orders", incremental: true },
  location: { ruta: () => "locations", clave: "locations", cadaHoras: 12 },
  inventory_level: {
    ruta: () => "inventory_levels",
    params: (bodega) => ({ location_ids: bodega }),
    clave: "inventory_levels",
    padre: "location",
    cadaHoras: 6,
  },
  shop_metafield: { ruta: () => "metafields", clave: "metafields", cadaHoras: 12 },
  product_metafield: { ruta: (producto) => `products/${producto}/metafields`, clave: "metafields", padre: "product", cadaHoras: 12 },
};

export const RECURSOS_ARCHIVO = Object.keys(CONFIG_RECURSOS) as RecursoArchivo[];

const API_VERSION = "2024-01";
export const ARCHIVO_BUCKET = "shopify-archivo";
// Margen al pasar a modo incremental: lo que cambio mientras corria la pasada.
const MARGEN_INCREMENTAL_MS = 10 * 60_000;
// Filas por upsert: 250 pedidos completos pesan varios MB.
const LOTE_UPSERT = 50;
// PostgREST corta en 1.000 filas por consulta.
const PAGINA_DB = 1000;

// ─── Puro ────────────────────────────────────────────────────────────────────

/**
 * URL del Admin API SIN `fields`: devuelve el objeto completo. Pedidos con
 * status=any (anulados y cerrados incluidos). `updatedAtMin` = modo incremental,
 * solo en los recursos que lo aceptan. `padre`: el id del que cuelga (el blog
 * de los articulos, el producto de los metacampos...).
 */
export function urlArchivo(recurso: RecursoArchivo, shop: string, updatedAtMin?: string | null, padre = ""): string {
  const cfg = CONFIG_RECURSOS[recurso];
  const params = new URLSearchParams({ limit: "250", ...(cfg.params?.(padre) ?? {}) });
  if (updatedAtMin && cfg.incremental) params.set("updated_at_min", updatedAtMin);
  return `https://${shop}/admin/api/${API_VERSION}/${cfg.ruta(padre)}.json?${params.toString()}`;
}

/** Siguiente pagina segun el header Link de Shopify, o null si no hay. */
export function siguienteUrl(link: string | null | undefined): string | null {
  const match = String(link ?? "").match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

/** Lo que trae una respuesta: la lista, o el objeto suelto de `shop`. */
export function itemsDeRespuesta(recurso: RecursoArchivo, data: unknown): Array<Record<string, unknown>> {
  const valor = data && typeof data === "object" ? (data as Record<string, unknown>)[CONFIG_RECURSOS[recurso].clave] : null;
  if (Array.isArray(valor)) return valor.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object");
  return valor && typeof valor === "object" ? [valor as Record<string, unknown>] : [];
}

/** La clave de cada fila. Las politicas no traen id y el inventario es item x bodega. */
export function idDeItem(recurso: RecursoArchivo, item: Record<string, unknown>): string | null {
  const texto = (v: unknown) => (v == null || v === "" ? null : String(v));
  if (recurso === "policy") return texto(item.handle) ?? texto(item.title);
  if (recurso === "inventory_level") {
    const articulo = texto(item.inventory_item_id);
    const bodega = texto(item.location_id);
    return articulo && bodega ? `${articulo}:${bodega}` : null;
  }
  return texto(item.id);
}

/** El padre que sigue a `actual` (en orden numerico), o el primero; null si no quedan. */
export function siguientePadre(padres: string[], actual: string | null): string | null {
  const orden = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  const lista = Array.from(new Set(padres)).sort(orden);
  if (actual == null) return lista[0] ?? null;
  return lista.find((p) => orden(p, actual) > 0) ?? null;
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
  const filas: FilaArchivo[] = [];
  for (const item of items) {
    const id = item ? idDeItem(recurso, item) : null;
    if (!id) continue;
    filas.push({
      store_id: storeId,
      recurso,
      shopify_id: id,
      payload: item,
      shopify_updated_at: typeof item.updated_at === "string" ? item.updated_at : null,
      archivado_at: ahora.toISOString(),
    });
  }
  return filas;
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

const EXTENSION_IMAGEN = /\.(png|jpe?g|webp|gif|avif)$/i;

/**
 * Las fotos que estan DENTRO de un texto (descripcion de producto, pagina,
 * articulo, coleccion) y de su foto de portada. Las del CDN de Shopify se
 * pierden con la tienda; las de otros sitios no dependen de Shopify y no se
 * copian. `dueno` dice de donde vino ("page:123").
 */
export function imagenesDeContenido(dueno: string, html: unknown, portada?: unknown): ImagenProducto[] {
  const urls: string[] = [];
  if (typeof portada === "string") urls.push(portada);
  if (typeof html === "string") {
    const atributo = /\bsrc\s*=\s*["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = atributo.exec(html))) urls.push(m[1]);
  }
  const vistas = new Set<string>();
  const out: ImagenProducto[] = [];
  for (const cruda of urls) {
    const src = cruda.trim().replace(/&amp;/g, "&").replace(/^\/\//, "https://");
    if (!esUrlDeImagenShopify(src)) continue;
    const sinVersion = src.split(/[?#]/)[0];
    if (!EXTENSION_IMAGEN.test(new URL(sinVersion).pathname)) continue;
    const imageId = `url-${createHash("sha1").update(sinVersion).digest("hex")}`;
    if (vistas.has(imageId)) continue;
    vistas.add(imageId);
    out.push({ product_id: dueno, image_id: imageId, src });
  }
  return out;
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
  // Las del contenido van aparte: no son de un producto y su id es un hash.
  if (img.image_id.startsWith("url-")) return `${storeCode}/contenido/${img.image_id.slice(4)}.${ext}`;
  return `${storeCode}/${img.product_id}/${img.image_id}.${ext}`;
}

/** true si a un recurso le toca empezar otra pasada ahora. */
export function tocaPasada(
  recurso: RecursoArchivo,
  estado: { completo: boolean; next_url: string | null; pasada_iniciada_at: string | null },
  ahora: number
): boolean {
  const cfg = CONFIG_RECURSOS[recurso];
  if (estado.next_url || !estado.completo || cfg.incremental || !cfg.cadaHoras) return true;
  const inicio = estado.pasada_iniciada_at ? Date.parse(estado.pasada_iniciada_at) : NaN;
  return !Number.isFinite(inicio) || ahora - inicio >= cfg.cadaHoras * 3600_000;
}

// ─── Base ────────────────────────────────────────────────────────────────────

interface EstadoArchivo {
  store_id: number;
  recurso: RecursoArchivo;
  next_url: string | null;
  /** En los recursos con padre: el padre que se esta recorriendo. */
  padre_actual: string | null;
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
    .select("store_id,recurso,next_url,padre_actual,completo,archivados,pasada_iniciada_at,completado_at,incremental_desde,ultimo_error")
    .eq("store_id", storeId)
    .eq("recurso", recurso)
    .maybeSingle();
  if (error) throw new Error(`leerEstado(${recurso}): ${error.message}`);
  return (
    (data as EstadoArchivo | null) ?? {
      store_id: storeId,
      recurso,
      next_url: null,
      padre_actual: null,
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

/** Todas las filas de una consulta, de a 1.000. */
async function todas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += PAGINA_DB) {
    const { data, error } = await consulta(desde, desde + PAGINA_DB - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as T[];
    out.push(...pagina);
    if (pagina.length < PAGINA_DB) return out;
  }
}

/** Los ids ya archivados de un recurso (los padres de otro). */
async function idsArchivados(storeId: number, recurso: RecursoArchivo): Promise<string[]> {
  const filas = await todas<{ shopify_id: string }>((desde, hasta) =>
    getDB()
      .from("shopify_archivo")
      .select("shopify_id")
      .eq("store_id", storeId)
      .eq("recurso", recurso)
      .order("shopify_id")
      .range(desde, hasta)
  );
  return filas.map((f) => f.shopify_id);
}

// ─── Corrida ─────────────────────────────────────────────────────────────────

export interface ResumenRecurso {
  recurso: RecursoArchivo;
  modo: "completo" | "incremental" | "repaso";
  paginas: number;
  filas: number;
  completo: boolean;
  archivados: number;
  /** Quedo a mitad de una pasada (sigue en la proxima corrida). */
  pendiente: boolean;
  /** No le tocaba pasada (o espera a que termine su padre). */
  saltado?: boolean;
  error?: string;
}

/** Exportada para tests/shopify-archivo-corrida.test.ts. */
export async function archivarRecurso(
  store: TiendaShopify,
  shop: string,
  recurso: RecursoArchivo,
  deadline: number
): Promise<ResumenRecurso> {
  const cfg = CONFIG_RECURSOS[recurso];
  const estado = await leerEstado(store.id, recurso);
  const modo = !estado.completo ? "completo" : cfg.incremental ? "incremental" : "repaso";
  const resumen: ResumenRecurso = {
    recurso,
    modo,
    paginas: 0,
    filas: 0,
    completo: estado.completo,
    archivados: estado.archivados,
    pendiente: Boolean(estado.next_url),
  };

  if (!tocaPasada(recurso, estado, Date.now())) return { ...resumen, saltado: true };

  let padres: string[] | null = null;
  const cargarPadres = async () => (padres ??= await idsArchivados(store.id, cfg.padre!));

  const terminarPasada = () => {
    // La proxima trae lo que cambio desde que esta empezo.
    const inicio = Date.parse(estado.pasada_iniciada_at ?? new Date().toISOString());
    estado.incremental_desde = new Date(inicio - MARGEN_INCREMENTAL_MS).toISOString();
    estado.next_url = null;
    estado.padre_actual = null;
    if (!estado.completo) {
      estado.completo = true;
      estado.completado_at = new Date().toISOString();
    }
  };

  // Pasada nueva: desde el principio (completa o repaso) o desde lo que cambio
  // despues de que empezo la anterior (incremental).
  if (!estado.next_url) {
    if (cfg.padre) {
      // Los hijos se recorren cuando su padre ya esta entero.
      const padre = await leerEstado(store.id, cfg.padre);
      if (!padre.completo) return { ...resumen, saltado: true };
      estado.pasada_iniciada_at = new Date().toISOString();
      const primero = siguientePadre(await cargarPadres(), null);
      if (!primero) {
        terminarPasada();
        await guardarEstado(estado);
        return { ...resumen, completo: estado.completo, pendiente: false };
      }
      estado.padre_actual = primero;
      estado.next_url = urlArchivo(recurso, shop, null, primero);
    } else {
      estado.pasada_iniciada_at = new Date().toISOString();
      estado.next_url = urlArchivo(recurso, shop, modo === "incremental" ? estado.incremental_desde : null);
    }
  }

  while (Date.now() < deadline && estado.next_url) {
    const res = await fetchShopifyPage(estado.next_url, store);
    // Un hijo de un padre que ya no existe (producto borrado) no frena la pasada.
    const padreBorrado = res.status === 404 && Boolean(cfg.padre);
    if (!res.ok && !padreBorrado) {
      const texto = (await res.text().catch(() => "")).slice(0, 200);
      estado.ultimo_error = `Shopify ${res.status}: ${texto}`;
      resumen.error = estado.ultimo_error;
      await guardarEstado(estado);
      return { ...resumen, pendiente: true };
    }
    const items = padreBorrado ? [] : itemsDeRespuesta(recurso, await res.json());
    await guardarFilas(filasArchivo(recurso, items, store.id, new Date()));
    resumen.paginas += 1;
    resumen.filas += items.length;
    if (modo === "completo") estado.archivados += items.length;
    estado.ultimo_error = null;

    const next = padreBorrado ? null : siguienteUrl(res.headers.get("link"));
    if (next) {
      estado.next_url = next;
    } else if (cfg.padre) {
      const otro = siguientePadre(await cargarPadres(), estado.padre_actual);
      if (otro) {
        estado.padre_actual = otro;
        estado.next_url = urlArchivo(recurso, shop, null, otro);
      } else {
        terminarPasada();
      }
    } else {
      terminarPasada();
    }
    await guardarEstado(estado);
    if (estado.next_url) await sleep(PAGE_DELAY_MS);
  }

  return { ...resumen, completo: estado.completo, archivados: estado.archivados, pendiente: Boolean(estado.next_url) };
}

/** Recursos cuyo texto o portada puede traer fotos del CDN de Shopify. */
const RECURSOS_CON_CONTENIDO: RecursoArchivo[] = ["product", "custom_collection", "smart_collection", "page", "article"];

interface ResumenImagenes {
  copiadas: number;
  pendientes: number;
  errores: number;
}

/**
 * Copia al bucket las fotos ya archivadas que aun no estan: las de cada
 * producto y las que estan dentro de descripciones, paginas, articulos y
 * colecciones.
 */
async function archivarImagenes(store: TiendaShopify, deadline: number): Promise<ResumenImagenes> {
  const [productos, contenidos, hechas] = await Promise.all([
    todas<{ shopify_id: string; images: unknown }>((desde, hasta) =>
      getDB()
        .from("shopify_archivo")
        .select("shopify_id, images:payload->images")
        .eq("store_id", store.id)
        .eq("recurso", "product")
        .order("shopify_id")
        .range(desde, hasta)
    ),
    todas<{ shopify_id: string; recurso: string; body_html: unknown; portada: unknown }>((desde, hasta) =>
      getDB()
        .from("shopify_archivo")
        .select("shopify_id, recurso, body_html:payload->>body_html, portada:payload->image->>src")
        .eq("store_id", store.id)
        .in("recurso", RECURSOS_CON_CONTENIDO)
        .order("recurso")
        .order("shopify_id")
        .range(desde, hasta)
    ),
    todas<{ image_id: string }>((desde, hasta) =>
      getDB().from("shopify_archivo_imagenes").select("image_id").eq("store_id", store.id).order("image_id").range(desde, hasta)
    ),
  ]);
  const ya = new Set(hechas.map((h) => h.image_id));
  const vistas = new Set<string>();
  const pendientes = [
    ...productos.flatMap((p) => imagenesDeProducto(p.shopify_id, p.images)),
    // La portada del producto ya esta entre sus fotos: del producto solo el texto.
    ...contenidos.flatMap((c) =>
      imagenesDeContenido(`${c.recurso}:${c.shopify_id}`, c.body_html, c.recurso === "product" ? undefined : c.portada)
    ),
  ].filter((img) => {
    if (ya.has(img.image_id) || vistas.has(img.image_id)) return false;
    vistas.add(img.image_id);
    return true;
  });

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
  imagenes?: ResumenImagenes;
  error?: string;
}

/** "Shopify 403: ...approval for read_content scope." -> "403 falta read_content". */
export function errorCorto(error: string): string {
  const permiso = error.match(/approval for (\w+) scope/i);
  if (permiso) return `${error.match(/Shopify (\d{3})/)?.[1] ?? "403"} falta ${permiso[1]}`;
  return error.slice(0, 200);
}

/**
 * Lo que queda en cron_runs de cada corrida: por tienda, el error que la frena,
 * lo que se guardo, lo que quedo a mitad y lo que falla. El resumen completo
 * pasaba de los 4.000 caracteres que guarda cron_runs y se perdia entero,
 * error de la tienda incluido.
 */
export function resumenCorto(tiendas: ResumenTienda[]) {
  return tiendas.map((t) => ({
    store: t.store,
    ...(t.error ? { error: t.error.slice(0, 300) } : {}),
    filas: Object.fromEntries(t.recursos.filter((r) => r.filas > 0).map((r) => [r.recurso, r.filas])),
    a_mitad: t.recursos.filter((r) => r.pendiente && !r.error).map((r) => r.recurso),
    errores: Object.fromEntries(t.recursos.filter((r) => r.error).map((r) => [r.recurso, errorCorto(r.error!)])),
    ...(t.imagenes ? { fotos: t.imagenes } : {}),
  }));
}

/** Suma lo de dos vueltas sobre el mismo recurso. */
function sumar(a: ResumenRecurso, b: ResumenRecurso): ResumenRecurso {
  return { ...b, modo: a.modo, paginas: a.paginas + b.paginas, filas: a.filas + b.filas, saltado: a.saltado && b.saltado };
}

/**
 * Una corrida para una tienda. Primera vuelta: cada recurso (y las fotos) con
 * su parte del tiempo, para que una pasada larga de pedidos no deje sin
 * respaldar los productos o los carritos. Segunda vuelta: lo que sobre, para lo
 * que quedo a mitad. Un recurso que falla anota su error y los demas siguen.
 */
export async function archivarTienda(store: TiendaShopify, deadline: number): Promise<ResumenTienda> {
  const { shop } = getShopifyCredentials(store);
  // Sin token en Vercel ni app con client credentials: lo dice y no pide nada.
  const credencial = await tokenShopify(store);
  if (!credencial.ok) {
    console.warn(`[shopify-archivo] ${store.code}: ${credencial.error}`);
    return { store: store.code, recursos: [], error: credencial.error };
  }

  const porRecurso = new Map<RecursoArchivo, ResumenRecurso>();
  const correr = async (recurso: RecursoArchivo, tope: number) => {
    let r: ResumenRecurso;
    try {
      r = await archivarRecurso(store, shop, recurso, tope);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : "Error";
      r = { recurso, modo: "completo", paginas: 0, filas: 0, completo: false, archivados: 0, pendiente: true, error: mensaje };
    }
    const antes = porRecurso.get(recurso);
    porRecurso.set(recurso, antes ? sumar(antes, r) : r);
  };

  let imagenes: ResumenImagenes | undefined;
  const turnos = RECURSOS_ARCHIVO.length + 1; // + las fotos
  for (let i = 0; i < turnos; i += 1) {
    if (Date.now() >= deadline) break;
    const tope = Date.now() + (deadline - Date.now()) / (turnos - i);
    if (i < RECURSOS_ARCHIVO.length) {
      await correr(RECURSOS_ARCHIVO[i], tope);
    } else {
      try {
        imagenes = await archivarImagenes(store, tope);
      } catch (err) {
        console.warn(`[shopify-archivo] fotos (${store.code}):`, err);
      }
    }
  }
  for (const recurso of RECURSOS_ARCHIVO) {
    if (Date.now() >= deadline) break;
    const r = porRecurso.get(recurso);
    // Lo que fallo (un permiso que falta) se reintenta en la corrida siguiente.
    if (r?.pendiente && !r.error) await correr(recurso, deadline);
  }
  return { store: store.code, recursos: RECURSOS_ARCHIVO.flatMap((r) => porRecurso.get(r) ?? []), imagenes };
}
