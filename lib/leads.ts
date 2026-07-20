// Capa de acceso a datos del modulo de Leads (Supabase, service role).
// El aislamiento por tienda se impone aqui (siempre filtrando store_id), igual
// que el resto de APIs del repo; no hay RLS todavia.

import { getDB } from "./db";
import { statusBoardStage, type BoardStage } from "./leads-classify";
import type { LeadCategory, LeadStateSnapshot, StatusSource } from "./leads-types";
import { normalizePhone, phoneConfigForStore } from "./phone-cr";

export interface LeadRecord {
  id: number;
  store_id: number;
  phone: string;
  wa_id: string | null;
  name: string | null;
  crm_conversation_id: string | null;
  crm_contact_id: string | null;
  wa_phone_number_id: string | null;
  category: LeadCategory;
  status: string;
  status_source: StatusSource;
  auto_reason: string | null;
  needs_attention: boolean;
  attention_waves: number;
  shopify_order_name: string | null;
  has_order: boolean;
  claimed_by: number | null;
  claimed_at: string | null;
  closed_by: number | null;
  next_followup_at: string | null;
  first_seen_at: string | null;
  last_interaction_at: string | null;
  last_inbound_at: string | null;
  last_reopen_at: string | null;
  last_message_text: string | null;
  last_message_sender: string | null;
  unread_count: number;
  chatbot_disabled: boolean;
  district: string | null;
  cart_value: number | null;
  cart_item_count: number | null;
  cart_summary: string | null;
  has_cart_signal: boolean;
  inbound_count: number;
  labels: string[];
  created_at: string;
  updated_at: string;
}

/** Columnas que la ingesta escribe (uniforme para el upsert por lotes). */
export type LeadUpsertRow = Pick<
  LeadRecord,
  | "store_id"
  | "phone"
  | "name"
  | "crm_conversation_id"
  | "crm_contact_id"
  | "wa_phone_number_id"
  | "category"
  | "status"
  | "status_source"
  | "auto_reason"
  | "has_order"
  | "shopify_order_name"
  | "last_message_text"
  | "last_message_sender"
  | "unread_count"
  | "chatbot_disabled"
  | "has_cart_signal"
  | "labels"
  | "first_seen_at"
  | "last_interaction_at"
>;

export async function upsertLeads(rows: LeadUpsertRow[]): Promise<void> {
  if (!rows.length) return;
  // Lotes para no exceder limites de PostgREST.
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await getDB()
      .from("leads")
      .upsert(chunk, { onConflict: "store_id,phone" });
    if (error) throw new Error(`upsertLeads: ${error.message}`);
  }
}

/** Mapa telefono -> snapshot del estado actual, para aplicar las 4 leyes. */
export async function loadLeadSnapshots(storeId: number): Promise<Map<string, LeadStateSnapshot>> {
  const map = new Map<string, LeadStateSnapshot>();
  const pageSize = 1000;
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await getDB()
      .from("leads")
      .select("phone,category,status,status_source,has_order,has_cart_signal")
      .eq("store_id", storeId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`loadLeadSnapshots: ${error.message}`);
    const page = data ?? [];
    for (const row of page as Array<Record<string, unknown>>) {
      map.set(String(row.phone), {
        category: row.category as LeadCategory,
        status: String(row.status),
        statusSource: row.status_source as StatusSource,
        hasOrder: Boolean(row.has_order),
        hasCartSignal: Boolean(row.has_cart_signal),
      });
    }
    if (page.length < pageSize) break;
  }
  return map;
}

/**
 * Conjunto de telefonos normalizados con orden confirmada en Shopify para la
 * tienda. Alimenta la deteccion de "ganado" por telefono (Ley 1).
 */
export async function loadStoreOrderPhones(
  storeId: number,
  storeCode: string
): Promise<Set<string>> {
  const cfg = phoneConfigForStore(storeCode);
  const set = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await getDB()
      .from("shopify_orders")
      .select("customer_phone")
      .eq("store_id", storeId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`loadStoreOrderPhones: ${error.message}`);
    const page = data ?? [];
    for (const row of page as Array<{ customer_phone: string | null }>) {
      const norm = normalizePhone(row.customer_phone, cfg);
      if (norm) set.add(norm);
    }
    if (page.length < pageSize) break;
  }
  return set;
}

export interface ListLeadsOptions {
  storeId: number;
  stage?: BoardStage;
  limit?: number;
}

