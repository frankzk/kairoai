import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getDB } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 20;

interface OrderRow {
  name: string;
  shopify_created_at: string | null;
  total_price: string | number | null;
  currency: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  line_items: unknown;
}

interface PurchaseItem {
  title: string;
  quantity: number;
}

// line_items es JSONB con la forma de Shopify; solo necesitamos titulo+cantidad
// y toleramos formas viejas/incompletas.
function summarizeItems(raw: unknown): PurchaseItem[] {
  if (!Array.isArray(raw)) return [];
  const items: PurchaseItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const title = String(o.title ?? o.name ?? "").trim();
    if (!title) continue;
    const quantity = Number(o.quantity ?? 1) || 1;
    items.push({ title, quantity });
  }
  return items;
}

// Compras anteriores del lead: consulta shopify_orders LOCAL por telefono (sin
// pegarle a la API de Shopify). Match por sufijo de 8 digitos, igual criterio
// de normalizacion que el RPC match_leads_to_shopify_orders (0025): los
// telefonos vienen con o sin +506/504, asi que el sufijo nacional es la llave
// estable.
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

    const digits = String((lead as { phone: string }).phone).replace(/\D/g, "");
    const tail = digits.slice(-8);
    if (tail.length < 7) return NextResponse.json({ orders: [] });

    const { data, error } = await db
      .from("shopify_orders")
      .select(
        "name,shopify_created_at,total_price,currency,financial_status,fulfillment_status,cancelled_at,line_items"
      )
      .eq("store_id", store.id)
      .ilike("phone", `%${tail}`)
      .order("shopify_created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    const orders = ((data ?? []) as OrderRow[]).map((row) => ({
      name: row.name,
      created_at: row.shopify_created_at,
      total: Number(row.total_price ?? 0),
      currency: row.currency ?? store.currency,
      financial_status: row.financial_status ?? "",
      fulfillment_status: row.fulfillment_status ?? "",
      cancelled: row.cancelled_at != null,
      items: summarizeItems(row.line_items),
    }));
    return NextResponse.json({ orders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer compras del lead";
    return NextResponse.json({ orders: [], error: message }, { status: 500 });
  }
}
