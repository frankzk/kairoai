import { getDB } from "./db";
import type { MarketingOriginRow } from "./marketing-attribution";
import {
  readIcomflyAdOrigin,
  shopifyAdOrigin,
  mergeAdOrigins,
  resolveOriginCampaign,
} from "./icomfly-ad-origin";
import { readOriginCatalog } from "./marketing-origin-catalog";
import { filtrosPedidoIcomfly } from "./zadarma-calls";

const columns =
  "icomfly_order_id,order_number:payload->>order_number,shopify_display_number:payload->>shopify_display_number,store_web_seq:payload->>store_web_seq,tracking_number:payload->>tracking_number,ad_origin:payload->ad_origin,labels:payload->labels,sales_channel:payload->>sales_channel,creator:payload->atribucion->creo->>nombre";
type Raw = Record<string, unknown>;
async function pages(
  query: (
    start: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Raw[]> {
  const rows: Raw[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await query(start);
    if (error)
      throw new Error("No se pudieron consultar los UTM de los pedidos.");
    rows.push(...((data ?? []) as Raw[]));
    if (!data || data.length < 1000) return rows;
  }
}
function savedOrigin(row: Raw, archive = false): MarketingOriginRow {
  const attrs =
    Array.isArray(row.note_attributes) && row.note_attributes.length
      ? row.note_attributes
      : row.raw_attrs;
  return {
    icomfly_order_id: String(row.shopify_order_id ?? row.shopify_id),
    order_number: row.name,
    shopify_display_number: row.name,
    store_web_seq: null,
    tracking_number: row.tracking_number,
    ad_origin: shopifyAdOrigin(attrs),
    originSource: archive ? "shopify_archive" : "shopify_saved",
  };
}
const savedColumns =
  "shopify_order_id,name,tracking_number,note_attributes,raw_attrs:raw_order->note_attributes";
const archiveColumns =
  "shopify_id,name:payload->>name,note_attributes:payload->note_attributes";

/**
 * Shopify se cerró el 28/10/2026: el último pedido guardado (shopify_orders y
 * el archivo) es del 03/11/2026 hora CR (04/11 02:34 UTC). Después de esta
 * fecha esas tablas no tienen pedidos, así que no se consultan.
 *
 * POR QUÉ IMPORTA (25/11/2026): la base de Kairo (tamaño Small) dejó de
 * responder 2 h 20 min. Lo que más la cargaba era buscar el origen de cada
 * pedido abierto en el archivo de Shopify por `payload->>name`: sin índice,
 * recorre los 26 mil pedidos (721 MB de JSON) y tarda ~12 s, para no
 * encontrar nada, porque los pedidos IC- solo existen en iComfly.
 */
export const SHOPIFY_SIN_PEDIDOS_DESDE = "2026-11-05";

/** Nombres que Kairo les pone a los pedidos de iComfly: nunca están en Shopify. */
const pedidoSoloIcomfly = (name: string) => /^#?IC-/i.test(name.trim());

/** Read only completed, explicit replacement links. No joins by customer/phone/product. */
async function replacementOrigins(
  storeId: number,
): Promise<MarketingOriginRow[]> {
  const receipts = await pages((start) =>
    getDB()
      .from("order_upsell_replacements")
      .select("original_id,replacement_id,replacement_name")
      .eq("store_id", storeId)
      .not("completed_at", "is", null)
      .order("created_at")
      .range(start, start + 999),
  );
  if (!receipts.length) return [];
  const ids = Array.from(
    new Set(
      receipts.flatMap((r) => [
        String(r.original_id),
        String(r.replacement_id),
      ]),
    ),
  );
  const originals: MarketingOriginRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await getDB()
      .from("icomfly_order_payloads")
      .select(columns)
      .eq("store_id", storeId)
      .in("icomfly_order_id", ids.slice(i, i + 100));
    if (error) throw new Error("No se pudo recuperar el origen del upsell.");
    originals.push(...((data ?? []) as unknown as MarketingOriginRow[]));
  }
  const byId = new Map(originals.map((r) => [r.icomfly_order_id, r]));
  const ancestors = (
    id: string,
    seen = new Set<string>(),
  ): MarketingOriginRow[] => {
    if (seen.has(id) || seen.size >= 30) return [];
    const next = new Set(seen).add(id),
      row = byId.get(id);
    return [
      ...(row ? [row] : []),
      ...receipts
        .filter((r) => String(r.replacement_id) === id)
        .flatMap((r) => ancestors(String(r.original_id), next)),
    ];
  };
  return receipts.flatMap((r) =>
    ancestors(String(r.original_id)).map((source) => ({
      ...source,
      originalShopifyNumber: source.shopify_display_number,
      originalIcomflyId: source.icomfly_order_id,
      originalOrderNumber: source.order_number,
      icomfly_order_id: String(r.replacement_id),
      order_number: r.replacement_name,
      shopify_display_number: r.replacement_name,
      store_web_seq: null,
      tracking_number: null,
      originSource: "upsell_original" as const,
    })),
  );
}
/**
 * iComfly ids of the orders Kairo created from Leads ("Crear en iComfly"),
 * from its own receipts. iComfly sometimes keeps those "MANUAL-…" orders
 * without creator (10 of them on 19–26/11/2026, all with a receipt): with this
 * they count as "Desde Leads en Kairo" instead of "Manual sin creador".
 * Fail-soft: without the receipts they stay as before.
 */
async function kairoLeadOrderIds(storeId: number): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    for (let start = 0; start < 50_000; start += 1000) {
      const { data, error } = await getDB()
        .from("lead_icomfly_receipts")
        .select("icomfly_id")
        .eq("store_id", storeId)
        .not("icomfly_id", "is", null)
        .order("icomfly_id")
        .range(start, start + 999);
      if (error || !data) break;
      for (const row of data as Array<{ icomfly_id: unknown }>)
        if (row.icomfly_id != null) ids.add(String(row.icomfly_id));
      if (data.length < 1000) break;
    }
  } catch {
    // Sin recibos: los MANUAL sin creador quedan como "Manual sin creador".
  }
  return ids;
}

