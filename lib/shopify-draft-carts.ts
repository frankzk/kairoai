import { getDB } from "./db";
import { nextLeadState } from "./leads-classify";
import type { LeadCategory, LeadStateSnapshot, StatusSource } from "./leads-types";
import { normalizePhone, phoneConfigForStore } from "./phone-cr";
import type { FinanceStoreConfig } from "./stores";
import {
  fetchOpenShopifyDraftOrders,
  type ShopifyDraftCart,
} from "./shopify-draft-orders";

const PAGE_SIZE = 1000;
const WRITE_CHUNK = 500;

export interface ShopifyDraftCartGroup {
  phone: string;
  drafts: ShopifyDraftCart[];
  latest: ShopifyDraftCart;
  total: number;
  itemCount: number;
  summary: string;
}

export interface ShopifyDraftCartAggregation {
  groups: ShopifyDraftCartGroup[];
  skippedNoPhone: number;
}

export interface ShopifyCartLeadSnapshot extends LeadStateSnapshot {
  id: number;
  phone: string;
  name: string | null;
  autoReason: string | null;
  firstSeenAt: string | null;
  lastInteractionAt: string | null;
  icomflyCartSignal: boolean;
  shopifyCartOpen: boolean;
  shopifyDraftCartCount: number;
  shopifyDraftUpdatedAt: string | null;
  cartValue: number | null;
  cartItemCount: number | null;
  cartSummary: string | null;
}

export interface ShopifyCartLeadDecision {
  category: LeadCategory;
  status: string;
  statusSource: StatusSource;
  autoReason: string | null;
  hasOrder: boolean;
  hasCartSignal: boolean;
  icomflyCartSignal: boolean;
  shopifyCartOpen: boolean;
  shopifyDraftCartCount: number;
  shopifyDraftUpdatedAt: string | null;
  cartValue: number | null;
  cartItemCount: number | null;
  cartSummary: string | null;
  firstSeenAt: string | null;
  lastInteractionAt: string | null;
  historyNote: string | null;
}

