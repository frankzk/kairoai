import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { fetchConversationTranscript } from "@/lib/icomfly-chat";
import { resolveIcomflyStoreContext } from "@/lib/icomfly";
import { compactarChat } from "@/lib/leads-chat-snapshot";
import { isInCallQueue, leadSegment, type SegmentInput } from "@/lib/leads-segment";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/leads/chat-snapshots?store=mireva-cr
//
// Baja de Icomfly el chat de cada lead con CARRITO que esta en la cola de
// llamadas (ultimos 30 dias, sin pedido) y guarda una copia compacta en
// lead_chat_snapshots, para poder leerlos y decir a cuales les falta poco para
// cerrar. Requiere sesion (no esta bajo /api/cron/). Se abre a mano en el
// navegador; es GET a proposito para que alcance con pegar la URL.
//
// Reanudable: un lead cuyo chat ya se copio despues de su ultima interaccion se
// salta. Si una corrida se corta por tiempo, abrir la URL otra vez sigue.

const DIAS = 30;
const MAX_LEADS = 600;
const CONCURRENCIA = 4;
const PRESUPUESTO_MS = 240_000;

interface LeadFila extends SegmentInput {
  id: number;
  crm_conversation_id: string;
  last_interaction_at: string | null;
}

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const startedAt = Date.now();
  const desde = new Date(startedAt - DIAS * 86400_000).toISOString();

  try {
    const { externalStoreId } = resolveIcomflyStoreContext({ store: store.code });

    const { data, error } = await getDB()
      .from("leads")
      .select(
        "id,crm_conversation_id,last_interaction_at,status,status_source,category,cart_item_count,shopify_cart_open,shopify_draft_cart_count,has_cart_signal,inbound_count"
      )
      .eq("store_id", store.id)
      .in("category", ["open", "hot"])
      .not("crm_conversation_id", "is", null)
      .not("has_order", "is", true)
      .gte("last_interaction_at", desde)
      .or("cart_item_count.gt.0,shopify_cart_open.eq.true,shopify_draft_cart_count.gt.0,has_cart_signal.eq.true")
      .order("last_interaction_at", { ascending: false })
      .limit(MAX_LEADS);
    if (error) throw new Error(`leads: ${error.message}`);

    const carritos = ((data ?? []) as LeadFila[]).filter(
      (l) => leadSegment(l) === "carrito" && isInCallQueue(l)
    );

    // Saltar los que ya se copiaron despues de su ultima interaccion.
    const ids = carritos.map((l) => l.id);
    const copiados = new Map<number, string>();
    if (ids.length) {
      const { data: snaps, error: snapErr } = await getDB()
        .from("lead_chat_snapshots")
        .select("lead_id,fetched_at")
        .in("lead_id", ids);
      if (snapErr) throw new Error(`lead_chat_snapshots: ${snapErr.message}`);
      for (const s of (snaps ?? []) as Array<{ lead_id: number; fetched_at: string }>) {
        copiados.set(s.lead_id, s.fetched_at);
      }
    }
    const pendientes = carritos.filter((l) => {
      const f = copiados.get(l.id);
      return !f || (l.last_interaction_at != null && l.last_interaction_at > f);
    });

    let guardados = 0;
    let fallidos = 0;
    let cortado = false;
    let next = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (Date.now() - startedAt >= PRESUPUESTO_MS) {
          cortado = true;
          return;
        }
        const i = next++;
        if (i >= pendientes.length) return;
        const lead = pendientes[i];
        try {
          const mensajes = compactarChat(
            await fetchConversationTranscript(lead.crm_conversation_id, externalStoreId)
          );
          const { error: upErr } = await getDB().from("lead_chat_snapshots").upsert(
            {
              lead_id: lead.id,
              store_id: store!.id,
              message_count: mensajes.length,
              messages: mensajes,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: "lead_id" }
          );
          if (upErr) throw new Error(upErr.message);
          guardados += 1;
        } catch (err) {
          console.warn(`[chat-snapshots] lead ${lead.id}:`, err instanceof Error ? err.message : err);
          fallidos += 1;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, pendientes.length) }, worker));

    return NextResponse.json({
      ok: true,
      store: store.code,
      carritos: carritos.length,
      ya_copiados: carritos.length - pendientes.length,
      guardados,
      fallidos,
      cortado_por_tiempo: cortado,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al copiar los chats";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
