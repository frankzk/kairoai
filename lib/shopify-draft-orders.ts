import type { FinanceStoreConfig } from "./stores";
import { getShopifyCredentials } from "./stores";

const SHOPIFY_API_VERSION = "2024-01";
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
export const SHOPIFY_DRAFT_ACTIVE_DAYS = 30;

export interface ShopifyDraftCart {
  id: string;
  name: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  products: string;
  itemCount: number;
  total: number;
  currency: string;
  status: string;
  invoiceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ShopifyDraftOrdersError extends Error {
  constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message);
    this.name = "ShopifyDraftOrdersError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function mapShopifyDraftOrder(raw: Record<string, unknown>): ShopifyDraftCart {
  const customer = asRecord(raw.customer);
  const billing = asRecord(raw.billing_address);
  const shipping = asRecord(raw.shipping_address);
  const firstName =
    asString(customer?.first_name) ||
    asString(shipping?.first_name) ||
    asString(billing?.first_name);
  const lastName =
    asString(customer?.last_name) ||
    asString(shipping?.last_name) ||
    asString(billing?.last_name);
  const lineItems = Array.isArray(raw.line_items)
    ? (raw.line_items as Array<Record<string, unknown>>)
    : [];

  const products = lineItems
    .map((item) => {
      const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
      const title = asString(item.title) || asString(item.name);
      return title ? `${quantity}x ${title}` : "";
    })
    .filter(Boolean)
    .join(", ");

  return {
    id: String(raw.id ?? ""),
    name: asString(raw.name) || `#D${String(raw.id ?? "")}`,
    customerName: `${firstName} ${lastName}`.trim() || "Sin nombre",
    phone:
      asString(raw.phone) ||
      asString(customer?.phone) ||
      asString(shipping?.phone) ||
      asString(billing?.phone) ||
      null,
    email: asString(raw.email) || asString(customer?.email) || null,
    products,
    itemCount: lineItems.reduce(
      (total, item) => total + Math.max(1, Number(item.quantity ?? 1) || 1),
      0
    ),
    total: Number(raw.total_price ?? 0) || 0,
    currency: asString(raw.currency),
    status: asString(raw.status) || "open",
    invoiceUrl: asString(raw.invoice_url) || null,
    createdAt: asString(raw.created_at),
    updatedAt: asString(raw.updated_at) || asString(raw.created_at),
  };
}

function nextLink(linkHeader: string | null): string | null {
  const match = String(linkHeader ?? "").match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchShopifyPage(
  url: string,
  headers: Record<string, string>
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers, cache: "no-store" });
      lastResponse = response;
      if (response.status !== 429 && response.status < 500) return response;
      const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1));
    } catch (error) {
      if (attempt === 2) {
        const message =
          error instanceof Error ? error.message : "Error desconocido";
        throw new ShopifyDraftOrdersError(`Red: ${message}`);
      }
      await sleep(500 * (attempt + 1));
    }
  }
  return lastResponse as Response;
}

export async function fetchOpenShopifyDraftOrders(
  store: FinanceStoreConfig,
  options: { updatedAtMin?: string | null } = {}
): Promise<ShopifyDraftCart[]> {
  const { shop, token, missing } = getShopifyCredentials(store);
  if (!shop || !token) {
    throw new ShopifyDraftOrdersError(
      `Shopify ${store.shortLabel} no configurado: faltan ${missing.join(" y ")} en Vercel.`,
      503
    );
  }

  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };
  const rawOrders: Record<string, unknown>[] = [];
  const params = new URLSearchParams({
    status: "open",
    limit: String(PAGE_SIZE),
  });
  const defaultUpdatedAtMin = new Date(
    Date.now() - SHOPIFY_DRAFT_ACTIVE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const updatedAtMin =
    options.updatedAtMin === undefined
      ? defaultUpdatedAtMin
      : options.updatedAtMin;
  if (updatedAtMin) params.set("updated_at_min", updatedAtMin);
  let url: string | null =
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/draft_orders.json?${params.toString()}`;

  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    const response = await fetchShopifyPage(url, headers);

    if (!response.ok) {
      const body = await response.text();
      throw new ShopifyDraftOrdersError(
        `Shopify error ${response.status}: ${body.slice(0, 200)}`,
        response.status
      );
    }

    const body = (await response.json()) as { draft_orders?: unknown[] };
    for (const item of body.draft_orders ?? []) {
      const record = asRecord(item);
      if (record) rawOrders.push(record);
    }
    url = nextLink(response.headers.get("Link"));
  }

  if (url) {
    throw new ShopifyDraftOrdersError(
      `Shopify devolvio mas de ${MAX_PAGES * PAGE_SIZE} borradores abiertos; la sincronizacion se detuvo para no cerrar datos con una lista parcial.`,
      409
    );
  }

  return rawOrders
    .map(mapShopifyDraftOrder)
    .filter((order) => order.id && order.status === "open")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
