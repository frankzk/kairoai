import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getIcomflyExternalStoreId } from "@/lib/icomfly";
import { fetchConversationTranscript } from "@/lib/icomfly-chat";
import { getDB } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

// Transcript en vivo de un lead (drawer). No se persiste; se lee de Icomfly
// bajo demanda con la conversacion enlazada al lead.
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
    const { data, error } = await getDB()
      .from("leads")
      .select("id,store_id,crm_conversation_id")
      .eq("store_id", store.id)
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });
    const conversationId = (data as { crm_conversation_id: string | null }).crm_conversation_id;
    if (!conversationId) {
      return NextResponse.json({ messages: [], note: "lead sin conversacion enlazada" });
    }
    const externalStoreId = getIcomflyExternalStoreId(store.code);
    if (externalStoreId == null) {
      return NextResponse.json({ error: `iComfly no configurado para ${store.label}` }, { status: 400 });
    }
    const messages = await fetchConversationTranscript(conversationId, externalStoreId);
    return NextResponse.json({ messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer el transcript";
    return NextResponse.json({ messages: [], error: message }, { status: 500 });
  }
}
