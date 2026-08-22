import { getDB } from "@/lib/db";
import { DEFAULT_FINANCE_STORE_ID } from "./store-config";
import { getShopifyCredentials, getStoreConfig, type FinanceStoreConfig } from "./stores";
import type { SettlementRow } from "./finance-types";

// Campos que una fila de liquidacion toma de su pedido Shopify emparejado (o se
// limpian si no hay match). Fuente unica compartida por el re-emparejar
// automatico (rematch) y el match manual, para que ambos escriban IDENTICO.
export type SettlementMatchFields = Pick<
  SettlementRow,
  | "match_status"
  | "shopify_order_id"
  | "shopify_order_name"
  | "shopify_financial_status"
  | "shopify_fulfillment_status"
  | "shopify_total"
  | "shopify_created_at"
  | "order_items"
>;

export function settlementShopifyMatchFields(
  shopify: MatchableShopifyOrder | null | undefined
): SettlementMatchFields {
  if (!shopify) {
    return {
      match_status: "unmatched",
      shopify_order_id: "",
      shopify_order_name: "",
      shopify_financial_status: "",
      shopify_fulfillment_status: "",
      shopify_total: 0,
      shopify_created_at: null,
      order_items: [],
    };
  }
  return {
    match_status: "matched",
    shopify_order_id: String(shopify.id),
    shopify_order_name: shopify.name,
    shopify_financial_status: shopify.financial_status ?? "",
    shopify_fulfillment_status: shopify.fulfillment_status ?? "",
    shopify_total: Number(shopify.total_price ?? 0),
    shopify_created_at: shopify.created_at || null,
    order_items: (shopify.line_items ?? []).map((item) => ({
      sku: String(item.sku ?? "").toLowerCase(),
      title: String(item.title ?? ""),
      quantity: Number(item.quantity ?? 0),
      price: Number(item.price ?? 0),
    })),
  };
}

export interface MatchableShopifyOrder {
  id: number;
  name: string;
  order_number: number;
  note?: string | null;
  note_attributes?: Array<{ name?: string | null; value?: string | null }>;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  total_price: string;
  line_items?: Array<{
    sku?: string | null;
    title?: string;
    quantity?: number;
    price?: string | number;
  }>;
}

// Busca UN pedido persistido de Shopify por referencia (#MCRC16498, 16498 o
// MCRC16498), para el match manual de liquidaciones. Prioriza order_number
// (numérico, confiable) y cae al nombre exacto. Devuelve null si no existe.
export async function getPersistedShopifyOrderForMatch(
  storeId: number,
  ref: string
): Promise<MatchableShopifyOrder | null> {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  const columns =
    "shopify_order_id, order_number, name, financial_status, fulfillment_status, cancelled_at, total_price, shopify_created_at, line_items";
  const query = () => getDB().from("shopify_orders").select(columns).eq("store_id", storeId);

  let row: Record<string, unknown> | null = null;
  if (digits) {
    const { data, error } = await query().eq("order_number", Number(digits)).limit(1).maybeSingle();
    if (error) throw new Error(`getPersistedShopifyOrderForMatch: ${error.message}`);
    row = (data as Record<string, unknown> | null) ?? null;
  }
  if (!row) {
    const name = `#${raw.replace(/^#+/, "")}`;
    const { data } = await query().eq("name", name).limit(1).maybeSingle();
    row = (data as Record<string, unknown> | null) ?? null;
  }
  if (!row) return null;
  return {
    id: Number(row.shopify_order_id),
    name: String(row.name ?? ""),
    order_number: Number(row.order_number ?? 0),
    created_at: (row.shopify_created_at as string) ?? "",
    financial_status: String(row.financial_status ?? ""),
    fulfillment_status: (row.fulfillment_status as string) || null,
    cancelled_at: (row.cancelled_at as string) ?? null,
    total_price: String(row.total_price ?? 0),
    line_items: (row.line_items as MatchableShopifyOrder["line_items"]) ?? [],
  };
}

const DB_PAGE_SIZE = 1000;
const GAP_MAX_PAGES = 10;
const FALLBACK_MAX_PAGES = 30;
const FALLBACK_CREATED_AT_MIN = "2026-01-01T00:00:00-06:00";