export async function listLeads(opts: ListLeadsOptions): Promise<LeadRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 20000);
  const pageSize = 1000;
  const all: LeadRecord[] = [];
  for (let from = 0; from < limit; from += pageSize) {
    const { data, error } = await getDB()
      .from("leads")
      .select("*")
      .eq("store_id", opts.storeId)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .range(from, Math.min(from + pageSize, limit) - 1);
    if (error) throw new Error(`listLeads: ${error.message}`);
    const page = (data ?? []) as LeadRecord[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  // El bucket del tablero se deriva del status; filtrar en memoria si se pidio.
  if (opts.stage) return all.filter((l) => statusBoardStage(l.status) === opts.stage);
  return all;
}

export interface LeadBoardCounts {
  total: number;
  byStage: Record<BoardStage, number>;
}

export function countByStage(leads: LeadRecord[]): LeadBoardCounts {
  const byStage: Record<BoardStage, number> = {
    por_cerrar: 0,
    pago_verificar: 0,
    carrito: 0,
    seguimiento: 0,
    frio: 0,
    ganado: 0,
    descartado: 0,
  };
  for (const l of leads) byStage[statusBoardStage(l.status)] += 1;
  return { total: leads.length, byStage };
}

export async function getLead(storeId: number, leadId: number): Promise<LeadRecord | null> {
  const { data, error } = await getDB()
    .from("leads")
    .select("*")
    .eq("store_id", storeId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`getLead: ${error.message}`);
  return (data as LeadRecord) ?? null;
}

/** Registra una gestion en el historial (auditoria + productividad). */
export async function insertLeadCall(row: {
  lead_id: number;
  store_id: number;
  vendedora: number | null;
  kind: string;
  new_status?: string | null;
  note?: string | null;
  next_followup_at?: string | null;
}): Promise<void> {
  const { error } = await getDB().from("lead_calls").insert({
    lead_id: row.lead_id,
    store_id: row.store_id,
    vendedora: row.vendedora,
    kind: row.kind,
    new_status: row.new_status ?? null,
    note: row.note ?? null,
    next_followup_at: row.next_followup_at ?? null,
  });
  if (error) throw new Error(`insertLeadCall: ${error.message}`);
}

/**
 * Marca un lead como ganado porque la asesora creo el pedido en Shopify desde
 * el drawer. status_source='manual' para que la ingesta no lo revierta, y
 * closed_by = asesora (esto define la ventana "Cerrados por la asesora").
 */
export async function markLeadWonByAdvisor(opts: {
  storeId: number;
  leadId: number;
  vendedora: number;
  shopifyOrderName: string;
  note?: string;
}): Promise<void> {
  const { error } = await getDB()
    .from("leads")
    .update({
      category: "won",
      status: "pedido_generado",
      status_source: "manual",
      auto_reason: opts.note ?? "pedido creado por la asesora en Shopify",
      has_order: true,
      shopify_order_name: opts.shopifyOrderName,
      closed_by: opts.vendedora,
    })
    .eq("store_id", opts.storeId)
    .eq("id", opts.leadId);
  if (error) throw new Error(`markLeadWonByAdvisor: ${error.message}`);
  await insertLeadCall({
    lead_id: opts.leadId,
    store_id: opts.storeId,
    vendedora: opts.vendedora,
    kind: "sale",
    new_status: "pedido_generado",
    note: `Pedido ${opts.shopifyOrderName} creado desde el tablero de Leads`,
  });
}

// ─── Cursores de sincronizacion ──────────────────────────────────────────────
export async function getSyncCursor(sourceKey: string): Promise<{ cursor: string | null; watermark: string | null }> {
  const { data, error } = await getDB()
    .from("lead_sync_state")
    .select("cursor,watermark")
    .eq("source_key", sourceKey)
    .maybeSingle();
  if (error) throw new Error(`getSyncCursor: ${error.message}`);
  return { cursor: data?.cursor ?? null, watermark: data?.watermark ?? null };
}

export async function setSyncCursor(
  sourceKey: string,
  patch: { cursor?: string | null; watermark?: string | null }
): Promise<void> {
  const { error } = await getDB()
    .from("lead_sync_state")
    .upsert(
      { source_key: sourceKey, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "source_key" }
    );
  if (error) throw new Error(`setSyncCursor: ${error.message}`);
}
