import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface ShopifyOrderSummary {
  id: string;
  order_number: number;
  name: string;
  customer_name: string;
  phone: string | null;
  products: string;
  total: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
}

export async function GET() {
  if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "Shopify no configurado: faltan SHOPIFY_SHOP_DOMAIN o SHOPIFY_ACCESS_TOKEN en Vercel." },
      { status: 503 }
    );
  }

  // All open orders, most recent first
  const url = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/orders.json?status=open&limit=50&order=created_at+desc&fields=id,order_number,name,email,phone,financial_status,fulfillment_status,total_price,currency,line_items,customer,billing_address,shipping_address,created_at`;

  try {
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

    const orders: ShopifyOrderSummary[] = (data.orders ?? []).map(
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
        const products = lineItems.map((li) => `${li.quantity}x ${li.title}`).join(", ");

        return {
          id: String(o.id),
          order_number: o.order_number as number,
          name: o.name as string,
          customer_name: `${firstName} ${lastName}`.trim() || "Sin nombre",
          phone,
          products,
          total: `${o.total_price} ${o.currency}`,
          financial_status: o.financial_status as string,
          fulfillment_status: (o.fulfillment_status as string | null) ?? null,
          created_at: o.created_at as string,
        };
      }
    );

    return NextResponse.json({ orders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `Error al conectar con Shopify: ${msg}` }, { status: 500 });
  }
}
