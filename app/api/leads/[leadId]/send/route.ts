import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { getIcomflyExternalStoreId } from "@/lib/icomfly";
import { sendChatMessage } from "@/lib/icomfly-chat";
import { getDB } from "@/lib/db";
import { insertLeadCall } from "@/lib/leads";
import { bumpQuickReplyUsage } from "@/lib/quick-replies";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_MESSAGE_LENGTH = 4000; // limite practico de WhatsApp

interface Body {
  store?: string;
  vendedora_id?: number;
  message?: string;
  // Si el texto salio de una respuesta rapida, se suma a su contador de uso
  // para ordenar los chips del composer. Es telemetria, nunca bloquea.
  quick_reply_id?: number;
}

// POST: envia un mensaje de WhatsApp al lead desde Kairo (sale por el mismo
// numero que usa el bot en Icomfly, asi el cliente ve una sola conversacion).
// Queda registrado en lead_calls con la asesora que lo mando.
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
    return NextResponse.json(
      { error: "Selecciona quien eres (asesora) antes de enviar." },
      { status: 400 }
    );
  }
  const message = String(body?.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "El mensaje esta vacio." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `El mensaje supera ${MAX_MESSAGE_LENGTH} caracteres.` },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await getDB()
      .from("leads")
      .select("id,crm_conversation_id")
      .eq("store_id", store.id)
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });

    const conversationId = (data as { crm_conversation_id: string | null }).crm_conversation_id;
    if (!conversationId) {
      return NextResponse.json(
        { error: "Este lead no tiene conversacion enlazada en Icomfly." },
        { status: 409 }
      );
    }
    const externalStoreId = getIcomflyExternalStoreId(store.code);
    if (externalStoreId == null) {
      return NextResponse.json(
        { error: `iComfly no configurado para ${store.label}` },
        { status: 400 }
      );
    }

    await sendChatMessage(conversationId, externalStoreId, message);

    // Auditoria: quien escribio y que. No bloquea el envio ya realizado.
    try {
      await insertLeadCall({
        lead_id: leadId,
        store_id: store.id,
        vendedora: vendedoraId,
        kind: "note",
        note: `WhatsApp enviado: ${message.slice(0, 300)}`,
      });
    } catch (auditErr) {
      console.error("send: fallo la auditoria en lead_calls", auditErr);
    }

    const quickReplyId = Number(body?.quick_reply_id);
    if (Number.isFinite(quickReplyId) && quickReplyId > 0) {
      try {
        await bumpQuickReplyUsage(store.id, quickReplyId);
      } catch (usageErr) {
        console.error("send: fallo el contador de respuesta rapida", usageErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al enviar el mensaje";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
