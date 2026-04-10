import { NextRequest, NextResponse } from "next/server";
import { createOutboundCall } from "@/lib/retell";
import { getOrder, formatOrderSummary } from "@/lib/shopify";
import { checkDedup, setDedup, saveCallRecord, findBestUpsellRule } from "@/lib/db";

export const runtime = "nodejs";

interface TriggerCallBody {
  phone: string;
  order_id: string;
  force?: boolean; // bypass deduplication
}

/**
 * Manual call trigger endpoint (dashboard only).
 */
export async function POST(req: NextRequest) {
  let body: TriggerCallBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { phone, order_id, force = false } = body;

  if (!phone || !order_id) {
    return NextResponse.json(
      { error: "phone and order_id are required" },
      { status: 400 }
    );
  }

  // ── Deduplication check ───────────────────────────────────────────────────
  if (!force) {
    const already = await checkDedup(phone, order_id);
    if (already) {
      return NextResponse.json(
        { error: "Call already placed for this phone + order. Use force=true to override." },
        { status: 409 }
      );
    }
  }

  // ── Fetch order details from Shopify ─────────────────────────────────────
  let orderData = {
    customer_name: "Cliente",
    products: "",
    total: "",
    country: "CR",
    summary: "",
  };

  let shippingAddress = "no disponible";
  let addressComplete = false;
  let upsellProductName = "";
  let upsellProductPrice = "";
  let upsellPitch = "";

  try {
    const order = await getOrder(order_id);
    const addr = order.shipping_address ?? order.billing_address;
    shippingAddress = addr
      ? [addr.address1, addr.address2, addr.city, addr.province].filter(Boolean).join(", ")
      : "no disponible";
    addressComplete = addr?.address1
      ? /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(addr.address1) && /\d/.test(addr.address1)
      : false;

    orderData = {
      customer_name: order.customer
        ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
        : `${order.billing_address?.first_name ?? ""} ${order.billing_address?.last_name ?? ""}`.trim(),
      products: order.line_items.map((li) => `${li.quantity}x ${li.title}`).join(", "),
      total: `${order.total_price} ${order.currency}`,
      country: order.billing_address?.country ?? "PE",
      summary: formatOrderSummary(order),
    };

    // Look up best upsell rule for this order's SKUs
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
  } catch (err) {
    console.warn(`[calls/trigger] Could not fetch order ${order_id}:`, err);
  }

  // ── Set dedup ─────────────────────────────────────────────────────────────
  await setDedup(phone, order_id);

  // ── Create Retell call ────────────────────────────────────────────────────
  const { call_id } = await createOutboundCall({
    toPhone: phone,
    metadata: {
      order_id,
      shop_domain: process.env.SHOPIFY_SHOP_DOMAIN ?? "",
      customer_name: orderData.customer_name,
      products: orderData.products,
      total: orderData.total,
      country: orderData.country,
      event_type: "manual_trigger",
      shipping_address: shippingAddress,
      address_complete: addressComplete,
      upsell_product_name: upsellProductName,
      upsell_product_price: upsellProductPrice,
      upsell_pitch: upsellPitch,
    },
  });

  // ── Save call record ──────────────────────────────────────────────────────
  await saveCallRecord({
    call_id,
    order_id,
    phone,
    customer_name: orderData.customer_name,
    products: orderData.products,
    total: orderData.total,
    country: orderData.country,
    status: "calling",
    upsell_accepted: false,
    duration_seconds: 0,
    started_at: new Date().toISOString(),
  });

  return NextResponse.json({
    success: true,
    call_id,
    order_id,
    phone,
    customer_name: orderData.customer_name,
  });
}
