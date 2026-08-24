import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getDB } from "@/lib/db";
import { emptyCustomerOrders, loadCustomerOrdersByPhone } from "@/lib/customer-orders-db";

export const runtime = "nodejs";
export const maxDuration = 20;

// Historial del cliente del lead. La consulta vive en lib/customer-orders-db
// porque el drawer de gestion de pedidos hace la misma pregunta; aca solo se
// resuelve el telefono a partir del lead.
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

  const empty = emptyCustomerOrders(store.currency);

  try {
    const { data: lead, error: leadError } = await getDB()
      .from("leads")
      .select("id,phone")
      .eq("store_id", store.id)
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });

    const result = await loadCustomerOrdersByPhone({
      storeId: store.id,
      phone: String((lead as { phone: string }).phone),
      currency: store.currency,
      logisticsProvider: store.logisticsProvider,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer el historial del cliente";
    return NextResponse.json({ ...empty, error: message }, { status: 500 });
  }
}
