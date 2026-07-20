// Orquestacion de la ingesta de Leads desde Icomfly, compartida por el cron
// (/api/cron/leads) y el disparo manual (/api/leads POST). Server-only.
//
// Flujo (Fase 1):
//   1. Cargar snapshots de leads existentes (para respetar las 4 leyes) y el
//      set de telefonos con orden en Shopify (deteccion de "ganado").
//   2. Paginar /api/chat/conversations, normalizar y clasificar cada chat.
//   3. Aplicar nextLeadState (estado manual intocable) y upsert por lotes.
// No persiste mensajes; el transcript se lee en vivo al abrir el drawer.

import { resolveIcomflyStoreContext } from "./icomfly";
import { listConversations, fetchConversationTranscript } from "./icomfly-chat";
import {
  classifyConversation,
  detectOrderInTranscript,
  statusBoardStage,
  type BoardStage,
} from "./leads-classify";
import {
  getSyncCursor,
  listLeads,
  loadLeadSnapshots,
  loadStoreOrderPhones,
  markLeadWonAuto,
  setSyncCursor,
  upsertLeads,
  type LeadUpsertRow,
} from "./leads";
import { nextLeadState } from "./leads-classify";
import { normalizePhone, phoneConfigForStore } from "./phone-cr";
import type { FinanceStoreCode } from "./store-config";

const DEFAULT_MAX_PAGES = 20;
const MAX_MAX_PAGES = 200;
const DEEP_MAX_PAGES = 1000; // barrido completo: hasta 50k conversaciones
const PAGE_LIMIT = 50;

export interface LeadsSyncSummary {
  total: number;
  byStage: Record<BoardStage, number>;
}

export interface LeadsSyncResult {
  store: FinanceStoreCode | string;
  conversations_seen: number;
  leads_written: number;
  skipped_no_phone: number;
  preserved_manual: number;
  pages_fetched: number;
  has_more: boolean;
  summary: LeadsSyncSummary;
}

export async function runLeadsSync(opts: {
  store?: FinanceStoreCode | string;
  storeId?: number;
  externalStoreId?: number;
  maxPages?: number;
  startPage?: number;
  deep?: boolean; // barrido completo: recorre TODAS las paginas
} = {}): Promise<LeadsSyncResult> {
  const { store, externalStoreId } = resolveIcomflyStoreContext({
    store: opts.store,
    storeId: opts.storeId,
    externalStoreId: opts.externalStoreId,
  });
  const storeId = store.id;
  const phoneCfg = phoneConfigForStore(store.code);
  const maxPages = opts.deep
    ? DEEP_MAX_PAGES
    : Math.min(Math.max(opts.maxPages ?? DEFAULT_MAX_PAGES, 1), MAX_MAX_PAGES);
  const startPage = Math.max(opts.startPage ?? 1, 1);

  const [snapshots, orderPhones] = await Promise.all([
    loadLeadSnapshots(storeId),
    loadStoreOrderPhones(storeId, store.code).catch(() => new Set<string>()),
  ]);

  const summary: LeadsSyncSummary = {
    total: 0,
    byStage: {
      por_cerrar: 0,
      pago_verificar: 0,
      carrito: 0,
      seguimiento: 0,
      frio: 0,
      ganado: 0,
      descartado: 0,
    },
  };

  let leadsWritten = 0;
  let conversationsSeen = 0;
  let skippedNoPhone = 0;
  let preservedManual = 0;
  let pagesFetched = 0;
  let hasMore = false;
  let page = startPage;

  for (let i = 0; i < maxPages; i++) {
    const res = await listConversations({ externalStoreId, page, limit: PAGE_LIMIT });
    pagesFetched += 1;
    hasMore = res.hasMore;

    // Dedup por telefono dentro de la corrida (varias conversaciones -> un lead).
    const seenThisRun = new Map<string, LeadUpsertRow>();

    for (const conv of res.conversations) {
      conversationsSeen += 1;
      const phone = normalizePhone(conv.phone, phoneCfg);
      if (!phone) {
        skippedNoPhone += 1;
        continue;
      }

      const hasShopifyOrder = orderPhones.has(phone);
      const classification = classifyConversation(conv, { hasShopifyOrder });
      const current = snapshots.get(phone) ?? null;

      // Ley 4: reapertura si Icomfly ya marco un reopen posterior.
      const reopen = Boolean(conv.lastReopenAt);
      const transition = nextLeadState(current, classification, { reopen });

      // status/category/source resueltos: preservar si la ingesta no debe tocar.
      let status = current?.status ?? classification.status;
      let category = current?.category ?? classification.category;
      let statusSource = current?.statusSource ?? "auto";
      let autoReason = classification.autoReason;
      if (transition) {
        status = transition.status;
        category = transition.category;
        statusSource = "auto"; // toda transicion de ingesta es auto
        autoReason = transition.reason;
      } else if (current?.statusSource === "manual") {
        preservedManual += 1;
        statusSource = "manual";
      }

      const row: LeadUpsertRow = {
        store_id: storeId,
        phone,
        name: conv.displayName || null,
        crm_conversation_id: conv.id || null,
        crm_contact_id: conv.contactId,
        wa_phone_number_id: conv.waPhoneNumberId,
        category,
        status,
        status_source: statusSource,
        auto_reason: autoReason,
        has_order: hasShopifyOrder || category === "won",
        shopify_order_name: null,
        last_message_text: conv.lastMessageText || null,
        last_message_sender: conv.lastMessageSender || null,
        unread_count: conv.unreadCount,
        chatbot_disabled: conv.chatbotDisabled,
        has_cart_signal: classification.hasCartSignal,
        labels: conv.labels,
        first_seen_at: conv.createdAt,
        last_interaction_at: conv.lastMessageAt,
      };

      // Si ya vimos este telefono en la corrida, quedarse con el mas reciente.
      const prev = seenThisRun.get(phone);
      if (!prev || (row.last_interaction_at ?? "") > (prev.last_interaction_at ?? "")) {
        seenThisRun.set(phone, row);
      }
    }

    const pageRows = Array.from(seenThisRun.values());
    // Upsert incremental por pagina: el progreso se guarda aunque un barrido
    // largo se corte por timeout.
    await upsertLeads(pageRows);
    leadsWritten += pageRows.length;
    for (const row of pageRows) {
      summary.total += 1;
      summary.byStage[statusBoardStage(row.status)] += 1;
      // Reflejar en snapshots para dedupe entre paginas.
      snapshots.set(row.phone, {
        category: row.category,
        status: row.status,
        statusSource: row.status_source,
        hasOrder: row.has_order,
        hasCartSignal: row.has_cart_signal,
      });
    }

    if (!res.hasMore) break;
    page += 1;
  }

  await setSyncCursor(`icomfly_chat:${storeId}`, { watermark: new Date().toISOString() });

  return {
    store: store.code,
    conversations_seen: conversationsSeen,
    leads_written: leadsWritten,
    skipped_no_phone: skippedNoPhone,
    preserved_manual: preservedManual,
    pages_fetched: pagesFetched,
    has_more: hasMore,
    summary,
  };
}