function validTime(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestIso(a: string | null, b: string | null): string | null {
  return validTime(b) > validTime(a) ? b : a;
}

export function aggregateShopifyDraftCarts(
  drafts: ShopifyDraftCart[],
  storeCode: string
): ShopifyDraftCartAggregation {
  const phoneConfig = phoneConfigForStore(storeCode);
  const byPhone = new Map<string, ShopifyDraftCart[]>();
  let skippedNoPhone = 0;

  for (const draft of drafts) {
    const phone = normalizePhone(draft.phone, phoneConfig);
    if (!phone) {
      skippedNoPhone += 1;
      continue;
    }
    const existing = byPhone.get(phone) ?? [];
    if (!existing.some((item) => item.id === draft.id)) existing.push(draft);
    byPhone.set(phone, existing);
  }

  const groups = Array.from(byPhone.entries()).map(([phone, phoneDrafts]) => {
    const sorted = [...phoneDrafts].sort(
      (a, b) => validTime(b.updatedAt) - validTime(a.updatedAt)
    );
    const latest = sorted[0];
    return {
      phone,
      drafts: sorted,
      latest,
      total: sorted.reduce((sum, draft) => sum + draft.total, 0),
      itemCount: sorted.reduce((sum, draft) => sum + draft.itemCount, 0),
      summary: sorted
        .map((draft) => draft.products)
        .filter(Boolean)
        .join(" | "),
    };
  });

  groups.sort((a, b) => validTime(b.latest.updatedAt) - validTime(a.latest.updatedAt));
  return { groups, skippedNoPhone };
}

export function decideOpenShopifyCartLead(
  current: ShopifyCartLeadSnapshot | null,
  group: ShopifyDraftCartGroup
): ShopifyCartLeadDecision {
  const incoming = {
    category: "open" as const,
    status: "carrito_abandonado",
    autoReason: `borrador abierto en Shopify (${group.latest.name})`,
    hasCartSignal: true,
  };
  const isNewDraftActivity =
    !current?.shopifyCartOpen ||
    validTime(group.latest.updatedAt) > validTime(current.shopifyDraftUpdatedAt);
  const transition = nextLeadState(current, incoming, { reopen: isNewDraftActivity });

  const status = transition?.status ?? current?.status ?? incoming.status;
  const category = transition?.category ?? current?.category ?? incoming.category;
  const statusSource = transition ? "auto" : current?.statusSource ?? "auto";
  const autoReason =
    transition?.reason ??
    current?.autoReason ??
    incoming.autoReason;

  return {
    category,
    status,
    statusSource,
    autoReason,
    hasOrder: current?.hasOrder ?? false,
    hasCartSignal: true,
    icomflyCartSignal: current?.icomflyCartSignal ?? false,
    shopifyCartOpen: true,
    shopifyDraftCartCount: group.drafts.length,
    shopifyDraftUpdatedAt: group.latest.updatedAt || group.latest.createdAt || null,
    cartValue: group.total,
    cartItemCount: group.itemCount,
    cartSummary: group.summary || null,
    firstSeenAt: current?.firstSeenAt ?? group.latest.createdAt ?? null,
    lastInteractionAt: newestIso(
      current?.lastInteractionAt ?? null,
      group.latest.updatedAt || group.latest.createdAt || null
    ),
    historyNote:
      !current || (transition && transition.status !== current.status)
        ? `Borrador ${group.latest.name} abierto en Shopify`
        : null,
  };
}

export function decideClosedShopifyCartLead(
  current: ShopifyCartLeadSnapshot
): ShopifyCartLeadDecision {
  let category = current.category;
  let status = current.status;
  let autoReason = current.autoReason;
  let historyNote: string | null = null;

  if (current.statusSource !== "manual" && !current.icomflyCartSignal) {
    if (current.hasOrder) {
      category = "won";
      status = "pedido_generado";
      autoReason = "borrador de Shopify cerrado; conserva pedido existente";
    } else if (current.status === "carrito_abandonado") {
      category = "open";
      status = "frio";
      autoReason = "borrador de Shopify ya no esta abierto";
    }
    if (status !== current.status) {
      historyNote = "El borrador de Shopify dejo de estar abierto";
    }
  }

  return {
    category,
    status,
    statusSource: current.statusSource,
    autoReason,
    hasOrder: current.hasOrder,
    hasCartSignal: current.icomflyCartSignal,
    icomflyCartSignal: current.icomflyCartSignal,
    shopifyCartOpen: false,
    shopifyDraftCartCount: 0,
    shopifyDraftUpdatedAt: current.shopifyDraftUpdatedAt,
    cartValue: current.icomflyCartSignal ? current.cartValue : null,
    cartItemCount: current.icomflyCartSignal ? current.cartItemCount : null,
    cartSummary: current.icomflyCartSignal ? current.cartSummary : null,
    firstSeenAt: current.firstSeenAt,
    lastInteractionAt: current.lastInteractionAt,
    historyNote,
  };
}

async function loadLeadSnapshots(
  storeId: number
): Promise<Map<string, ShopifyCartLeadSnapshot>> {
  const result = new Map<string, ShopifyCartLeadSnapshot>();
  for (let from = 0; from < 200000; from += PAGE_SIZE) {
    const { data, error } = await getDB()
      .from("leads")
      .select(
        "id,phone,name,category,status,status_source,auto_reason,has_order,has_cart_signal,icomfly_cart_signal,shopify_cart_open,shopify_draft_cart_count,shopify_draft_updated_at,cart_value,cart_item_count,cart_summary,first_seen_at,last_interaction_at"
      )
      .eq("store_id", storeId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loadShopifyDraftLeadSnapshots: ${error.message}`);
    const page = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of page) {
      const phone = String(row.phone ?? "");
      result.set(phone, {
        id: Number(row.id),
        phone,
        name: typeof row.name === "string" ? row.name : null,
        category: row.category as LeadCategory,
        status: String(row.status),
        statusSource: row.status_source as StatusSource,
        autoReason: typeof row.auto_reason === "string" ? row.auto_reason : null,
        hasOrder: Boolean(row.has_order),
        hasCartSignal: Boolean(row.has_cart_signal),
        firstSeenAt: typeof row.first_seen_at === "string" ? row.first_seen_at : null,
        lastInteractionAt:
          typeof row.last_interaction_at === "string" ? row.last_interaction_at : null,
        icomflyCartSignal: Boolean(row.icomfly_cart_signal),
        shopifyCartOpen: Boolean(row.shopify_cart_open),
        shopifyDraftCartCount: Number(row.shopify_draft_cart_count ?? 0),
        shopifyDraftUpdatedAt:
          typeof row.shopify_draft_updated_at === "string"
            ? row.shopify_draft_updated_at
            : null,
        cartValue: row.cart_value == null ? null : Number(row.cart_value),
        cartItemCount:
          row.cart_item_count == null ? null : Number(row.cart_item_count),
        cartSummary:
          typeof row.cart_summary === "string" ? row.cart_summary : null,
      });
    }
    if (page.length < PAGE_SIZE) break;
  }
  return result;
}

async function loadOpenDraftRows(storeId: number): Promise<
  Array<{
    id: number;
    lead_id: number | null;
    shopify_draft_order_id: string;
    shopify_updated_at: string | null;
  }>
> {
  const rows: Array<{
    id: number;
    lead_id: number | null;
    shopify_draft_order_id: string;
    shopify_updated_at: string | null;
  }> = [];
  for (let from = 0; from < 200000; from += PAGE_SIZE) {
    const { data, error } = await getDB()
      .from("shopify_draft_carts")
      .select("id,lead_id,shopify_draft_order_id,shopify_updated_at")
      .eq("store_id", storeId)
      .eq("is_open", true)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`loadOpenShopifyDraftRows: ${error.message}`);
    const page = (data ?? []) as Array<{
      id: number;
      lead_id: number | null;
      shopify_draft_order_id: string;
      shopify_updated_at: string | null;
    }>;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function insertHistory(
  storeId: number,
  entries: Array<{ leadId: number; status: string; note: string }>
): Promise<void> {
  if (!entries.length) return;
  const rows = entries.map((entry) => ({
    lead_id: entry.leadId,
    store_id: storeId,
    vendedora: null,
    kind: "system",
    new_status: entry.status,
    note: entry.note,
  }));
  for (let index = 0; index < rows.length; index += WRITE_CHUNK) {
    const { error } = await getDB()
      .from("lead_calls")
      .insert(rows.slice(index, index + WRITE_CHUNK));
    if (error) throw new Error(`insertShopifyDraftHistory: ${error.message}`);
  }
}

export interface ShopifyDraftCartSyncResult {
  store: string;
  drafts_open: number;
  leads_with_open_drafts: number;
  leads_written: number;
  drafts_closed: number;
  leads_closed: number;
  skipped_no_phone: number;
}

export async function runShopifyDraftCartSync(
  store: FinanceStoreConfig
): Promise<ShopifyDraftCartSyncResult> {
  const drafts = await fetchOpenShopifyDraftOrders(store);
  const aggregation = aggregateShopifyDraftCarts(drafts, store.code);
  const snapshots = await loadLeadSnapshots(store.id);
  const now = new Date().toISOString();

  const leadRows = aggregation.groups.flatMap((group) => {
    const current = snapshots.get(group.phone) ?? null;
    const decision = decideOpenShopifyCartLead(current, group);
    const changed =
      !current ||
      !current.shopifyCartOpen ||
      !current.hasCartSignal ||
      current.shopifyDraftCartCount !== group.drafts.length ||
      validTime(current.shopifyDraftUpdatedAt) !==
        validTime(decision.shopifyDraftUpdatedAt);
    if (!changed) return [];
    return [{
      store_id: store.id,
      phone: group.phone,
      name:
        current?.name && current.name !== "Sin nombre"
          ? current.name
          : group.latest.customerName,
      category: decision.category,
      status: decision.status,
      status_source: decision.statusSource,
      auto_reason: decision.autoReason,
      has_order: decision.hasOrder,
      has_cart_signal: decision.hasCartSignal,
      icomfly_cart_signal: decision.icomflyCartSignal,
      shopify_cart_open: decision.shopifyCartOpen,
      shopify_draft_cart_count: decision.shopifyDraftCartCount,
      shopify_draft_updated_at: decision.shopifyDraftUpdatedAt,
      cart_value: decision.cartValue,
      cart_item_count: decision.cartItemCount,
      cart_summary: decision.cartSummary,
      first_seen_at: decision.firstSeenAt,
      last_interaction_at: decision.lastInteractionAt,
      history_note: decision.historyNote,
    }];
  });

  const leadIds = new Map<string, number>();
  for (const snapshot of Array.from(snapshots.values())) {
    leadIds.set(snapshot.phone, snapshot.id);
  }
  const historyEntries: Array<{ leadId: number; status: string; note: string }> = [];

  for (let index = 0; index < leadRows.length; index += WRITE_CHUNK) {
    const chunk = leadRows.slice(index, index + WRITE_CHUNK);
    const payload = chunk.map(({ history_note: _historyNote, ...row }) => row);
    const { data, error } = await getDB()
      .from("leads")
      .upsert(payload, { onConflict: "store_id,phone" })
      .select("id,phone");
    if (error) throw new Error(`upsertShopifyDraftLeads: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: number; phone: string }>) {
      leadIds.set(row.phone, row.id);
    }
    for (const row of chunk) {
      if (!row.history_note) continue;
      const leadId = leadIds.get(row.phone);
      if (leadId) {
        historyEntries.push({
          leadId,
          status: row.status,
          note: row.history_note,
        });
      }
    }
  }

  const normalizedPhoneByDraftId = new Map<string, string>();
  for (const group of aggregation.groups) {
    for (const draft of group.drafts) normalizedPhoneByDraftId.set(draft.id, group.phone);
  }
  const existingOpenDrafts = await loadOpenDraftRows(store.id);
  const existingDraftById = new Map(
    existingOpenDrafts.map((row) => [row.shopify_draft_order_id, row])
  );
  const draftRows = drafts
    .map((draft) => {
      const phone = normalizedPhoneByDraftId.get(draft.id);
      if (!phone) return null;
      const existing = existingDraftById.get(draft.id);
      const leadId = leadIds.get(phone) ?? null;
      if (
        existing &&
        existing.lead_id === leadId &&
        validTime(existing.shopify_updated_at) ===
          validTime(draft.updatedAt || draft.createdAt)
      ) {
        return null;
      }
      return {
        store_id: store.id,
        lead_id: leadId,
        shopify_draft_order_id: draft.id,
        shopify_draft_order_name: draft.name,
        phone,
        customer_name: draft.customerName,
        email: draft.email,
        products: draft.products,
        item_count: draft.itemCount,
        total: draft.total,
        currency: draft.currency || store.currency,
        invoice_url: draft.invoiceUrl,
        status: draft.status,
        is_open: true,
        shopify_created_at: draft.createdAt || null,
        shopify_updated_at: draft.updatedAt || draft.createdAt || null,
        last_seen_at: now,
        closed_at: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (let index = 0; index < draftRows.length; index += WRITE_CHUNK) {
    const { error } = await getDB()
      .from("shopify_draft_carts")
      .upsert(draftRows.slice(index, index + WRITE_CHUNK), {
        onConflict: "store_id,shopify_draft_order_id",
      });
    if (error) throw new Error(`upsertShopifyDraftCarts: ${error.message}`);
  }

  const currentDraftIds = new Set(drafts.map((draft) => draft.id));
  const staleDraftRowIds = existingOpenDrafts
    .filter((row) => !currentDraftIds.has(row.shopify_draft_order_id))
    .map((row) => row.id);
  for (let index = 0; index < staleDraftRowIds.length; index += WRITE_CHUNK) {
    const { error } = await getDB()
      .from("shopify_draft_carts")
      .update({ is_open: false, status: "closed", closed_at: now })
      .eq("store_id", store.id)
      .in("id", staleDraftRowIds.slice(index, index + WRITE_CHUNK));
    if (error) throw new Error(`closeShopifyDraftCarts: ${error.message}`);
  }

  const openPhones = new Set(aggregation.groups.map((group) => group.phone));
  let leadsClosed = 0;
  for (const snapshot of Array.from(snapshots.values())) {
    if (!snapshot.shopifyCartOpen || openPhones.has(snapshot.phone)) continue;
    const decision = decideClosedShopifyCartLead(snapshot);
    const { error } = await getDB()
      .from("leads")
      .update({
        category: decision.category,
        status: decision.status,
        status_source: decision.statusSource,
        auto_reason: decision.autoReason,
        has_cart_signal: decision.hasCartSignal,
        icomfly_cart_signal: decision.icomflyCartSignal,
        shopify_cart_open: false,
        shopify_draft_cart_count: 0,
        cart_value: decision.cartValue,
        cart_item_count: decision.cartItemCount,
        cart_summary: decision.cartSummary,
      })
      .eq("store_id", store.id)
      .eq("id", snapshot.id);
    if (error) throw new Error(`closeShopifyDraftLead: ${error.message}`);
    leadsClosed += 1;
    if (decision.historyNote) {
      historyEntries.push({
        leadId: snapshot.id,
        status: decision.status,
        note: decision.historyNote,
      });
    }
  }

  await insertHistory(store.id, historyEntries);

  return {
    store: store.code,
    drafts_open: drafts.length,
    leads_with_open_drafts: aggregation.groups.length,
    leads_written: leadRows.length,
    drafts_closed: staleDraftRowIds.length,
    leads_closed: leadsClosed,
    skipped_no_phone: aggregation.skippedNoPhone,
  };
}
