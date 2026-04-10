import { NextRequest, NextResponse } from "next/server";
import { validateShopifyHmac, getOrder, type ShopifyOrder } from "@/lib/shopify";
import { createOutboundCall } from "@/lib/retell";
import { checkDedup, setDedup, saveCallRecord, findBestUpsellRule } from "@/lib/db";

export const runtime = "nodejs";

// Shopify requires a response within 5 seconds.
// We validate, deduplicate, then fire the Retell call without awaiting it.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const event = req.nextUrl.searchParams.get("event") ?? topic;

  // ── 1. Validate HMAC ──────────────────────────────────────────────────────
  if (!validateShopifyHmac(rawBody, hmacHeader)) {
    console.warn("[shopify/webhook] Invalid HMAC — rejecting");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 2. Route by event type ────────────────────────────────────────────────
  if (event === "orders/create" || event === "orders_create") {
    // Don't await — Shopify needs < 5s response
    handleNewOrder(payload as unknown as ShopifyOrder).catch((err) =>
      console.error("[shopify/webhook] handleNewOrder error:", err)
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (event === "checkouts/create" || event === "checkouts_create") {
    handleAbandonedCheckout(payload).catch((err) =>
      console.error("[shopify/webhook] handleAbandonedCheckout error:", err)
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Unknown event — still respond 200 so Shopify doesn't retry
  return NextResponse.json({ received: true, event }, { status: 200 });
}

// ─── Handlers ──────────────────────────────────────────────────────────────

async function handleNewOrder(order: ShopifyOrder): Promise<void> {
  const orderId = String(order.id);
  const phone =
    order.phone ??
    order.billing_address?.phone ??
    order.shipping_address?.phone ??
    order.customer?.phone ??
    null;

  if (!phone) {
    console.warn(`[shopify/webhook] Order ${orderId} has no phone — skipping`);
    return;
  }

  const normalizedPhone = normalizePhone(phone);

  // ── Deduplicate ───────────────────────────────────────────────────────────
  const already = await checkDedup(normalizedPhone, orderId);
  if (already) {
    console.info(`[shopify/webhook] Duplicate: ${normalizedPhone}:${orderId} — skipping`);
    return;
  }
  await setDedup(normalizedPhone, orderId);

  const customerName =
    order.customer
      ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
      : order.billing_address
      ? `${order.billing_address.first_name} ${order.billing_address.last_name}`.trim()
      : "Cliente";

  const products = order.line_items
    .map((li) => `${li.quantity}x ${li.title}`)
    .join(", ");

  // Build shipping address string and check completeness
  const addr = order.shipping_address ?? order.billing_address;
  const shippingAddress = addr
    ? [addr.address1, addr.address2, addr.city, addr.province].filter(Boolean).join(", ")
    : "no disponible";
  // Address is considered complete if address1 contains both letters and numbers
  const addressComplete = addr?.address1
    ? /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(addr.address1) && /\d/.test(addr.address1)
    : false;

  // ── Look up best upsell rule for this order's SKUs ────────────────────────
  let upsellProductName = "";
  let upsellProductPrice = "";
  let upsellPitch = "";
  try {
    const skus = order.line_items.map((li) => li.sku).filter(Boolean) as string[];
    for (const sku of skus) {
      const rule = await findBestUpsellRule(sku);
      if (rule) {
        upsellProductName = rule.upsell_name;
        upsellProductPrice = String(rule.upsell_price);
        upsellPitch = rule.pitch;
        break;
      }
    }
  } catch {
    // Don't block the call if upsell lookup fails
  }

  // ── Create Retell call ────────────────────────────────────────────────────
  const { call_id } = await createOutboundCall({
    toPhone: normalizedPhone,
    metadata: {
      order_id: orderId,
      shop_domain: process.env.SHOPIFY_SHOP_DOMAIN ?? "",
      customer_name: customerName,
      products,
      total: `${order.total_price} ${order.currency}`,
      country: order.billing_address?.country ?? "PE",
      event_type: "order_confirmation",
      shipping_address: shippingAddress,
      address_complete: addressComplete,
      upsell_product_name: upsellProductName,
      upsell_product_price: upsellProductPrice,
      upsell_pitch: upsellPitch,
    },
  });

  // ── Save initial call record ──────────────────────────────────────────────
  await saveCallRecord({
    call_id,
    order_id: orderId,
    phone: normalizedPhone,
    customer_name: customerName,
    products,
    total: `${order.total_price} ${order.currency}`,
    country: order.billing_address?.country ?? "PE",
    status: "calling",
    upsell_accepted: false,
    duration_seconds: 0,
    started_at: new Date().toISOString(),
  });

  console.info(`[shopify/webhook] Call ${call_id} initiated for order ${orderId}`);
}

async function handleAbandonedCheckout(
  checkout: Record<string, unknown>
): Promise<void> {
  const checkoutToken = String(checkout.token ?? checkout.id);
  const phone =
    (checkout.phone as string | null) ??
    ((checkout.customer as Record<string, unknown> | undefined)?.phone as string | null) ??
    null;

  if (!phone) {
    console.warn(`[shopify/webhook] Checkout ${checkoutToken} has no phone — skipping`);
    return;
  }

  const normalizedPhone = normalizePhone(phone);

  // Deduplicate with checkout token
  const already = await checkDedup(normalizedPhone, `checkout-${checkoutToken}`);
  if (already) return;
  await setDedup(normalizedPhone, `checkout-${checkoutToken}`);

  const customer = checkout.customer as Record<string, unknown> | undefined;
  const customerName = customer
    ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
    : "Cliente";

  const lineItems = (checkout.line_items as Array<Record<string, unknown>>) ?? [];
  const products = lineItems.map((li) => `${li.quantity}x ${li.title}`).join(", ");
  const totalPrice = String(checkout.total_price ?? "0.00");
  const abandonedUrl = String(checkout.abandoned_checkout_url ?? "");

  const { call_id } = await createOutboundCall({
    toPhone: normalizedPhone,
    metadata: {
      order_id: `checkout-${checkoutToken}`,
      shop_domain: process.env.SHOPIFY_SHOP_DOMAIN ?? "",
      customer_name: customerName,
      products,
      total: totalPrice,
      country: "CR",
      event_type: "abandoned_cart",
      checkout_url: abandonedUrl,
    },
  });

  await saveCallRecord({
    call_id,
    order_id: `checkout-${checkoutToken}`,
    phone: normalizedPhone,
    customer_name: customerName,
    products,
    total: totalPrice,
    country: "CR",
    status: "calling",
    upsell_accepted: false,
    duration_seconds: 0,
    started_at: new Date().toISOString(),
  });

  console.info(
    `[shopify/webhook] Abandoned cart call ${call_id} for checkout ${checkoutToken}`
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensures the phone number is in E.164 format.
 * Costa Rica numbers: +506 XXXX-XXXX
 * Strips spaces, dashes, and ensures + prefix.
 */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-().]/g, "");
  if (!cleaned.startsWith("+")) {
    // Assume Costa Rica if no country code
    if (cleaned.length === 8) {
      cleaned = `+506${cleaned}`;
    } else if (!cleaned.startsWith("506")) {
      cleaned = `+${cleaned}`;
    } else {
      cleaned = `+${cleaned}`;
    }
  }
  return cleaned;
}