export interface ReclassifyResult {
  store: FinanceStoreCode | string;
  checked: number;
  moved_to_won: number;
  pending: number; // leads del bucket que faltan por revisar en esta vuelta
}

const RECLASSIFY_DEFAULT_BATCH = 100;
const RECLASSIFY_MAX_BATCH = 300;

/**
 * Barrido fino por LOTES sobre un bucket (por defecto "por_cerrar"): baja el
 * transcript de un lote de leads auto sin orden y mueve a Ganados los que ya
 * son pedido confirmado (guia/enviado/"ya confirmamos tu pedido"...). Respeta
 * los estados manuales.
 *
 * Usa un cursor por tienda (ultimo lead id revisado) en lead_sync_state para
 * avanzar entre corridas sin re-checar los mismos; al llegar al final vuelve al
 * inicio (re-escanea periodicamente por si un lead se volvio pedido despues).
 */
export async function reclassifyStage(opts: {
  store?: FinanceStoreCode | string;
  storeId?: number;
  externalStoreId?: number;
  stage?: BoardStage;
  maxLeads?: number;
}): Promise<ReclassifyResult> {
  const { store, externalStoreId } = resolveIcomflyStoreContext({
    store: opts.store,
    storeId: opts.storeId,
    externalStoreId: opts.externalStoreId,
  });
  const storeId = store.id;
  const stage = opts.stage ?? "por_cerrar";
  const batch = Math.min(Math.max(opts.maxLeads ?? RECLASSIFY_DEFAULT_BATCH, 1), RECLASSIFY_MAX_BATCH);
  const cursorKey = `reclassify:${storeId}`;

  const leads = await listLeads({ storeId, stage });
  const candidates = leads
    .filter((l) => l.status_source !== "manual" && !l.has_order && l.crm_conversation_id)
    .sort((a, b) => a.id - b.id);

  if (candidates.length === 0) {
    return { store: store.code, checked: 0, moved_to_won: 0, pending: 0 };
  }

  const { cursor } = await getSyncCursor(cursorKey);
  const lastId = cursor ? Number(cursor) : 0;
  let slice = candidates.filter((l) => l.id > lastId).slice(0, batch);
  if (slice.length === 0) slice = candidates.slice(0, batch); // vuelta completa: reinicia

  let moved = 0;
  for (const lead of slice) {
    const msgs = await fetchConversationTranscript(
      lead.crm_conversation_id as string,
      externalStoreId
    ).catch(() => []);
    if (detectOrderInTranscript(msgs)) {
      const changed = await markLeadWonAuto(storeId, lead.id, "pedido confirmado en el chat");
      if (changed) moved += 1;
    }
  }

  // Avanza el cursor; si llegamos al ultimo candidato, reinicia a 0.
  const lastCandidateId = candidates[candidates.length - 1].id;
  const lastScannedId = slice[slice.length - 1].id;
  const reachedEnd = lastScannedId >= lastCandidateId;
  await setSyncCursor(cursorKey, { cursor: reachedEnd ? "0" : String(lastScannedId) });

  const pending = candidates.filter((l) => l.id > lastScannedId).length;
  return { store: store.code, checked: slice.length, moved_to_won: moved, pending };
}
