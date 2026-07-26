// Capa de acceso a datos del modulo de Leads (Supabase, service role).
// El aislamiento por tienda se impone aqui (siempre filtrando store_id), igual
// que el resto de APIs del repo; no hay RLS todavia.

import { getDB } from "./db";
import { statusBoardStage, statusCategory, type BoardStage } from "./leads-classify";
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
    // Columna real es `phone`. Solo ordenes NO canceladas cuentan como pedido
    // real (una orden cancelada = cliente que declino, no es "ganado").
    const { data, error } = await getDB()
      .from("shopify_orders")
      .select("phone")
      .eq("store_id", storeId)
      .is("cancelled_at", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`loadStoreOrderPhones: ${error.message}`);
    const page = data ?? [];
    for (const row of page as Array<{ phone: string | null }>) {
      const norm = normalizePhone(row.phone, cfg);
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
  /** Solo leads con interaccion desde este ISO (oculta los muy antiguos). */
  sinceIso?: string;
}

export async function listLeads(opts: ListLeadsOptions): Promise<LeadRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 20000);
  const pageSize = 1000;
  const all: LeadRecord[] = [];
  for (let from = 0; from < limit; from += pageSize) {
    let query = getDB()
      .from("leads")
      .select("*")
      .eq("store_id", opts.storeId)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .range(from, Math.min(from + pageSize, limit) - 1);
    // Oculta los muy antiguos, PERO conserva los que tienen seguimiento
    // programado o estan marcados para atencion (no se pueden perder).
    if (opts.sinceIso) {
      query = query.or(
        `last_interaction_at.gte.${opts.sinceIso},next_followup_at.not.is.null,needs_attention.is.true`
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(`listLeads: ${error.message}`);
    const page = (data ?? []) as LeadRecord[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  // El bucket del tablero se deriva del status; filtrar en memoria si se pidio.
  if (opts.stage) return all.filter((l) => statusBoardStage(l.status) === opts.stage);
  return all;
}

// ─── Productividad de la asesora (contactos + pedidos por periodo) ───────────
export interface ProductivityRow {
  vendedora_id: number;
  name: string;
  gestiones: number; // total de gestiones registradas
  leads: number; // leads distintos gestionados
  pedidos: number; // pedidos creados (lead_calls kind='sale')
}

export async function getProductivity(
  storeId: number,
  fromIso: string,
  toIso: string
): Promise<ProductivityRow[]> {
  // Nombres de la planilla.
  const { data: staffData } = await getDB().from("payroll_staff").select("id,name");
  const names = new Map<number, string>();
  for (const s of (staffData ?? []) as Array<{ id: number; name: string }>) names.set(s.id, s.name);

  // Gestiones en el rango, con vendedora asignada.
  const agg = new Map<number, { gestiones: number; pedidos: number; leads: Set<number> }>();
  const pageSize = 1000;
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await getDB()
      .from("lead_calls")
      .select("vendedora,kind,lead_id")
      .eq("store_id", storeId)
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso)
      .not("vendedora", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getProductivity: ${error.message}`);
    const page = (data ?? []) as Array<{ vendedora: number; kind: string; lead_id: number }>;
    for (const row of page) {
      let a = agg.get(row.vendedora);
      if (!a) {
        a = { gestiones: 0, pedidos: 0, leads: new Set() };
        agg.set(row.vendedora, a);
      }
      a.gestiones += 1;
      a.leads.add(row.lead_id);
      if (row.kind === "sale") a.pedidos += 1;
    }
    if (page.length < pageSize) break;
  }

  return Array.from(agg.entries())
    .map(([vendedora_id, a]) => ({
      vendedora_id,
      name: names.get(vendedora_id) ?? `Asesora ${vendedora_id}`,
      gestiones: a.gestiones,
      leads: a.leads.size,
      pedidos: a.pedidos,
    }))
    .sort((x, y) => y.pedidos - x.pedidos || y.gestiones - x.gestiones);
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
    tibios: 0,
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

/**
 * Registra un "resultado de la llamada" (gestion manual de la asesora).
 * status_source='manual' -> la ingesta NUNCA lo revierte. Si el estado es
 * terminal (lost/won) se marca closed_by. Devuelve el estado aplicado.
 */
export async function applyDisposition(opts: {
  storeId: number;
  leadId: number;
  vendedora: number;
  status: string;
  note?: string | null;
  nextFollowupAt?: string | null;
}): Promise<{ status: string; category: LeadCategory }> {
  const category = statusCategory(opts.status);
  const patch: Record<string, unknown> = {
    status: opts.status,
    category,
    status_source: "manual",
    auto_reason: null,
    needs_attention: false,
  };
  if (category === "lost" || category === "won") patch.closed_by = opts.vendedora;
  if (opts.nextFollowupAt !== undefined) patch.next_followup_at = opts.nextFollowupAt;

  const { error } = await getDB()
    .from("leads")
    .update(patch)
    .eq("store_id", opts.storeId)
    .eq("id", opts.leadId);
  if (error) throw new Error(`applyDisposition: ${error.message}`);

  await insertLeadCall({
    lead_id: opts.leadId,
    store_id: opts.storeId,
    vendedora: opts.vendedora,
    kind: "state_change",
    new_status: opts.status,
    note: opts.note ?? null,
    next_followup_at: opts.nextFollowupAt ?? null,
  });
  return { status: opts.status, category };
}

/**
 * Marca un lead como ganado detectado por el sistema (p.ej. el transcript
 * evidencia un pedido ya confirmado). NO toca leads con estado manual.
 */
export async function markLeadWonAuto(
  storeId: number,
  leadId: number,
  reason: string
): Promise<boolean> {
  const { data, error } = await getDB()
    .from("leads")
    .update({
      category: "won",
      status: "pedido_en_curso",
      has_order: true,
      auto_reason: reason,
    })
    .eq("store_id", storeId)
    .eq("id", leadId)
    .neq("status_source", "manual")
    // Solo si TODAVIA no esta marcado: sin este filtro el afinado volvia a
    // "detectar" el mismo pedido en cada corrida (cada 10 min) y sumaba una
    // gestion repetida al historial del lead.
    .neq("status", "pedido_en_curso")
    .select("id");
  if (error) throw new Error(`markLeadWonAuto: ${error.message}`);
  const changed = (data ?? []).length > 0;
  if (changed) {
    await insertLeadCall({
      lead_id: leadId,
      store_id: storeId,
      vendedora: null,
      kind: "system",
      new_status: "pedido_en_curso",
      note: reason,
    });
  }
  return changed;
}

/**
 * Version en LOTE de markLeadWonAuto: mueve muchos leads a ganado de una vez
 * (para el cruce con ordenes de Shopify, que puede tocar miles). No toca leads
 * con estado manual. Devuelve cuantos cambiaron.
 */
export async function markLeadsWonAuto(
  storeId: number,
  leadIds: number[],
  reason: string
): Promise<number> {
  if (!leadIds.length) return 0;
  let changed = 0;
  const chunk = 500;
  for (let i = 0; i < leadIds.length; i += chunk) {
    const ids = leadIds.slice(i, i + chunk);
    const { data, error } = await getDB()
      .from("leads")
      .update({ category: "won", status: "pedido_generado", has_order: true, auto_reason: reason })
      .eq("store_id", storeId)
      .in("id", ids)
      .neq("status_source", "manual")
      .select("id");
    if (error) throw new Error(`markLeadsWonAuto: ${error.message}`);
    const movedIds = ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
    changed += movedIds.length;
    if (movedIds.length) {
      const rows = movedIds.map((id) => ({
        lead_id: id,
        store_id: storeId,
        vendedora: null,
        kind: "system",
        new_status: "pedido_generado",
        note: reason,
      }));
      const { error: callErr } = await getDB().from("lead_calls").insert(rows);
      if (callErr) throw new Error(`markLeadsWonAuto lead_calls: ${callErr.message}`);
    }
  }
  return changed;
}

/**
 * Cruce eficiente contra ordenes reales de Shopify: delega TODO el match+move
 * a un RPC de Postgres (match_leads_to_shopify_orders) que corre en el servidor
 * en una sola sentencia con indice. No carga ordenes en memoria de la app (eso
 * saturaba la base). Mueve a Ganados los leads cuyo telefono ya tiene orden
 * vigente en la tienda, respetando estados manuales. Devuelve cuantos movio.
 */
export async function matchLeadsToShopifyOrders(storeId: number): Promise<number> {
  const { data, error } = await getDB().rpc("match_leads_to_shopify_orders", {
    p_store_id: storeId,
  });
  if (error) throw new Error(`matchLeadsToShopifyOrders: ${error.message}`);
  return typeof data === "number" ? data : Number(data ?? 0);
}

// ─── Historial de gestiones de un lead (timeline del drawer) ─────────────────
export interface LeadHistoryRow {
  id: number;
  kind: string;
  new_status: string | null;
  note: string | null;
  vendedora_name: string | null;
  occurred_at: string;
}

export async function getLeadHistory(storeId: number, leadId: number): Promise<LeadHistoryRow[]> {
  const { data, error } = await getDB()
    .from("lead_calls")
    .select("id,kind,new_status,note,vendedora,occurred_at")
    .eq("store_id", storeId)
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`getLeadHistory: ${error.message}`);
  const rows = (data ?? []) as Array<{
    id: number;
    kind: string;
    new_status: string | null;
    note: string | null;
    vendedora: number | null;
    occurred_at: string;
  }>;

  const ids = Array.from(new Set(rows.map((r) => r.vendedora).filter((v): v is number => v != null)));
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: staff } = await getDB().from("payroll_staff").select("id,name").in("id", ids);
    for (const s of (staff ?? []) as Array<{ id: number; name: string }>) names.set(s.id, s.name);
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    new_status: r.new_status,
    note: r.note,
    vendedora_name: r.vendedora != null ? names.get(r.vendedora) ?? null : null,
    occurred_at: r.occurred_at,
  }));
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
