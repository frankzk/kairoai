import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams, getShopifyCredentials } from "@/lib/stores";
import { getDB } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 25;

interface CartSummary {
  id: string;
  source: "draft_order" | "checkout";
  name: string;
  products: string;
  total: number;
  currency: string;
  status: string;
  created_at: string;
  updated_at: string;
  checkout_url: string;
}

interface ShopifyCheckout {
  id: number | string;
  phone?: string | null;
  total_price?: string | null;
  currency?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  abandoned_checkout_url?: string | null;
  line_items?: Array<{ title?: string; quantity?: number }> | null;
  customer?: { phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
  billing_address?: { phone?: string | null } | null;
}

interface StoredDraftCart {
  shopify_draft_order_id: string;
  shopify_draft_order_name: string;
  products: string;
  total: number | string;
  currency: string;
  status: string;
  invoice_url: string | null;
  shopify_created_at: string | null;
  shopify_updated_at: string | null;
}

function tail8(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").slice(-8);
}

function sortNewestFirst(carts: CartSummary[]): CartSummary[] {
  return carts.sort(
    (a, b) =>
      Date.parse(b.updated_at || b.created_at) -
      Date.parse(a.updated_at || a.created_at)
  );
}

// Combina los Borradores persistidos por el cron con los checkouts abandonados
// en vivo. Si falta read_checkouts, los Borradores siguen disponibles.
export async function GET(req: NextRequest, ctx: { params: { leadId: string } }) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  const leadId = Number(ctx.params.leadId);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: "leadId invalido" }, { status: 400 });
  }

  try {
    const db = getDB();
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("id,phone")
      .eq("store_id", store.id)
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });

    const carts: CartSummary[] = [];
    let unavailable: string | null = null;

    const { data: storedDrafts, error: draftError } = await db
      .from("shopify_draft_carts")
      .select(
        "shopify_draft_order_id,shopify_draft_order_name,products,total,currency,status,invoice_url,shopify_created_at,shopify_updated_at"
      )
      .eq("store_id", store.id)
      .eq("lead_id", leadId)
      .eq("is_open", true)
      .order("shopify_updated_at", { ascending: false });
    if (draftError) {
      unavailable = `Borradores de Shopify: ${draftError.message}`;
    } else {
      for (const draft of (storedDrafts ?? []) as StoredDraftCart[]) {
        carts.push({
          id: `draft-${draft.shopify_draft_order_id}`,
          source: "draft_order",
          name: draft.shopify_draft_order_name,
          products: draft.products,
          total: Number(draft.total ?? 0),
          currency: draft.currency || store.currency,
          status: draft.status,
          created_at: draft.shopify_created_at ?? "",
          updated_at: draft.shopify_updated_at ?? "",
          checkout_url: draft.invoice_url ?? "",
        });
      }
    }

    const wanted = tail8((lead as { phone: string }).phone);
    const { shop, token } = getShopifyCredentials(store);
    if (!shop || !token) {
      return NextResponse.json({
        carts: sortNewestFirst(carts),
        unavailable:
          unavailable ?? `Shopify no esta configurado para ${store.shortLabel}.`,
      });
    }
    if (wanted.length < 7) {
      return NextResponse.json({ carts: sortNewestFirst(carts), unavailable });
    }

    const url = `https://${shop}/admin/api/2024-01/checkouts.json?limit=250&status=open`;
    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (response.status === 403 || response.status === 401) {
      unavailable =
        unavailable ??
        "Falta el permiso read_checkouts en Shopify; los Borradores si estan disponibles.";
      return NextResponse.json({ carts: sortNewestFirst(carts), unavailable });
    }
    if (!response.ok) {
      unavailable =
        unavailable ?? `Shopify respondio ${response.status} al leer checkouts abandonados.`;
      return NextResponse.json({ carts: sortNewestFirst(carts), unavailable });
    }

    const body = (await response.json()) as { checkouts?: ShopifyCheckout[] };
    for (const checkout of body.checkouts ?? []) {
      const phones = [
        checkout.phone,
        checkout.customer?.phone,
        checkout.shipping_address?.phone,
        checkout.billing_address?.phone,
      ];
      if (!phones.some((phone) => tail8(phone) === wanted)) continue;
      carts.push({
        id: `checkout-${String(checkout.id)}`,
        source: "checkout",
        name: "Checkout abandonado",
        products: (checkout.line_items ?? [])
          .map((item) => {
            const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
            const title = String(item.title ?? "").trim();
            return title ? `${quantity}x ${title}` : "";
          })
          .filter(Boolean)
          .join(", "),
        total: Number(checkout.total_price ?? 0),
        currency: checkout.currency ?? store.currency,
        status: "open",
        created_at: checkout.created_at ?? "",
        updated_at: checkout.updated_at ?? checkout.created_at ?? "",
        checkout_url: checkout.abandoned_checkout_url ?? "",
      });
    }

    return NextResponse.json({
      carts: sortNewestFirst(carts).slice(0, 20),
      unavailable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al leer carritos";
    return NextResponse.json({ carts: [], unavailable: message });
  }
}
