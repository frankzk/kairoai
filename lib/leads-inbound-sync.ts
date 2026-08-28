// Enriquecimiento del chat: baja el transcript de Icomfly y guarda cuantos
// mensajes escribio el cliente y cual fue el primero.
//
// Sin esto el segmento "Converso" del tablero queda vacio: el transcript se lee
// en vivo cuando se abre el drawer y nunca se persistia.
//
// COMO TERMINA EL BARRIDO: `inbound_synced_at` es el cursor. Solo entran leads
// que nunca se leyeron, o cuya conversacion crecio desde la ultima lectura
// (last_interaction_at > inbound_synced_at). No hace falta guardar posicion en
// lead_sync_state ni dar la vuelta al final: cuando no queda nada pendiente, la
// corrida no hace ni una llamada.

import { getDB } from "./db";
import { fetchConversationTranscript } from "./icomfly-chat";
import { resolveIcomflyStoreContext } from "./icomfly";
import { summarizeInbound } from "./leads-inbound";
import type { FinanceStoreCode } from "./store-config";

/** Cuantos leads por corrida. El techo real lo pone el presupuesto de tiempo. */
const DEFAULT_BATCH = 150;
const MAX_BATCH = 600;
/** Transcripts en paralelo. Bajo a proposito: Icomfly es de un tercero. */
const CONCURRENCY = 4;

export interface InboundSyncResult {
  store: string;
  /** Leads a los que se les leyo el transcript en esta corrida. */
  checked: number;
  /** De esos, a cuantos les cambio el conteo o el primer mensaje. */
  updated: number;
  /** Transcripts que fallaron (se reintentan en la proxima corrida). */
  failed: number;
  /** Cuantos quedan pendientes despues de esta corrida. */
  pending: number;
  /** true si se corto por presupuesto de tiempo y no por falta de trabajo. */
  timed_out: boolean;
}

interface PendingLead {
  id: number;
  crm_conversation_id: string;
  inbound_count: number | null;
  first_inbound_text: string | null;
}

/**
 * Prioridad: primero los que nunca se leyeron, y dentro de esos los de
 * interaccion mas reciente — que son exactamente los que se ven en el tablero.
 * Los viejos se rellenan solos cuando la cola activa ya quedo al dia.
 */
// Va por RPC y no por PostgREST porque la condicion compara DOS COLUMNAS entre
// si (last_interaction_at > inbound_synced_at), y los filtros de PostgREST solo
// comparan una columna contra un valor. Ver 0031_leads_inbound_enrichment.sql.
async function selectPending(storeId: number, limit: number): Promise<PendingLead[]> {
  const { data, error } = await getDB().rpc("leads_pending_inbound", {
    p_store_id: storeId,
    p_limit: limit,
  });
  if (error) throw new Error(`selectPending: ${error.message}`);
  return (data ?? []) as PendingLead[];
}

async function countPending(storeId: number): Promise<number> {
  const { data, error } = await getDB().rpc("leads_pending_inbound_count", {
    p_store_id: storeId,
  });
  if (error) throw new Error(`countPending: ${error.message}`);
  return Number(data ?? 0);
}

export async function runLeadsInboundSync(opts: {
  store?: FinanceStoreCode | string;
  storeId?: number;
  externalStoreId?: number;
  maxLeads?: number;
  timeBudgetMs?: number;
  startedAt?: number;
}): Promise<InboundSyncResult> {
  const { store, externalStoreId } = resolveIcomflyStoreContext({
    store: opts.store,
    storeId: opts.storeId,
    externalStoreId: opts.externalStoreId,
  });
  const storeId = store.id;
  const batch = Math.min(Math.max(opts.maxLeads ?? DEFAULT_BATCH, 1), MAX_BATCH);
  const startedAt = opts.startedAt ?? Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? 45_000;

  const pending = await selectPending(storeId, batch);
  if (pending.length === 0) {
    return { store: store.code, checked: 0, updated: 0, failed: 0, pending: 0, timed_out: false };
  }

  let checked = 0;
  let updated = 0;
  let failed = 0;
  let timedOut = false;
  let next = 0;

  // Los transcripts se leen de a CONCURRENCY; cada worker toma el siguiente
  // pendiente. La escritura es por lead: si la corrida se corta por tiempo, lo
  // ya leido queda guardado y la proxima sigue donde quedo.
  async function worker(): Promise<void> {
    for (;;) {
      if (Date.now() - startedAt >= timeBudgetMs) {
        timedOut = true;
        return;
      }
      const i = next++;
      if (i >= pending.length) return;
      const lead = pending[i];

      let summary;
      try {
        const msgs = await fetchConversationTranscript(lead.crm_conversation_id, externalStoreId);
        summary = summarizeInbound(msgs);
      } catch {
        // El transcript fallo: no se toca inbound_synced_at, asi que el lead
        // sigue pendiente y se reintenta en la proxima corrida.
        failed += 1;
        continue;
      }

      checked += 1;
      const changed =
        summary.inboundCount !== (lead.inbound_count ?? 0) ||
        summary.firstInboundText !== lead.first_inbound_text;

      const { error } = await getDB()
        .from("leads")
        .update({
          inbound_count: summary.inboundCount,
          first_inbound_text: summary.firstInboundText,
          inbound_synced_at: new Date().toISOString(),
        })
        .eq("id", lead.id)
        .eq("store_id", storeId);
      if (error) throw new Error(`runLeadsInboundSync: ${error.message}`);
      if (changed) updated += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

  return {
    store: store.code,
    checked,
    updated,
    failed,
    pending: await countPending(storeId),
    timed_out: timedOut,
  };
}