export async function listMarketingOrigins(
  storeId: number,
  from: string,
  to: string,
): Promise<MarketingOriginRow[]> {
  // Raw JSON dates contain offsets. Pad retrieval; the canonical cohort enforces exact dates.
  const lower = new Date(Date.parse(from) - 86400000)
    .toISOString()
    .slice(0, 10);
  const upper = new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10);
  // Un período posterior al cierre de Shopify no tiene nada en sus tablas.
  const conShopify = lower < SHOPIFY_SIN_PEDIDOS_DESDE;
  const [native, saved, archive, inherited, catalog, kairoLeads] = await Promise.all([
    pages((start) =>
      getDB()
        .from("icomfly_order_payloads")
        .select(columns)
        .eq("store_id", storeId)
        .gte("payload->>created_at", lower)
        .lt("payload->>created_at", upper)
        .order("icomfly_order_id")
        .range(start, start + 999),
    ),
    conShopify
      ? pages((start) =>
          getDB()
            .from("shopify_orders")
            .select(savedColumns)
            .eq("store_id", storeId)
            .gte("shopify_created_at", from)
            .lt("shopify_created_at", to)
            .order("shopify_order_id")
            .range(start, start + 999),
        )
      : Promise.resolve([] as Raw[]),
    conShopify
      ? pages((start) =>
          getDB()
            .from("shopify_archivo")
            .select(archiveColumns)
            .eq("store_id", storeId)
            .eq("recurso", "order")
            .gte("payload->>created_at", lower)
            .lt("payload->>created_at", upper)
            .order("shopify_id")
            .range(start, start + 999),
        )
      : Promise.resolve([] as Raw[]),
    replacementOrigins(storeId),
    readOriginCatalog(storeId),
    kairoLeadOrderIds(storeId),
  ]);
  return [
    ...(native as unknown as MarketingOriginRow[]).map((r) => ({
      ...r,
      originSource: "icomfly" as const,
    })),
    ...saved.map((r) => savedOrigin(r)),
    ...archive.map((r) => savedOrigin(r, true)),
    ...inherited,
  ].map((row) => {
    const origin = readIcomflyAdOrigin(row.ad_origin);
    // The upsell rows carry the replacement's id: the original's decides.
    const ownId =
      row.originSource === "upsell_original"
        ? row.originalIcomflyId
        : row.originSource === "icomfly"
          ? row.icomfly_order_id
          : null;
    return {
      ...row,
      kairoLead: ownId != null && kairoLeads.has(String(ownId)),
      resolvedOrigin: origin ? resolveOriginCampaign(origin, catalog) : null,
    };
  });
}

export async function orderMarketingOrigin(storeId: number, orderName: string) {
  const filter = filtrosPedidoIcomfly(orderName);
  if (!filter) return null;
  const name = orderName.trim().replace(/^#/, "");
  const names = [name, "#" + name];
  // Un pedido IC- es de iComfly: ni shopify_orders ni el archivo lo tienen.
  const none = Promise.resolve({ data: [] as Raw[], error: null });
  const soloIcomfly = pedidoSoloIcomfly(orderName);
  const [native, saved, archive, inherited, catalog] = await Promise.all([
    getDB()
      .from("icomfly_order_payloads")
      .select(columns)
      .eq("store_id", storeId)
      .or(filter)
      .limit(2),
    soloIcomfly
      ? none
      : getDB()
          .from("shopify_orders")
          .select(savedColumns)
          .eq("store_id", storeId)
          .in("name", names)
          .limit(2),
    soloIcomfly
      ? none
      : getDB()
          .from("shopify_archivo")
          .select(archiveColumns)
          .eq("store_id", storeId)
          .eq("recurso", "order")
          .in("payload->>name", names)
          .limit(2),
    replacementOrigins(storeId),
    readOriginCatalog(storeId),
  ]);
  if (native.error || saved.error || archive.error)
    throw new Error("No se pudo consultar el origen publicitario.");
  if ([native, saved, archive].some((r) => (r.data?.length ?? 0) > 1))
    return null;
  const rows = [
    ...((native.data ?? []) as unknown as MarketingOriginRow[]),
    ...(saved.data ?? []).map((r) => savedOrigin(r)),
    ...(archive.data ?? []).map((r) => savedOrigin(r, true)),
    ...inherited.filter(
      (r) =>
        String(r.shopify_display_number).replace(/^#/, "").toUpperCase() ===
        name.toUpperCase(),
    ),
  ];
  const merged = mergeAdOrigins(
    rows
      .map((r) => readIcomflyAdOrigin(r.ad_origin))
      .filter((r) => r !== null)
      .map((o) => resolveOriginCampaign(o, catalog)),
  );
  return merged.ambiguous ? null : merged.origin;
}
