import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface ShopifyCartSummary {
  id: string;
  token: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  products: string;
  total: string;
  checkout_url: string;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  if (!process.env.SHOPIFY_SHOP_DOMAIN || !process.env.SHOPIFY_ACCESS_TOKEN) {
    return NextResponse.json({ error: "Shopify no configurado." }, { status: 503 });
  }

  const url = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/checkouts.json?limit=50`;

  try {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 403) {
      return NextResponse.json(
        { error: "Sin permiso para ver carritos. Re-autenticá Shopify para obtener el scope read_checkouts." },
        { status: 403 }
      );
    }

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Shopify error ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    const carts: ShopifyCartSummary[] = (data.checkouts ?? []).map(
      (c: Record<string, unknown>) => {
        const customer = c.customer as Record<string, unknown> | undefined;
        const billingAddr = c.billing_address as Record<string, unknown> | undefined;

        const firstName = (customer?.first_name as string) ?? (billingAddr?.first_name as string) ?? "";
        const lastName = (customer?.last_name as string) ?? (billingAddr?.last_name as string) ?? "";

        const phone =
          (c.phone as string | null) ??
          (customer?.phone as string | null) ??
          (billingAddr?.phone as string | null) ??
          null;

        const lineItems = (c.line_items as Array<Record<string, unknown>>) ?? [];
        const products = lineItems.map((li) => `${li.quantity}x ${li.title}`).join(", ");

        return {
          id: String(c.id),
          token: String(c.token ?? c.id),
          customer_name: `${firstName} ${lastName}`.trim() || "Sin nombre",
          phone,
          email: (c.email as string | null) ?? null,
          products,
          total: `${c.total_price ?? "0.00"} ${c.currency ?? ""}`.trim(),
          checkout_url: String(c.abandoned_checkout_url ?? ""),
          created_at: c.created_at as string,
          updated_at: c.updated_at as string,
        };
      }
    );

    return NextResponse.json({ carts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: `Error: ${msg}` }, { status: 500 });
  }
}
