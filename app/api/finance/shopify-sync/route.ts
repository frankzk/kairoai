import { NextRequest, NextResponse } from "next/server";
import {
  getPersistedShopifyCoverage,
  listPersistedShopifyOrders,
  upsertPersistedShopifyOrders,
  type PersistedShopifyOrder,
} from "@/lib/finance";
import {
  getRequiredStoreFromBody,
  getRequiredStoreFromSearchParams,
  getShopifyCredentials,
  type FinanceStoreConfig,
} from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_CREATED_AT_MIN_BY_STORE: Record<string, string> = {
  "mireva-cr": "2026-01-01T00:00:00-06:00",
  "mireva-hn": "2025-12-09T00:00:00-06:00",
};
const DEFAULT_SYNC_PAGES_PER_REQUEST = 8;
const MAX_SYNC_PAGES_PER_REQUEST = 12;
const MAX_GET_LIMIT = 4000;
// Shopify REST permite ~2 req/s; un respiro entre paginas evita 429 en rafaga.
const PAGE_DELAY_MS = 350;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  try {
    const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || 1000);
    const offset = Math.max(Number(req.nextUrl.searchParams.get("offset") || 0), 0);
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_GET_LIMIT);
    const [orders, coverage] = await Promise.all([
      listPersistedShopifyOrders(limit + 1, offset, store.id),
      getPersistedShopifyCoverage(store.id),
    ]);
    const pageOrders = orders.slice(0, limit);
    const hasMore = orders.length > limit;
    return NextResponse.json({
      orders: pageOrders,
      total: pageOrders.length,
      coverage,
      store: store.code,
      offset,
      limit,
      has_more: hasMore,
      next_offset: hasMore ? offset + pageOrders.length : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer pedidos Shopify sincronizados";
    return NextResponse.json({ orders: [], total: 0, coverage: null, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const store = getRequiredStoreFromBody(body);
    if (!store) return missingStoreResponse();
    const maxPages = Math.min(
      Math.max(Number(body.max_pages ?? DEFAULT_SYNC_PAGES_PER_REQUEST), 1),
      MAX_SYNC_PAGES_PER_REQUEST
    );
    const mode = body.mode === "backfill" ? "backfill" : "forward";
    const createdAtMin = String(body.created_at_min ?? getDefaultCreatedAtMin(store));

    let url: string;
    if (typeof body.next_url === "string" && body.next_url) {
      url = body.next_url;
    } else if (mode === "backfill") {
      // Continua hacia atras desde el pedido mas viejo ya sincronizado, asi
      // cada llamada avanza aunque la anterior haya muerto a mitad de camino.
      const coverage = await getPersistedShopifyCoverage(store.id);
      if (!coverage.oldest) {
        url = buildInitialUrl(createdAtMin, undefined, store);
      } else if (coverage.oldest <= createdAtMin) {
        return NextResponse.json({ synced: 0, done: true, oldest: coverage.oldest, store: store.code });
      } else {
        // Se excluye el pedido frontera (ya sincronizado) restando un segundo,
        // para que cada llamada avance en vez de repetir la misma ventana.
        const beforeOldest = new Date(new Date(coverage.oldest).getTime() - 1000).toISOString();
        url = buildInitialUrl(createdAtMin, beforeOldest, store);
      }
    } else {
      url = buildInitialUrl(createdAtMin, undefined, store);
    }

    const rawOrders: Array<Record<string, unknown>> = [];
    let pagesChecked = 0;
    for (let page = 0; page < maxPages && url; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS);
      const res = await fetchShopifyPage(url, store);

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json(
          { error: `Shopify error ${res.status}: ${text.slice(0, 200)}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      rawOrders.push(...((data.orders as Array<Record<string, unknown>>) ?? []));
      pagesChecked += 1;

      const link = res.headers.get("link") ?? "";
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch?.[1] ?? "";
    }

    const orders = rawOrders.map(mapShopifyOrder);
    await upsertPersistedShopifyOrders(orders, store.id);

    const oldestFetched = orders.reduce<string | null>((min, order) => {
      const created = order.shopify_created_at;
      if (!created) return min;
      return !min || created < min ? created : min;
    }, null);

    return NextResponse.json({
      synced: orders.length,
      next_url: url || null,
      partial: Boolean(url),
      done: mode === "backfill" && !url && orders.length === 0,
      oldest: oldestFetched,
      created_at_min: createdAtMin,
      pages_checked: pagesChecked,
      store: store.code,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando Shopify";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function missingStoreResponse() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}

async function fetchShopifyPage(url: string, store: FinanceStoreConfig): Promise<Response> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDefaultCreatedAtMin(store: FinanceStoreConfig): string {
  return DEFAULT_CREATED_AT_MIN_BY_STORE[store.code] ?? DEFAULT_CREATED_AT_MIN_BY_STORE["mireva-cr"];
}

function buildInitialUrl(
  createdAtMin: string,
  createdAtMax: string | undefined,
  store: FinanceStoreConfig
): string {
  const { shop, token, missing } = getShopifyCredentials(store);
  if (!shop || !token) {
    throw new Error(
      `Shopify ${store.shortLabel} no configurado: faltan ${missing.join(" y ")} en Vercel.`
    );
  }

  const fields = [
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

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    order: "created_at desc",
    created_at_min: createdAtMin,
    fields,
  });
  if (createdAtMax) params.set("created_at_max", createdAtMax);
  return `https://${shop}/admin/api/2024-01/orders.json?${params.toString()}`;
}

function mapShopifyOrder(
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
