import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getLeadHistory } from "@/lib/leads";

export const runtime = "nodejs";
export const maxDuration = 20;

// GET: historial de gestiones (lead_calls) de un lead, para el timeline del drawer.
export async function GET(req: NextRequest, ctx: { params: { leadId: string } }) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const leadId = Number(ctx.params.leadId);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: "leadId invalido" }, { status: 400 });
  }
  try {
    const history = await getLeadHistory(store.id, leadId);
    return NextResponse.json({ history });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer el historial";
    return NextResponse.json({ history: [], error: message }, { status: 500 });
  }
}
