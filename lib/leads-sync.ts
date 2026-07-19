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
import { listConversations } from "./icomfly-chat";
import { classifyConversation, statusBoardStage, type BoardStage } from "./leads-classify";
import {
  loadLeadSnapshots,
  loadStoreOrderPhones,
  setSyncCursor,
  upsertLeads,
  type LeadUpsertRow,
} from "./leads";
import { nextLeadState } from "./leads-classify";
import { normalizePhone, phoneConfigForStore } from "./phone-cr";
import type { FinanceStoreCode } from "./store-config";

const DEFAULT_MAX_PAGES = 20;
const MAX_MAX_PAGES = 200;
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
} = {}): Promise<LeadsSyncResult> {
  const { store, externalStoreId } = resolveIcomflyStoreContext({
    store: opts.store,
    storeId: opts.storeId,
    externalStoreId: opts.externalStoreId,
  });
  const storeId = store.id;
  const phoneCfg = phoneConfigForStore(store.code);
  const maxPages = Math.min(Math.max(opts.maxPages ?? DEFAULT_MAX_PAGES, 1), MAX_MAX_PAGES);
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

  const rows: LeadUpsertRow[] = [];
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

    for (const row of Array.from(seenThisRun.values())) {
      rows.push(row);
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

  await upsertLeads(rows);
  await setSyncCursor(`icomfly_chat:${storeId}`, { watermark: new Date().toISOString() });

  return {
    store: store.code,
    conversations_seen: conversationsSeen,
    leads_written: rows.length,
    skipped_no_phone: skippedNoPhone,
    preserved_manual: preservedManual,
    pages_fetched: pagesFetched,
    has_more: hasMore,
    summary,
  };
}
