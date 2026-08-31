// Capa de acceso a datos del modulo de Leads (Supabase, service role).
// El aislamiento por tienda se impone aqui (siempre filtrando store_id), igual
// que el resto de APIs del repo; no hay RLS todavia.

import { getDB } from "./db";
import { statusBoardStage, statusCategory, statusesForBoard, type BoardStage } from "./leads-classify";
import type { ChatLeadSummary, LeadCategory, LeadStateSnapshot, StatusSource } from "./leads-types";
import { normalizePhone, phoneConfigForStore } from "./phone-cr";
import { AGENT_LEG_ANSWERED, describeZadarmaCall } from "./zadarma";

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
  icomfly_cart_signal: boolean;
  shopify_cart_open: boolean;
  shopify_draft_cart_count: number;
  shopify_draft_updated_at: string | null;
  inbound_count: number;
  first_inbound_text: string | null;
  inbound_synced_at: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Bucket del tablero. Un Borrador abierto en Shopify es una cola operativa:
 * mientras nadie lo haya trabajado, el lead se ve en Carrito para que alguien
 * lo recupere.
 *
 * El orden de precedencia es este, y cada escalon existe por un motivo:
 *
 *   1. Descartado: es una decision sobre el cliente (lista negra, cancelado).
 *      Ni un pedido posterior ni un borrador viejo la deshacen; el mismo
 *      criterio que PURCHASE_PROOF_STATUSES en el clasificador.
 *   2. Ya tiene pedido -> CERRADOS. Vale tanto por estado (los won) como por
 *      el flag has_order, porque son dos caminos al mismo hecho: el flag lo
 *      pone el cruce con Shopify y NUNCA baja a false (lib/leads-sync.ts),
 *      pero el status si se recalcula, asi que un lead con pedido al que el
 *      bot le abre un carrito nuevo se reabria a "carrito_abandonado" y volvia
 *      a la cola de Carrito con su pedido intacto (medido: ~1 de cada 4
 *      carritos de CR y HN). La Cola ya descartaba esos leads por has_order
 *      (buildWorkQueue); el tablero no los miraba, y esa era la unica
 *      diferencia entre las dos vistas del mismo lead.
 *   3. Estado manual: la asesora ya lo trabajo, su estado decide el bucket.
 *      Lo que decidio una persona manda sobre la señal automatica (ley 2 del
 *      clasificador).
 *   4. Borrador abierto sin nada de lo anterior -> Carrito.
 *
 * Al cerrarse el borrador, un lead sin gestion vuelve solo al bucket de su
 * status.
 */
