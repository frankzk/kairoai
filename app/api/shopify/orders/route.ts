import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface ShopifyOrderSummary {
  id: string;
  order_number: number;
  name: string;
  customer_name: string;
  phone: string | null;
  products: string;
  total: string;
  total_price: number;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  note: string;
  note_attributes: Array<{ name: string; value: string }>;
  created_at: string;
  line_items: Array<{ sku: string; title: string; quantity: number; price: number }>;
}

export async function GET(req: NextRequest) {
  if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "Shopify no configurado: faltan SHOPIFY_SHOP_DOMAIN o SHOPIFY_ACCESS_TOKEN en Vercel." },
      { status: 503 }
    );
  }

  const status = req.nextUrl.searchParams.get("status") || "open";
  const shouldPaginate = req.nextUrl.searchParams.get("all") === "1";
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || (shouldPaginate ? 250 : 50));
  const limit = Math.min(Math.max(requestedLimit || 50, 1), 250);
  const requestedMaxPages = Number(req.nextUrl.searchParams.get("max_pages") || (shouldPaginate ? 6 : 1));
  const maxPages = Math.min(Math.max(requestedMaxPages || 1, 1), 12);
  const createdAtMin = req.nextUrl.searchParams.get("created_at_min");
  const updatedAtMin = req.nextUrl.searchParams.get("updated_at_min");
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
  ].join(",");

  const params = new URLSearchParams({
    status,
    limit: String(limit),
    order: updatedAtMin ? "updated_at desc" : "created_at desc",
    fields,
  });
  if (createdAtMin) params.set("created_at_min", createdAtMin);
  if (updatedAtMin) params.set("updated_at_min", updatedAtMin);

  let url = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/orders.json?${params.toString()}`;

  try {
    const rawOrders: Array<Record<string, unknown>> = [];
    for (let page = 0; page < maxPages && url; page++) {
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
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
      url = shouldPaginate ? nextMatch?.[1] ?? "" : "";
    }

    const orders: ShopifyOrderSummary[] = rawOrders.map(
      (o: Record<string, unknown>) => {
        const customer = o.customer as Record<string, unknown> | undefined;
        const billing = o.billing_address as Record<string, unknown> | undefined;
        const shipping = o.shipping_address as Record<string, unknown> | undefined;

        const firstName = (customer?.first_name as string) ?? (billing?.first_name as string) ?? "";
        const lastName = (customer?.last_name as string) ?? (billing?.last_name as string) ?? "";

        const phone =
          (o.phone as string | null) ??
          (shipping?.phone as string | null) ??
          (billing?.phone as string | null) ??
          (customer?.phone as string | null) ??
          null;

        const lineItems = (o.line_items as Array<Record<string, unknown>>) ?? [];
        const noteAttributes = (o.note_attributes as Array<Record<string, unknown>>) ?? [];
        const products = lineItems.map((li) => `${li.quantity}x ${li.title}`).join(", ");
        const normalizedLineItems = lineItems.map((li) => ({
          sku: String(li.sku ?? ""),
          title: String(li.title ?? ""),
          quantity: Number(li.quantity ?? 0),
          price: Number(li.price ?? 0),
        }));

        return {
          id: String(o.id),
          order_number: o.order_number as number,
          name: o.name as string,
          customer_name: `${firstName} ${lastName}`.trim() || "Sin nombre",
          phone,
          products,
          total: `${o.total_price} ${o.currency}`,
          total_price: Number(o.total_price ?? 0),
          currency: String(o.currency ?? "CRC"),
          financial_status: o.financial_status as string,
          fulfillment_status: (o.fulfillment_status as string | null) ?? null,
          cancelled_at: (o.cancelled_at as string | null) ?? null,
          note: String(o.note ?? ""),
          note_attributes: noteAttributes.map((attribute) => ({
            name: String(attribute.name ?? ""),
            value: String(attribute.value ?? ""),
          })),
          created_at: o.created_at as string,
          line_items: normalizedLineItems,
        };
      }
    );

    return NextResponse.json({
      orders,
      total: orders.length,
      partial: shouldPaginate && Boolean(url),
      max_pages: maxPages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `Error al conectar con Shopify: ${msg}` }, { status: 500 });
  }
}
