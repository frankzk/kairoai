import { getShopifyCredentials, type FinanceStoreConfig } from "@/lib/stores";
import { type PersistedShopifyOrder } from "@/lib/finance";

export const DEFAULT_CREATED_AT_MIN_BY_STORE: Record<string, string> = {
  "mireva-cr": "2026-01-01T00:00:00-06:00",
  "mireva-hn": "2025-12-01T00:00:00-06:00",
};
export const DEFAULT_SYNC_PAGES_PER_REQUEST = 8;
export const MAX_SYNC_PAGES_PER_REQUEST = 12;
// Shopify REST permite ~2 req/s; un respiro entre paginas evita 429 en rafaga.
export const PAGE_DELAY_MS = 350;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchShopifyPage(url: string, store: FinanceStoreConfig): Promise<Response> {
  const { token } = getShopifyCredentials(store);
  const doFetch = () =>
    fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

  let res = await doFetch();
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || 1.2);
    await sleep(Math.min(Math.max(retryAfter, 0.5), 5) * 1000);
    res = await doFetch();
  }
  return res;
}

export function getDefaultCreatedAtMin(store: FinanceStoreConfig): string {
  return DEFAULT_CREATED_AT_MIN_BY_STORE[store.code] ?? DEFAULT_CREATED_AT_MIN_BY_STORE["mireva-cr"];
}

const SHOPIFY_ORDER_FIELDS = [
  "id",
  "order_number",
  "name",
  "email",
  "phone",
  "financial_status",
  "fulfillment_status",
  "cancelled_at",
  "note",
  "note_attributes",
  "total_price",
  "currency",
  "line_items",
  "customer",
  "billing_address",
  "shipping_address",
  "fulfillments",
  "created_at",
  "updated_at",
].join(",");

function resolveShopifyShop(store: FinanceStoreConfig): string {
  const { shop, token, missing } = getShopifyCredentials(store);
  if (!shop || !token) {
    throw new Error(
      `Shopify ${store.shortLabel} no configurado: faltan ${missing.join(" y ")} en Vercel.`
    );
  }
  return shop;
}

export function buildInitialUrl(
  createdAtMin: string,
  createdAtMax: string | undefined,
  store: FinanceStoreConfig
): string {
  const shop = resolveShopifyShop(store);

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    order: "created_at desc",
    created_at_min: createdAtMin,
    fields: SHOPIFY_ORDER_FIELDS,
  });
  if (createdAtMax) params.set("created_at_max", createdAtMax);
  return `https://${shop}/admin/api/2024-01/orders.json?${params.toString()}`;
}

// Re-consulta un lote de pedidos por id exacto, sin ventana de tiempo.
// status=any incluye anulados/cerrados: es la unica forma de descongelar
// un pedido que quedo "Pendiente" en Kairo pero ya fue anulado en Shopify
// hace mas de la ventana incremental (updated_at_min nunca lo vuelve a traer).
export function buildByIdsUrl(ids: string[], store: FinanceStoreConfig): string {
  const shop = resolveShopifyShop(store);

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    ids: ids.join(","),
    fields: SHOPIFY_ORDER_FIELDS,
  });
  return `https://${shop}/admin/api/2024-01/orders.json?${params.toString()}`;
}

export function buildUpdatedUrl(updatedAtMin: string, store: FinanceStoreConfig): string {
  const shop = resolveShopifyShop(store);

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    order: "updated_at desc",
    updated_at_min: updatedAtMin,
    fields: SHOPIFY_ORDER_FIELDS,
  });
  return `https://${shop}/admin/api/2024-01/orders.json?${params.toString()}`;
}

export function mapShopifyOrder(
  order: Record<string, unknown>
): Omit<PersistedShopifyOrder, "id" | "synced_at" | "store_id"> {
  const customer = order.customer as Record<string, unknown> | undefined;
  const billing = order.billing_address as Record<string, unknown> | undefined;
  const shipping = order.shipping_address as Record<string, unknown> | undefined;
  const lineItems = (order.line_items as Array<Record<string, unknown>>) ?? [];

  const firstName = (customer?.first_name as string) ?? (billing?.first_name as string) ?? "";
  const lastName = (customer?.last_name as string) ?? (billing?.last_name as string) ?? "";
  const phone =
    (order.phone as string | null) ??
    (shipping?.phone as string | null) ??
    (billing?.phone as string | null) ??
    (customer?.phone as string | null) ??
    null;

  // Guia/transportadora del fulfillment mas reciente con tracking.
  const fulfillments = ((order.fulfillments as Array<Record<string, unknown>>) ?? [])
    .filter((f) => f.tracking_number || (Array.isArray(f.tracking_numbers) && f.tracking_numbers.length))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const latestFulfillment = fulfillments[0];
  const trackingNumbers = Array.isArray(latestFulfillment?.tracking_numbers)
    ? (latestFulfillment?.tracking_numbers as unknown[])
    : [];
  const trackingNumber = String(
    latestFulfillment?.tracking_number ?? trackingNumbers[0] ?? ""
  ).trim();
  const trackingCompany = String(latestFulfillment?.tracking_company ?? "").trim();

  return {
    shopify_order_id: String(order.id ?? ""),
    order_number: order.order_number ? Number(order.order_number) : null,
    name: String(order.name ?? ""),
    customer_name: `${firstName} ${lastName}`.trim() || "Sin nombre",
    first_name: firstName,
    last_name: lastName,
    phone,
    email: (order.email as string | null) ?? null,
    financial_status: String(order.financial_status ?? ""),
    fulfillment_status: String(order.fulfillment_status ?? ""),
    cancelled_at: (order.cancelled_at as string | null) ?? null,
    total_price: Number(order.total_price ?? 0),
    currency: String(order.currency ?? "CRC"),
    note: String(order.note ?? ""),
    note_attributes: ((order.note_attributes as Array<Record<string, unknown>>) ?? []).map(
      (attribute) => ({
        name: String(attribute.name ?? ""),
        value: String(attribute.value ?? ""),
      })
    ),
    tracking_number: trackingNumber,
    tracking_company: trackingCompany,
    line_items: lineItems.map((item) => ({
      sku: String(item.sku ?? ""),
      title: String(item.title ?? ""),
      quantity: Number(item.quantity ?? 0),
      price: Number(item.price ?? 0),
    })),
    raw_order: order,
    shopify_created_at: (order.created_at as string | null) ?? null,
    shopify_updated_at: (order.updated_at as string | null) ?? null,
  };
}