export function leadBoardStage(
  lead: Pick<LeadRecord, "status" | "status_source" | "shopify_cart_open" | "has_order">
): BoardStage {
  const stage = statusBoardStage(lead.status);
  if (stage === "descartado") return stage;
  if (stage === "cerrado" || lead.has_order) return "cerrado";
  if (lead.status_source === "manual") return stage;
  return lead.shopify_cart_open ? "carrito" : stage;
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
  | "icomfly_cart_signal"
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
      .select(
        "phone,category,status,status_source,has_order,has_cart_signal,icomfly_cart_signal,shopify_cart_open,shopify_draft_updated_at"
      )
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
        icomflyCartSignal: Boolean(row.icomfly_cart_signal),
        shopifyCartOpen: Boolean(row.shopify_cart_open),
        shopifyDraftUpdatedAt:
          typeof row.shopify_draft_updated_at === "string"
            ? row.shopify_draft_updated_at
            : null,
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

/**
 * Que mitad del tablero se pide.
 *
 *   trabajo -> lo que hay que gestionar (todos los buckets menos los dos de
 *              abajo). Es lo que se carga al abrir el tablero.
 *   archivo -> Cerrados y Descartados: ya tienen pedido o ya se cerraron, no
 *              se trabajan. Se cargan aparte, solo cuando alguien los pide.
 *
 * El corte es EXACTO respecto de leadBoardStage: archivo son los leads cuyo
 * status cae en cerrado/descartado mas los que tienen has_order; trabajo es su
 * complemento. Separarlos importa porque el archivo pesa mas que el trabajo
 * (medido en Costa Rica: 3.781 de 6.459 leads de la ventana) y antes se comia
 * el cupo de la consulta, dejando fuera de la pantalla a los que si hay que
 * llamar.
 */
export type LeadScope = "trabajo" | "archivo";

const ARCHIVE_STATUSES = [
  ...statusesForBoard("cerrado"),
  ...statusesForBoard("descartado"),
];

export interface ListLeadsOptions {
  storeId: number;
  stage?: BoardStage;
  limit?: number;
  /** Solo leads con interaccion desde este ISO (oculta los muy antiguos). */
  sinceIso?: string;
  /** Mitad del tablero a traer; por defecto, todo. */
  scope?: LeadScope;
}

/** La ventana de antiguedad, igual para la lista y para los conteos. */
function sinceFilter(sinceIso: string): string {
  // Oculta los muy antiguos, PERO conserva los que tienen seguimiento
  // programado o estan marcados para atencion (no se pueden perder).
  return `last_interaction_at.gte.${sinceIso},next_followup_at.not.is.null,needs_attention.is.true`;
}

/**
 * Filtro extra de una pasada. Se describe como dato (y no como callback sobre
 * el query builder) para que cada consulta quede escrita con las mismas
 * llamadas simples que el resto del archivo.
 */
type LeadNarrow =
  | { kind: "sin_archivo" }
  | { kind: "status_in"; statuses: string[] }
  | { kind: "has_order"; value: boolean };

/** Una pasada paginada sobre `leads`. */
async function fetchLeadPages<T>(opts: {
  storeId: number;
  select: string;
  limit: number;
  sinceIso?: string;
  narrow?: LeadNarrow;
}): Promise<T[]> {
  const pageSize = 1000;
  const all: T[] = [];
  for (let from = 0; from < opts.limit; from += pageSize) {
    let query = getDB()
      .from("leads")
      .select(opts.select)
      .eq("store_id", opts.storeId)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .range(from, Math.min(from + pageSize, opts.limit) - 1);
    if (opts.sinceIso) query = query.or(sinceFilter(opts.sinceIso));
    if (opts.narrow?.kind === "sin_archivo") {
      query = query
        .not("status", "in", `(${ARCHIVE_STATUSES.join(",")})`)
        .eq("has_order", false);
    } else if (opts.narrow?.kind === "status_in") {
      query = query.in("status", opts.narrow.statuses);
    } else if (opts.narrow?.kind === "has_order") {
      query = query.eq("has_order", opts.narrow.value);
    }
    const { data, error } = await query;
    if (error) throw new Error(`fetchLeadPages: ${error.message}`);
    const page = (data ?? []) as T[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

export async function listLeads(opts: ListLeadsOptions): Promise<LeadRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 2000, 1), 20000);
  const base = { storeId: opts.storeId, select: "*", limit, sinceIso: opts.sinceIso };
  let all: LeadRecord[];

  if (opts.scope === "trabajo") {
    // Complemento exacto del archivo: ni estado de cierre, ni pedido.
    all = await fetchLeadPages<LeadRecord>({
      ...base,
      narrow: { kind: "sin_archivo" },
    });
  } else if (opts.scope === "archivo") {
    // Son dos condiciones sobre columnas distintas unidas por O. Se piden en
    // dos pasadas y se unen por id en vez de armar un filtro compuesto: cada
    // consulta queda con la misma forma simple que el resto del archivo.
    const [byStatus, byOrder] = await Promise.all([
      fetchLeadPages<LeadRecord>({
        ...base,
        narrow: { kind: "status_in", statuses: ARCHIVE_STATUSES },
      }),
      fetchLeadPages<LeadRecord>({
        ...base,
        narrow: { kind: "has_order", value: true },
      }),
    ]);
    const byId = new Map<number, LeadRecord>();
    for (const lead of [...byStatus, ...byOrder]) byId.set(lead.id, lead);
    all = Array.from(byId.values()).sort(
      (a, b) => (b.last_interaction_at ?? "").localeCompare(a.last_interaction_at ?? "")
    );
  } else {
    all = await fetchLeadPages<LeadRecord>(base);
  }

  // El bucket del tablero se deriva del status; filtrar en memoria si se pidio.
  if (opts.stage) return all.filter((lead) => leadBoardStage(lead) === opts.stage);
  return all;
}

/**
 * Texto listo para meter en un filtro de PostgREST.
 *
 * Los caracteres que se quitan son los que tienen significado dentro de un
 * `or=(...)`: una coma partiria la condicion en dos y un parentesis la
 * cerraria antes de tiempo. Nadie busca un cliente por comas ni por asteriscos,
 * asi que se cambian por espacio en vez de intentar escaparlos.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()"'\\*%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Un texto sirve para buscar si tiene letras suficientes o digitos de telefono. */
export function isSearchable(q: string): boolean {
  return sanitizeSearch(q).length >= 2 || q.replace(/\D/g, "").length >= 3;
}

/**
 * Busca en TODA la tabla de la tienda: nombre, telefono y ultimo mensaje.
 *
 * Antes el buscador filtraba en memoria lo que el tablero ya tenia cargado, asi
 * que prometia "en todas las etapas" y en realidad no veia ni los cerrados ni
 * nada fuera de la ventana de 30 dias. Buscar el telefono de un cliente viejo
 * simplemente no daba resultados. Aca no se aplica ventana ni scope a
 * proposito: si la asesora escribe un telefono, quiere ese cliente, este donde
 * este.
 *
 * El telefono se compara por digitos porque en la tabla esta normalizado
 * (50661234567): asi "8428-8896" y "+506 8428 8896" encuentran lo mismo.
 */
export async function searchLeads(
  storeId: number,
  q: string,
  limit = 200
): Promise<LeadRecord[]> {
  if (!isSearchable(q)) return [];
  const texto = sanitizeSearch(q);
  const digitos = q.replace(/\D/g, "");
  const condiciones: string[] = [];
  if (texto.length >= 2) {
    condiciones.push(`name.ilike.%${texto}%`, `last_message_text.ilike.%${texto}%`);
  }
  if (digitos.length >= 3) condiciones.push(`phone.ilike.%${digitos}%`);

  const { data, error } = await getDB()
    .from("leads")
    .select("*")
    .eq("store_id", storeId)
    .or(condiciones.join(","))
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`searchLeads: ${error.message}`);
  return (data ?? []) as LeadRecord[];
}

