import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface DraftOrderSummary {
  id: string;
  name: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  products: string;
  total: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapDraftOrder(o: Record<string, unknown>): DraftOrderSummary {
  const customer = o.customer as Record<string, unknown> | undefined;
  const billing = o.billing_address as Record<string, unknown> | undefined;
  const shipping = o.shipping_address as Record<string, unknown> | undefined;

  const firstName =
    (customer?.first_name as string) ?? (billing?.first_name as string) ?? "";
  const lastName =
    (customer?.last_name as string) ?? (billing?.last_name as string) ?? "";

  const phone =
    (o.phone as string | null) ??
    (customer?.phone as string | null) ??
    (shipping?.phone as string | null) ??
    (billing?.phone as string | null) ??
    null;

  const lineItems = (o.line_items as Array<Record<string, unknown>>) ?? [];
  const products = lineItems.map((li) => `${li.quantity}x ${li.title}`).join(", ");

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

export async function GET() {
  if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Shopify no configurado." }, { status: 503 });
  }

  const headers = {
    "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
    "Content-Type": "application/json",
  };

  const raw: Record<string, unknown>[] = [];

  // Shopify draft_orders doesn't support order param — paginate all pages
  // and sort client-side. Max 15 pages = 3750 orders safety cap.
  let nextUrl: string | null =
    `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/draft_orders.json?status=open&limit=250`;

  let page = 0;
  while (nextUrl && page < 15) {
    let res: Response;
    try {
      res = await fetch(nextUrl, { headers, cache: "no-store" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      return NextResponse.json({ error: `Red: ${msg}` }, { status: 500 });
    }

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Shopify error ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    raw.push(...(data.draft_orders ?? []));

    // Follow cursor-based pagination via Link header
    const link = res.headers.get("Link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : null;
    page++;
  }

  const orders = raw
    .map(mapDraftOrder)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return NextResponse.json({ orders, total: orders.length });
}
