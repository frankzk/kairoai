import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { applyDisposition, getLead } from "@/lib/leads";
import { defaultFollowupAt, isValidDisposition, schedulesFollowup } from "@/lib/leads-classify";

export const runtime = "nodejs";
export const maxDuration = 20;

interface Body {
  store?: string;
  vendedora_id?: number;
  status?: string;
  note?: string;
}

// POST: registra el "resultado de la llamada" de la asesora sobre un lead.
export async function POST(req: NextRequest, ctx: { params: { leadId: string } }) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const leadId = Number(ctx.params.leadId);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: "leadId invalido" }, { status: 400 });
  }
  const vendedoraId = Number(body?.vendedora_id);
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "Selecciona quien eres (asesora) antes de gestionar." }, { status: 400 });
  }
  const status = String(body?.status ?? "");
  if (!isValidDisposition(status)) {
    return NextResponse.json({ error: `Estado invalido: ${status}` }, { status: 400 });
  }

  try {
    const lead = await getLead(store.id, leadId);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });

    const nextFollowupAt = schedulesFollowup(status) ? defaultFollowupAt(new Date()) : null;
    const result = await applyDisposition({
      storeId: store.id,
      leadId,
      vendedora: vendedoraId,
      status,
      note: body?.note ?? null,
      nextFollowupAt,
    });
    return NextResponse.json({ ok: true, ...result, next_followup_at: nextFollowupAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al registrar la gestion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