/**
 * Telefonos parecidos, para cuando la busqueda exacta no encontro nada.
 *
 * Los celulares de CR/HN son de 8 digitos y la busqueda exacta pide la
 * secuencia completa: un digito de mas o de menos da cero resultados y ninguna
 * pista, asi que se da por perdido un lead que si existe. Caso real: se busco
 * 5068428896 y el lead estaba como 50684288896 — faltaba un 8.
 *
 * Solo se usa como PLAN B (ver `searchLeads` en la ruta): si la busqueda exacta
 * trajo algo, esto no corre.
 */
export async function searchLeadsByPhoneSimilar(
  storeId: number,
  q: string,
  limit = 8
): Promise<LeadRecord[]> {
  const digitos = q.replace(/\D/g, "");
  // Con menos de 6 digitos cualquier cosa se "parece" y la lista es ruido.
  if (digitos.length < 6) return [];
  const { data, error } = await getDB().rpc("leads_phone_similar", {
    p_store_id: storeId,
    p_phone: digitos,
    p_limit: limit,
  });
  if (error) throw new Error(`searchLeadsByPhoneSimilar: ${error.message}`);
  return (data ?? []) as LeadRecord[];
}

/**
 * Conteo por bucket sobre TODOS los leads elegibles, no sobre los que quepan
 * en una pantalla.
 *
 * Antes los contadores salian de contar la lista ya truncada, asi que decian
 * "Carrito 77" cuando en la base habia 246, y bajaban solos al entrar leads
 * nuevos que empujaban a los viejos fuera del cupo.
 *
 * POR QUE UN RPC: la version anterior ya pedia solo las cuatro columnas que
 * deciden el bucket, pero seguia bajando UNA FILA POR LEAD para contarlas aca.
 * PostgREST corta las respuestas en 1.000 filas, asi que en Costa Rica (6.212
 * elegibles) eran SIETE viajes de ida y vuelta antes de poder pintar los
 * contadores. Agrupando en Postgres es un viaje y 55 filas — el mismo conteo
 * tarda 17 ms en la base.
 *
 * El RPC devuelve las tuplas SIN clasificar a proposito: el mapeo a bucket
 * sigue saliendo de `leadBoardStage` y del catalogo de estados, que es la unica
 * fuente de verdad. Ver 0033_leads_stage_tuples.sql.
 */