// Pedir miles de pedidos a la API de Shopify durante una importacion excede el
// limite de tiempo de Vercel; la base de pedidos vive en la tabla
// shopify_orders (boton "Sync Shopify") y la API solo se consulta para el
// tramo posterior a la ultima sincronizacion.
export async function loadShopifyOrdersForMatching(
  periodStart: string | null,
  storeId = DEFAULT_FINANCE_STORE_ID,
  options: { includeFreshShopify?: boolean; fallbackToShopify?: boolean } = {}
): Promise<MatchableShopifyOrder[]> {
  const includeFreshShopify = options.includeFreshShopify ?? true;
  const fallbackToShopify = options.fallbackToShopify ?? true;
  const store = getStoreConfig(String(storeId === 2 ? "mireva-hn" : "mireva-cr"));
  const { orders: persisted, latestUpdatedAt } = await listPersistedOrdersSlim(store.id);
  if (!persisted.length) {
    if (!fallbackToShopify) return [];
    const minDate = periodStart
      ? new Date(new Date(periodStart).getTime() - 45 * 24 * 60 * 60 * 1000).toISOString()
      : FALLBACK_CREATED_AT_MIN;
    return fetchOrdersFromShopify({ createdAtMin: minDate }, FALLBACK_MAX_PAGES, store);
  }

  if (!includeFreshShopify) return persisted;

  const latestCreatedAt = persisted.reduce(
    (max, order) => (order.created_at > max ? order.created_at : max),
    ""
  );
  // Pedidos nuevos + pedidos viejos editados (p. ej. notas "Pedido <codigo>"
  // agregadas a mano para forzar el match) desde la ultima sincronizacion.
  const [freshCreated, freshUpdated] = await Promise.all([
    latestCreatedAt
      ? fetchOrdersFromShopify({ createdAtMin: latestCreatedAt }, GAP_MAX_PAGES, store)
      : Promise.resolve([] as MatchableShopifyOrder[]),
    latestUpdatedAt
      ? fetchOrdersFromShopify({ updatedAtMin: latestUpdatedAt }, GAP_MAX_PAGES, store)
      : Promise.resolve([] as MatchableShopifyOrder[]),
  ]);

  const byId = new Map<number, MatchableShopifyOrder>();
  for (const order of persisted) byId.set(order.id, order);
  for (const order of freshCreated) byId.set(order.id, order);
  for (const order of freshUpdated) byId.set(order.id, order);
  return Array.from(byId.values());
}

interface PersistedOrderSlim {
  shopify_order_id: string;
  order_number: number | null;
  name: string;
  financial_status: string;
  fulfillment_status: string;
  cancelled_at: string | null;
  total_price: number;
  shopify_created_at: string | null;
  shopify_updated_at: string | null;
  line_items: Array<{ sku: string; title: string; quantity: number; price: number }> | null;
  note: string | null;
  note_attributes: Array<{ name?: string | null; value?: string | null }> | null;
}

async function listPersistedOrdersSlim(storeId: number): Promise<{
  orders: MatchableShopifyOrder[];
  latestUpdatedAt: string;
}> {
  const orders: MatchableShopifyOrder[] = [];
  let latestUpdatedAt = "";
  // Camino rapido sin tocar raw_order (requiere migracion 0003); extraer del
  // JSONB completo por fila dispara el statement timeout con 10k+ pedidos.
  const FAST_COLUMNS =
    "shopify_order_id, order_number, name, financial_status, fulfillment_status, cancelled_at, total_price, shopify_created_at, shopify_updated_at, line_items, note, note_attributes";
  const LEGACY_COLUMNS =
    "shopify_order_id, order_number, name, financial_status, fulfillment_status, cancelled_at, total_price, shopify_created_at, shopify_updated_at, line_items, note:raw_order->>note, note_attributes:raw_order->note_attributes";
  let useLegacyColumns = false;
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const fetchPage = (columns: string) =>
      getDB()
        .from("shopify_orders")
        .select(columns)
        .eq("store_id", storeId)
        .order("id", { ascending: true })
        .range(from, from + DB_PAGE_SIZE - 1);

    let result = await fetchPage(useLegacyColumns ? LEGACY_COLUMNS : FAST_COLUMNS);
    if (
      result.error &&
      !useLegacyColumns &&
      /note/.test(result.error.message) &&
      /does not exist|42703/.test(result.error.message)
    ) {
      useLegacyColumns = true;
      result = await fetchPage(LEGACY_COLUMNS);
    }
    if (result.error) throw new Error(`listPersistedOrdersSlim: ${result.error.message}`);

    const page = (result.data ?? []) as unknown as PersistedOrderSlim[];
    for (const row of page) {
      if (row.shopify_updated_at && row.shopify_updated_at > latestUpdatedAt) {
        latestUpdatedAt = row.shopify_updated_at;
      }
      orders.push({
        id: Number(row.shopify_order_id),
        name: row.name,
        order_number: Number(row.order_number ?? 0),
        note: row.note,
        note_attributes: row.note_attributes ?? [],
        // Cadena vacia (no null): los matchers comparan strings, y los
        // builders de filas la convierten a null antes de insertar.
        created_at: row.shopify_created_at ?? "",
        financial_status: row.financial_status,
        fulfillment_status: row.fulfillment_status || null,
        cancelled_at: row.cancelled_at,
        total_price: String(row.total_price ?? 0),
        line_items: row.line_items ?? [],
      });
    }
    if (page.length < DB_PAGE_SIZE) break;
  }
  return { orders, latestUpdatedAt };
}

async function fetchOrdersFromShopify(
  filters: { createdAtMin?: string; updatedAtMin?: string },
  maxPages: number,
  store: FinanceStoreConfig
): Promise<MatchableShopifyOrder[]> {
  const { shop, token } = getShopifyCredentials(store);
  if (!shop || !token) return [];

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    order: filters.updatedAtMin ? "updated_at desc" : "created_at desc",
    fields:
      "id,name,order_number,note,note_attributes,created_at,financial_status,fulfillment_status,cancelled_at,total_price,line_items",
  });
  if (filters.createdAtMin) params.set("created_at_min", filters.createdAtMin);
  if (filters.updatedAtMin) params.set("updated_at_min", filters.updatedAtMin);

  let url = `https://${shop}/admin/api/2024-01/orders.json?${params.toString()}`;

  const orders: MatchableShopifyOrder[] = [];
  for (let page = 0; page < maxPages && url; page++) {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) break;

    const json = (await res.json()) as { orders?: MatchableShopifyOrder[] };
    orders.push(...(json.orders ?? []));

    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? "";
  }
  return orders;
}
