// Credenciales de una tienda Shopify. Si no se pasan, se usan las del entorno por
// defecto (tienda legacy / Costa Rica), de modo que los llamadores existentes
// siguen funcionando sin cambios.
export interface ShopifyCreds {
  shop: string;
  token: string;
}

function resolveShopifyCreds(creds?: ShopifyCreds): ShopifyCreds {
  return {
    shop: creds?.shop || process.env.SHOPIFY_SHOP_DOMAIN || "",
    token: creds?.token || process.env.SHOPIFY_ACCESS_TOKEN || "",
  };
}

async function shopifyFetch<T>(
  path: string,
  options: RequestInit = {},
  creds?: ShopifyCreds
): Promise<T> {
  const { shop, token } = resolveShopifyCreds(creds);
  const res = await fetch(`https://${shop}/admin/api/2024-01${path}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...options.headers,
    },
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

export async function getOrder(orderId: string, creds?: ShopifyCreds): Promise<ShopifyOrder> {
  const data = await shopifyFetch<{ order: ShopifyOrder }>(
    `/orders/${orderId}.json`,
    {},
    creds
  );
  return data.order;
}

export async function addOrderTag(
  orderId: string,
  tag: string,
  creds?: ShopifyCreds
): Promise<ShopifyOrder> {
  const order = await getOrder(orderId, creds);
  const existingTags = order.tags ? order.tags.split(", ") : [];
  if (existingTags.includes(tag)) return order;
  const newTags = [...existingTags, tag].join(", ");

  const data = await shopifyFetch<{ order: ShopifyOrder }>(
    `/orders/${orderId}.json`,
    {
      method: "PUT",
      body: JSON.stringify({ order: { id: orderId, tags: newTags } }),
    },
    creds
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
  reason = "customer",
  creds?: ShopifyCreds
): Promise<void> {
  await shopifyFetch(
    `/orders/${orderId}/cancel.json`,
    {
      method: "POST",
      body: JSON.stringify({ reason, email: false }),
    },
    creds
  );
  await addOrderTag(orderId, "cancelado-kairo", creds);
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

// ─── Crear pedido desde el modulo de Leads (asesora cierra la venta) ─────────
// Crea un pedido COD "directo" reutilizando el mecanismo probado de Shopify:
// draft order -> completar con pago pendiente. Para la asesora es un solo paso
// (form -> confirmar -> pedido creado); no depende de scopes nuevos porque es
// el mismo camino que ya usan los upsells.

export interface ShopifyOrderAddress {
  first_name?: string;
  last_name?: string;
  address1?: string;
  address2?: string;
  city?: string; // canton
  province?: string; // provincia CR
  zip?: string;
  country?: string; // "Costa Rica"
  phone?: string;
}

export interface LeadOrderLineItem {
  variant_id?: number;
  sku?: string;
  title: string;
  price: string; // precio unitario (editable por la asesora)
  quantity: number;
}

export interface LeadOrderInput {
  line_items: LeadOrderLineItem[];
  phone?: string;
  email?: string;
  shipping_address?: ShopifyOrderAddress;
  note?: string;
  tags?: string; // "cerrado_por_asesora, kairo_leads"
  // Descuento a nivel de pedido (opcional).
  applied_discount?: {
    description?: string;
    value_type: "percentage" | "fixed_amount";
    value: string;
  };
}

// Busca un cliente existente en Shopify por telefono para precargar el form.
export interface ShopifyCustomerPrefill {
  found: boolean;
  name?: string;
  email?: string;
  province?: string;
  city?: string;
  address1?: string;
  zip?: string;
  orders_count?: number;
}

export async function findCustomerByPhone(
  phone: string,
  creds?: ShopifyCreds
): Promise<ShopifyCustomerPrefill> {
  if (!phone) return { found: false };
  // Search tolera formatos; probamos con y sin '+'.
  const query = encodeURIComponent(`phone:${phone} OR phone:+${phone}`);
  const data = await shopifyFetch<{
    customers: Array<{
      first_name?: string;
      last_name?: string;
      email?: string;
      orders_count?: number;
      default_address?: Record<string, string>;
      addresses?: Array<Record<string, string>>;
    }>;
  }>(`/customers/search.json?query=${query}&limit=1`, {}, creds).catch(() => ({ customers: [] }));
  const c = (data.customers ?? [])[0];
  if (!c) return { found: false };
  const addr = c.default_address ?? (c.addresses ?? [])[0] ?? {};
  return {
    found: true,
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || undefined,
    email: c.email || undefined,
    province: addr.province || undefined,
    city: addr.city || undefined,
    address1: addr.address1 || undefined,
    zip: addr.zip || undefined,
    orders_count: c.orders_count,
  };
}

export async function createLeadOrder(
  input: LeadOrderInput,
  creds?: ShopifyCreds
): Promise<{ order_id: number; name: string; total: string }> {
  // 1) Crear el borrador con lineas, envio, descuento, tags y nota.
  const draft = await shopifyFetch<{ draft_order: { id: number } }>(
    `/draft_orders.json`,
    { method: "POST", body: JSON.stringify({ draft_order: input }) },
    creds
  );
  // 2) Completarlo con pago PENDIENTE (COD).
  const completed = await shopifyFetch<{ draft_order: { id: number; order_id: number } }>(
    `/draft_orders/${draft.draft_order.id}/complete.json?payment_pending=true`,
    { method: "PUT", body: JSON.stringify({}) },
    creds
  );
  // 3) Leer nombre/total del pedido real resultante.
  const ord = await shopifyFetch<{ order: { id: number; name: string; total_price: string } }>(
    `/orders/${completed.draft_order.order_id}.json?fields=id,name,total_price`,
    {},
    creds
  );
  return { order_id: ord.order.id, name: ord.order.name, total: ord.order.total_price };
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
