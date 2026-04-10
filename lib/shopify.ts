const SHOPIFY_BASE_URL = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01`;
const SHOPIFY_HEADERS = {
  "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
  "Content-Type": "application/json",
};

async function shopifyFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${SHOPIFY_BASE_URL}${path}`, {
    ...options,
    headers: { ...SHOPIFY_HEADERS, ...options.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  email: string;
  phone: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  tags: string;
  note: string | null;
  billing_address?: ShopifyAddress;
  shipping_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
  customer?: {
    id: number;
    first_name: string;
    last_name: string;
    phone: string | null;
  };
}

export interface ShopifyAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  country: string;
  phone: string | null;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: string;
}

export interface ShopifyCheckout {
  id: number;
  token: string;
  email: string;
  phone: string | null;
  total_price: string;
  line_items: ShopifyLineItem[];
  abandoned_checkout_url: string;
  customer?: {
    first_name: string;
    last_name: string;
    phone: string | null;
  };
}

// ─── Order Operations ───────────────────────────────────────────────────────

export async function getOrder(orderId: string): Promise<ShopifyOrder> {
  const data = await shopifyFetch<{ order: ShopifyOrder }>(
    `/orders/${orderId}.json`
  );
  return data.order;
}

export async function addOrderTag(
  orderId: string,
  tag: string
): Promise<ShopifyOrder> {
  const order = await getOrder(orderId);
  const existingTags = order.tags ? order.tags.split(", ") : [];
  if (existingTags.includes(tag)) return order;
  const newTags = [...existingTags, tag].join(", ");

  const data = await shopifyFetch<{ order: ShopifyOrder }>(
    `/orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({ order: { id: orderId, tags: newTags } }),
    }
  );
  return data.order;
}

export async function addOrderNote(
  orderId: string,
  note: string
): Promise<ShopifyOrder> {
  const data = await shopifyFetch<{ order: ShopifyOrder }>(
    `/orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({ order: { id: orderId, note } }),
    }
  );
  return data.order;
}

export async function cancelOrder(
  orderId: string,
  reason = "customer"
): Promise<void> {
  await shopifyFetch(`/orders/${orderId}/cancel.json`, {
    method: "POST",
    body: JSON.stringify({ reason, email: false }),
  });
  await addOrderTag(orderId, "cancelado-kairo");
}

export async function confirmOrder(orderId: string): Promise<ShopifyOrder> {
  const order = await addOrderTag(orderId, "confirmado-kairo");
  await addOrderNote(
    orderId,
    `Pedido confirmado por agente de voz Milagros (Kairo AI) el ${new Date().toLocaleString("es-PE")}`
  );
  return order;
}

// ─── Draft Orders (Upsell) ──────────────────────────────────────────────────

export interface DraftOrderInput {
  customer_id?: number;
  email?: string;
  phone?: string;
  line_items: Array<{
    variant_id?: number;
    sku?: string;
    title: string;
    price: string;
    quantity: number;
  }>;
  note?: string;
}

export async function createDraftOrder(
  input: DraftOrderInput
): Promise<{ id: number; invoice_url: string }> {
  const data = await shopifyFetch<{
    draft_order: { id: number; invoice_url: string };
  }>(`/draft_orders.json`, {
    method: "POST",
    body: JSON.stringify({ draft_order: input }),
  });
  return data.draft_order;
}

export async function completeDraftOrder(
  draftOrderId: string
): Promise<{ id: number; order_id: number }> {
  const data = await shopifyFetch<{
    draft_order: { id: number; order_id: number };
  }>(`/draft_orders/${draftOrderId}/complete.json`, {
    method: "PUT",
    body: JSON.stringify({ payment_gateway: "cod" }),
  });
  return data.draft_order;
}

// ─── HMAC Validation ────────────────────────────────────────────────────────

export function validateShopifyHmac(
  rawBody: string,
  hmacHeader: string
): boolean {
  const crypto = require("crypto") as typeof import("crypto");
  const digest = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET!)
    .update(rawBody, "utf8")
    .digest("base64");
  return digest === hmacHeader;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatOrderSummary(order: ShopifyOrder): string {
  const items = order.line_items
    .map((li) => `${li.quantity}x ${li.title} (${li.price} ${order.currency})`)
    .join(", ");
  const addr = order.shipping_address;
  const address = addr
    ? `${addr.address1}, ${addr.city}, ${addr.country}`
    : "sin dirección";
  return `Pedido #${order.order_number}: ${items}. Dirección: ${address}. Total: ${order.total_price} ${order.currency}.`;
}
