// Persistencia de la telefonia Zadarma: quien tiene extension y el CDR que
// deja el webhook. Separado de lib/zadarma.ts para que aquel siga siendo puro
// (fetch + crypto) y testeable sin Supabase.

import { getDB } from "@/lib/db";
import { normalizePhone, phoneConfigForStore } from "@/lib/phone-cr";
import { FINANCE_STORES } from "@/lib/store-config";
import { isValidSipLogin, parseZadarmaTime } from "@/lib/zadarma";

export interface ZadarmaAgent {
  id: number;
  name: string;
  sip: string;
}

/**
 * Asesora dueña de una extension.
 *
 * Guardamos el login completo ('499499-103') pero los webhooks reportan
 * `internal` en corto ('103'), asi que hay que aceptar las dos formas: con
 * solo la exacta, TODAS las llamadas quedaban sin asesora en el CDR y la
 * atribucion por persona no servia para nada.
 */
export async function getAgentBySip(sip: string): Promise<ZadarmaAgent | null> {
  const value = sip.trim();
  // Se valida antes de interpolar en el filtro `or` de PostgREST.
  if (!isValidSipLogin(value)) return null;

  const { data, error } = await getDB()
    .from("payroll_staff")
    .select("id, name, zadarma_sip")
    .or(`zadarma_sip.eq.${value},zadarma_sip.like.*-${value}`)
    .limit(1);
  if (error) throw new Error(`getAgentBySip: ${error.message}`);

  const row = data?.[0] as { id: number; name: string; zadarma_sip: string | null } | undefined;
  if (!row?.zadarma_sip) return null;
  return { id: row.id, name: String(row.name), sip: String(row.zadarma_sip) };
}

export async function getAgentById(staffId: number): Promise<ZadarmaAgent | null> {
  const { data, error } = await getDB()
    .from("payroll_staff")
    .select("id, name, zadarma_sip, active")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw new Error(`getAgentById: ${error.message}`);
  if (!data || data.active === false || !data.zadarma_sip) return null;
  return { id: data.id as number, name: String(data.name), sip: String(data.zadarma_sip) };
}

/**
 * Busca el lead dueño de un telefono. Zadarma no sabe de tiendas, asi que se
 * prueba la normalizacion de cada pais configurado y gana la coincidencia
 * exacta; sin coincidencia el CDR queda sin lead (no se inventa uno).
 */
export async function findLeadByPhone(
  rawPhone: string
): Promise<{ leadId: number; storeId: number; phone: string } | null> {
  const candidates = new Set<string>();
  for (const store of FINANCE_STORES) {
    const normalized = normalizePhone(rawPhone, phoneConfigForStore(store.code));
    if (normalized) candidates.add(normalized);
  }
  // Ultimo recurso: los digitos tal cual, por si la centralita ya entrega
  // el numero en E.164 de un pais que aun no esta en FINANCE_STORES.
  const digits = rawPhone.replace(/\D+/g, "");
  if (digits) candidates.add(digits);
  if (candidates.size === 0) return null;

  const { data, error } = await getDB()
    .from("leads")
    .select("id, store_id, phone, last_interaction_at")
    .in("phone", Array.from(candidates))
    .order("last_interaction_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw new Error(`findLeadByPhone: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return { leadId: row.id as number, storeId: row.store_id as number, phone: String(row.phone) };
}

export interface ZadarmaCallUpsert {
  pbxCallId: string;
  direction?: "outgoing" | "incoming";
  internal?: string | null;
  rawPhone?: string | null;
  status?: string | null;
  durationSeconds?: number | null;
  isRecorded?: boolean | null;
  callIdWithRec?: string | null;
  recordUrl?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  /** Datos ya resueltos por quien llama (evita releer en el webhook). */
  leadId?: number | null;
  storeId?: number | null;
  vendedoraId?: number | null;
  phone?: string | null;
}

/**
 * Inserta o completa el CDR de una llamada. Los eventos llegan en varias
 * partes (start, end, record) y pueden desordenarse, por eso solo se escriben
 * los campos presentes: un evento tardio nunca borra lo que ya se sabia.
 */
export async function upsertZadarmaCall(input: ZadarmaCallUpsert): Promise<void> {
  const row: Record<string, unknown> = { pbx_call_id: input.pbxCallId };
  const set = <T,>(column: string, value: T | null | undefined) => {
    if (value !== undefined && value !== null) row[column] = value;
  };

  set("direction", input.direction);
  set("internal", input.internal);
  set("raw_phone", input.rawPhone);
  set("phone", input.phone);
  set("status", input.status);
  set("duration_seconds", input.durationSeconds);
  set("is_recorded", input.isRecorded);
  set("call_id_with_rec", input.callIdWithRec);
  set("record_url", input.recordUrl);
  set("started_at", input.startedAt);
  set("ended_at", input.endedAt);
  set("lead_id", input.leadId);
  set("store_id", input.storeId);
  set("vendedora", input.vendedoraId);
  row.updated_at = new Date().toISOString();

  const { error } = await getDB()
    .from("zadarma_calls")
    .upsert(row, { onConflict: "pbx_call_id" });
  if (error) throw new Error(`upsertZadarmaCall: ${error.message}`);
}

/**
 * Enriquece un evento de la centralita con lead / tienda / asesora. Cada pieza
 * es opcional: una llamada a un numero desconocido igual se registra.
 */
export async function resolveCallContext(opts: {
  rawPhone?: string | null;
  internal?: string | null;
}): Promise<{
  leadId: number | null;
  storeId: number | null;
  vendedoraId: number | null;
  phone: string | null;
}> {
  const [lead, agent] = await Promise.all([
    opts.rawPhone ? findLeadByPhone(opts.rawPhone).catch(() => null) : Promise.resolve(null),
    opts.internal ? getAgentBySip(opts.internal).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    leadId: lead?.leadId ?? null,
    storeId: lead?.storeId ?? null,
    vendedoraId: agent?.id ?? null,
    phone: lead?.phone ?? (opts.rawPhone ? opts.rawPhone.replace(/\D+/g, "") || null : null),
  };
}

/**
 * Telefono de un pedido de Shopify, leido de la base por nombre (#MCRC20388)
 * dentro de la tienda. El drawer de Gestion de pedidos llama desde aqui, y el
 * numero tiene que salir del pedido guardado, no de lo que mande el navegador.
 */
export async function getOrderPhone(
  storeId: number,
  orderName: string
): Promise<{ phone: string; customerName: string } | null> {
  const name = orderName.trim();
  if (!name) return null;

  const { data, error } = await getDB()
    .from("shopify_orders")
    .select("name, phone, customer_name")
    .eq("store_id", storeId)
    .eq("name", name)
    .limit(1);
  if (error) throw new Error(`getOrderPhone: ${error.message}`);

  const row = data?.[0] as { phone: string | null; customer_name: string | null } | undefined;
  if (!row?.phone) return null;
  return { phone: String(row.phone), customerName: String(row.customer_name ?? "") };
}

/** Normaliza los campos de tiempo de un evento a ISO. */
export function eventTimes(body: Record<string, string | undefined>): {
  startedAt: string | null;
  endedAt: string | null;
} {
  const startedAt = parseZadarmaTime(body.call_start);
  const duration = Number(body.duration ?? 0);
  const endedAt =
    startedAt && Number.isFinite(duration) && duration >= 0
      ? new Date(Date.parse(startedAt) + duration * 1000).toISOString()
      : null;
  return { startedAt, endedAt };
}
