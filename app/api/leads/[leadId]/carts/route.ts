import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams, getShopifyCredentials } from "@/lib/stores";
import { getDB } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 25;

interface CartSummary {
  id: string;
  products: string;
  total: number;
  currency: string;
  created_at: string;
  checkout_url: string;
}

interface ShopifyCheckout {
  id: number | string;
  phone?: string | null;
  email?: string | null;
  total_price?: string | null;
  currency?: string | null;
  created_at?: string | null;
  abandoned_checkout_url?: string | null;
  line_items?: Array<{ title?: string; quantity?: number }> | null;
  customer?: { phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
  billing_address?: { phone?: string | null } | null;
}

function tail8(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").slice(-8);
}

// Carritos abandonados del cliente. Requiere el scope read_checkouts en el
// token de Shopify; si no esta, se responde 200 con `unavailable` para que el
// panel muestre un aviso en vez de romperse (el resto del historial no depende
// de esto).
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

  const { shop, token } = getShopifyCredentials(store);
  if (!shop || !token) {
    return NextResponse.json({
      carts: [],
      unavailable: `Shopify no esta configurado para ${store.shortLabel}.`,
    });
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

    const wanted = tail8((lead as { phone: string }).phone);
    if (wanted.length < 7) return NextResponse.json({ carts: [] });

    // La API de checkouts no permite filtrar por telefono: se trae la pagina
    // reciente y se filtra en memoria por sufijo del numero.
    const url = `https://${shop}/admin/api/2024-01/checkouts.json?limit=250&status=open`;
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (res.status === 403 || res.status === 401) {
      return NextResponse.json({
        carts: [],
        unavailable:
          "Falta el permiso read_checkouts en Shopify. Reautorizá la app para ver carritos abandonados.",
      });
    }
    if (!res.ok) {
      return NextResponse.json({
        carts: [],
        unavailable: `Shopify respondio ${res.status} al leer carritos.`,
      });
    }

    const body = (await res.json()) as { checkouts?: ShopifyCheckout[] };
    const carts: CartSummary[] = (body.checkouts ?? [])
      .filter((c) => {
        const candidates = [
          c.phone,
          c.customer?.phone,
          c.shipping_address?.phone,
          c.billing_address?.phone,
        ];
        return candidates.some((p) => tail8(p) === wanted);
      })
      .slice(0, 10)
      .map((c) => ({
        id: String(c.id),
        products: (c.line_items ?? [])
          .map((i) => {
            const qty = Number(i.quantity ?? 1) || 1;
            const title = String(i.title ?? "").trim();
            return qty > 1 ? `${qty}× ${title}` : title;
          })
          .filter(Boolean)
          .join(", "),
        total: Number(c.total_price ?? 0),
        currency: c.currency ?? store.currency,
        created_at: c.created_at ?? "",
        checkout_url: c.abandoned_checkout_url ?? "",
      }));

    return NextResponse.json({ carts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer carritos";
    return NextResponse.json({ carts: [], unavailable: message });
  }
}
