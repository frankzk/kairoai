import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { undoDisposition } from "@/lib/leads";

export const runtime = "nodejs";
export const maxDuration = 20;

interface Body {
  store?: string;
  vendedora_id?: number;
  // La gestion a deshacer. Viene del `call_id` que devolvio el POST de
  // /disposition: se deshace ESA y no "la ultima", que pudo cambiar entre el
  // clic equivocado y el clic en Deshacer.
  call_id?: number;
}

// POST: deshace una gestion y devuelve el lead a como estaba.
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
  const callId = Number(body?.call_id);
  if (!Number.isFinite(callId) || callId <= 0) {
    return NextResponse.json({ error: "call_id requerido" }, { status: 400 });
  }
  const vendedoraId = Number(body?.vendedora_id);
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "Selecciona quien eres (asesora)." }, { status: 400 });
  }

  try {
    const result = await undoDisposition({
      storeId: store.id,
      leadId,
      callId,
      vendedora: vendedoraId,
    });
    // 409 y no 400: la peticion estaba bien formada, lo que cambio es el
    // estado del lead (ya paso algo mas, o se acabo la ventana).
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
    return NextResponse.json({ ok: true, status: result.status, category: result.category });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al deshacer la gestion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
