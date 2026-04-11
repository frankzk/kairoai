import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface DraftOrderSummary {
  id: string;
  name: string; // "#D1234"
  customer_name: string;
  phone: string | null;
  email: string | null;
  products: string;
  total: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Shopify no configurado." }, { status: 503 });
  }

  const url = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/draft_orders.json?status=open&limit=250`;

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

    const orders: DraftOrderSummary[] = (data.draft_orders ?? []).map(
      (o: Record<string, unknown>) => {
        const customer = o.customer as Record<string, unknown> | undefined;
        const billing = o.billing_address as Record<string, unknown> | undefined;
        const shipping = o.shipping_address as Record<string, unknown> | undefined;

        const firstName =
          (customer?.first_name as string) ??
          (billing?.first_name as string) ??
          "";
        const lastName =
          (customer?.last_name as string) ??
          (billing?.last_name as string) ??
          "";

        const phone =
          (o.phone as string | null) ??
          (customer?.phone as string | null) ??
          (shipping?.phone as string | null) ??
          (billing?.phone as string | null) ??
          null;

        const lineItems = (o.line_items as Array<Record<string, unknown>>) ?? [];
        const products = lineItems
          .map((li) => `${li.quantity}x ${li.title}`)
          .join(", ");

        return {
          id: String(o.id),
          name: String(o.name ?? `#D${o.id}`),
          customer_name: `${firstName} ${lastName}`.trim() || "Sin nombre",
          phone,
          email: (o.email as string | null) ?? null,
          products,
          total: `${o.total_price ?? "0.00"} ${o.currency ?? ""}`.trim(),
          status: String(o.status ?? "open"),
          created_at: o.created_at as string,
          updated_at: o.updated_at as string,
        };
      }
    );

    // Sort newest first regardless of what Shopify returns
    orders.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    return NextResponse.json({ orders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `Error: ${msg}` }, { status: 500 });
  }
}
