import { NextRequest, NextResponse } from "next/server";
import {
  listPersistedShopifyOrders,
  upsertPersistedShopifyOrders,
  type PersistedShopifyOrder,
} from "@/lib/finance";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") || 1000);
    const orders = await listPersistedShopifyOrders(Math.min(Math.max(limit, 1), 5000));
    return NextResponse.json({ orders, total: orders.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer pedidos Shopify sincronizados";
    return NextResponse.json({ orders: [], total: 0, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const maxPages = Math.min(Math.max(Number(body.max_pages ?? 4), 1), 8);
    const createdAtMin = String(body.created_at_min ?? "2026-03-01T00:00:00-06:00");
    let url = typeof body.next_url === "string" && body.next_url ? body.next_url : buildInitialUrl(createdAtMin);

    const rawOrders: Array<Record<string, unknown>> = [];
    for (let page = 0; page < maxPages && url; page++) {
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN ?? "",
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json(
          { error: `Shopify error ${res.status}: ${text.slice(0, 200)}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      rawOrders.push(...((data.orders as Array<Record<string, unknown>>) ?? []));

      const link = res.headers.get("link") ?? "";
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch?.[1] ?? "";
    }

    const orders = rawOrders.map(mapShopifyOrder);
    await upsertPersistedShopifyOrders(orders);

    return NextResponse.json({
      synced: orders.length,
      next_url: url || null,
      partial: Boolean(url),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando Shopify";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildInitialUrl(createdAtMin: string): string {
  if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
    throw new Error("Shopify no configurado: faltan SHOPIFY_SHOP_DOMAIN o SHOPIFY_ACCESS_TOKEN.");
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
  return `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/orders.json?${params.toString()}`;
}

function mapShopifyOrder(order: Record<string, unknown>): Omit<PersistedShopifyOrder, "id" | "synced_at"> {
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

  return {
    shopify_order_id: String(order.id ?? ""),
    order_number: order.order_number ? Number(order.order_number) : null,
    name: String(order.name ?? ""),
    customer_name: `${firstName} ${lastName}`.trim() || "Sin nombre",
    phone,
    email: (order.email as string | null) ?? null,
    financial_status: String(order.financial_status ?? ""),
    fulfillment_status: String(order.fulfillment_status ?? ""),
    cancelled_at: (order.cancelled_at as string | null) ?? null,
    total_price: Number(order.total_price ?? 0),
    currency: String(order.currency ?? "CRC"),
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