export async function countLeadStages(
  storeId: number,
  sinceIso?: string
): Promise<LeadBoardCounts> {
  const { data, error } = await getDB().rpc("leads_stage_tuples", {
    p_store_id: storeId,
    p_since: sinceIso ?? null,
  });
  if (error) throw new Error(`countLeadStages: ${error.message}`);
  return countByStageTuples((data ?? []) as StageTuple[]);
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

/** Lo unico que decide el bucket, mas cuantos leads comparten esa combinacion. */
export type StageTuple = Pick<
  LeadRecord,
  "status" | "status_source" | "shopify_cart_open" | "has_order"
> & { n: number };

/**
 * Cuenta por bucket a partir de las tuplas ya agrupadas por Postgres.
 *
 * Es el mismo reparto de siempre, solo que cada fila trae su multiplicidad en
 * vez de venir repetida. El catalogo de estados sigue mandando: quien traduce
 * status -> bucket es `leadBoardStage`, aca y en la lista.
 */
export function countByStageTuples(tuples: StageTuple[]): LeadBoardCounts {
  const byStage: Record<BoardStage, number> = {
    por_cerrar: 0,
    pago_verificar: 0,
    carrito: 0,
    tibios: 0,
    seguimiento: 0,
    frio: 0,
    cerrado: 0,
    descartado: 0,
  };
  let total = 0;
  for (const tuple of tuples) {
    // `count(*)` de Postgres puede llegar como string segun el driver.
    const n = Number(tuple.n) || 0;
    byStage[leadBoardStage(tuple)] += n;
    total += n;
  }
  return { total, byStage };
}

/** Cuenta por bucket una lista de leads sueltos (una fila = un lead). */
export function countByStage(
  leads: Array<Pick<LeadRecord, "status" | "status_source" | "shopify_cart_open" | "has_order">>
): LeadBoardCounts {
  return countByStageTuples(leads.map((lead) => ({ ...lead, n: 1 })));
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

type ChatLeadRow = Pick<
  LeadRecord,
  "id" | "name" | "phone" | "labels" | "crm_conversation_id"
>;

function toChatLeadSummary(row: ChatLeadRow): ChatLeadSummary {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    labels: Array.isArray(row.labels) ? row.labels : [],
    hasConversation: Boolean(row.crm_conversation_id),
  };
}

/**
 * Enlaza un cliente de otro modulo con su conversacion de Leads.
 * Siempre limita por tienda; el telefono normalizado es la llave principal y
 * el pedido de Shopify solo se usa como respaldo.
 */
export async function findChatLeadForCustomer(opts: {
  storeId: number;
  storeCode: string;
  phone?: string | null;
  orderName?: string | null;
}): Promise<ChatLeadSummary | null> {
  const select = "id,name,phone,labels,crm_conversation_id,last_interaction_at";
  const normalizedPhone = normalizePhone(
    opts.phone,
    phoneConfigForStore(opts.storeCode)
  );

  if (normalizedPhone) {
    const { data, error } = await getDB()
      .from("leads")
      .select(select)
      .eq("store_id", opts.storeId)
      .eq("phone", normalizedPhone)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) throw new Error(`findChatLeadForCustomer(phone): ${error.message}`);
    const row = data?.[0] as ChatLeadRow | undefined;
    if (row) return toChatLeadSummary(row);
  }

  const rawOrder = String(opts.orderName ?? "").trim();
  if (!rawOrder) return null;
  const bareOrder = rawOrder.replace(/^#/, "");
  const orderCandidates = Array.from(
    new Set([rawOrder, bareOrder, `#${bareOrder}`].filter(Boolean))
  );
  const { data, error } = await getDB()
    .from("leads")
    .select(select)
    .eq("store_id", opts.storeId)
    .in("shopify_order_name", orderCandidates)
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`findChatLeadForCustomer(order): ${error.message}`);
  const row = data?.[0] as ChatLeadRow | undefined;
  return row ? toChatLeadSummary(row) : null;
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

interface ZadarmaCallHistoryRow {
  id: number;
  direction: string | null;
  status: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  vendedora: number | null;
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

  // Llamadas de la centralita (Zadarma). Es un timeline distinto al de las
  // gestiones: aqui va lo que paso en la linea, no lo que la asesora concluyo.
  // Si la migracion 0028 aun no esta aplicada, el historial de gestiones debe
  // seguir funcionando igual, por eso el error se traga.
  const { data: callData, error: callError } = await getDB()
    .from("zadarma_calls")
    .select("id,direction,status,duration_seconds,started_at,vendedora")
    .eq("store_id", storeId)
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (callError) {
    console.warn(`[leads] historial sin llamadas Zadarma: ${callError.message}`);
  }
  // La pata de timbrado que SI contesto no aporta nada: la llamada al cliente
  // viene enseguida como su propia fila y contarlas las dos duplicaria cada
  // llamada en el historial. La que NO contesto si se muestra: es la unica
  // forma de ver que se intento llamar y el telefono de la asesora nunca
  // descolgo, o sea que el cliente jamas sono.
  const calls = ((callData ?? []) as ZadarmaCallHistoryRow[]).filter(
    (r) => r.started_at && r.status !== AGENT_LEG_ANSWERED
  );

  const ids = Array.from(
    new Set(
      [...rows, ...calls]
        .map((r) => r.vendedora)
        .filter((v): v is number => v != null)
    )
  );
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: staff } = await getDB().from("payroll_staff").select("id,name").in("id", ids);
    for (const s of (staff ?? []) as Array<{ id: number; name: string }>) names.set(s.id, s.name);
  }

  const gestiones: LeadHistoryRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    new_status: r.new_status,
    note: r.note,
    vendedora_name: r.vendedora != null ? names.get(r.vendedora) ?? null : null,
    occurred_at: r.occurred_at,
  }));

  const telefonia: LeadHistoryRow[] = calls.map((r) => ({
    id: r.id,
    kind: "phone",
    new_status: null,
    note: describeZadarmaCall(r),
    vendedora_name: r.vendedora != null ? names.get(r.vendedora) ?? null : null,
    occurred_at: r.started_at as string,
  }));

  // Orden por instante, no por texto: las dos tablas pueden devolver la fecha
  // con formatos distintos y una comparacion de strings las mezclaria mal.
  return [...gestiones, ...telefonia].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)
  );
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
