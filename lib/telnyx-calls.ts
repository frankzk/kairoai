// Persistencia de la telefonia Telnyx: la credencial de cada asesora y el CDR
// que completa el webhook. Separado de lib/telnyx.ts para que aquel siga
// siendo puro y testeable sin Supabase.
//
// Las llamadas van a la MISMA tabla que las de Zadarma (zadarma_calls, con
// provider = 'telnyx'): el historial del lead, la "ultima llamada" y la
// productividad ya leen de ahi y no hay que tocarlos.

import crypto from "crypto";
import { getDB } from "@/lib/db";
import {
  claveLlamadaTelnyx,
  crearCredencial,
  estadoDeColgado,
  iniciarGrabacion,
  leerEstadoCliente,
  segundosDeConversacion,
  type EventoTelnyx,
  type TelnyxConfig,
} from "@/lib/telnyx";

export interface AsesoraTelnyx {
  id: number;
  name: string;
  credentialId: string;
}

/**
 * La credencial de Telnyx de la asesora; la crea la primera vez. Asi no hay
 * que asignar extensiones a mano como en Zadarma: cada asesora activa tiene la
 * suya al abrir Leads.
 */
export async function credencialDeAsesora(
  staffId: number,
  cfg: TelnyxConfig,
  fetchImpl?: typeof fetch
): Promise<AsesoraTelnyx | null> {
  const db = getDB();
  const { data, error } = await db
    .from("payroll_staff")
    .select("id, name, active, telnyx_credential_id")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw new Error(`credencialDeAsesora: ${error.message}`);
  const row = data as { id: number; name: string; active: boolean | null; telnyx_credential_id: string | null } | null;
  if (!row || row.active === false) return null;
  if (row.telnyx_credential_id) return { id: row.id, name: String(row.name), credentialId: row.telnyx_credential_id };

  const nueva = await crearCredencial(cfg, { nombre: `Kairo · ${row.name}`, tag: `kairo-staff-${row.id}` }, fetchImpl);
  // Solo si sigue vacia: dos pestañas abriendo Leads a la vez crearian dos
  // credenciales; gana la primera y la otra queda sin usar en Telnyx.
  const { error: errUpd } = await db
    .from("payroll_staff")
    .update({ telnyx_credential_id: nueva.id, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("telnyx_credential_id", null);
  if (errUpd) throw new Error(`credencialDeAsesora: ${errUpd.message}`);

  const { data: final } = await db.from("payroll_staff").select("telnyx_credential_id").eq("id", row.id).maybeSingle();
  const credentialId = (final as { telnyx_credential_id: string | null } | null)?.telnyx_credential_id ?? nueva.id;
  return { id: row.id, name: String(row.name), credentialId };
}

/**
 * La fila de la llamada, ANTES de marcar. El webhook la encuentra por el id
 * que viaja en client_state; lead, tienda y asesora quedan fijados aqui, del
 * lado del servidor.
 */
export async function crearLlamadaTelnyx(opts: {
  storeId: number;
  leadId: number | null;
  vendedoraId: number;
  phone: string;
}): Promise<string> {
  const llamadaId = crypto.randomUUID();
  const { error } = await getDB()
    .from("zadarma_calls")
    .insert({
      pbx_call_id: claveLlamadaTelnyx(llamadaId),
      provider: "telnyx",
      direction: "outgoing",
      store_id: opts.storeId,
      lead_id: opts.leadId,
      vendedora: opts.vendedoraId,
      phone: opts.phone,
      raw_phone: opts.phone,
      status: "calling",
      started_at: new Date().toISOString(),
    });
  if (error) throw new Error(`crearLlamadaTelnyx: ${error.message}`);
  return llamadaId;
}

interface FilaLlamada {
  id: number;
  answered_at: string | null;
  ended_at: string | null;
  status: string | null;
}

/**
 * Aplica un evento del webhook a su llamada. Los eventos pueden llegar
 * repetidos o desordenados: cada uno solo escribe lo suyo y el estado final se
 * recalcula con lo que ya se sabia (un "contestada" tardio corrige un colgado
 * que llego antes).
 */
export async function aplicarEventoTelnyx(
  ev: EventoTelnyx,
  opts: { cfg: TelnyxConfig | null; grabar: boolean; fetchImpl?: typeof fetch }
): Promise<"aplicado" | "ignorado"> {
  const llamadaId = leerEstadoCliente(ev.clientState);
  if (!llamadaId) return "ignorado";

  const db = getDB();
  const { data, error } = await db
    .from("zadarma_calls")
    .select("id, answered_at, ended_at, status")
    .eq("pbx_call_id", claveLlamadaTelnyx(llamadaId))
    .maybeSingle();
  if (error) throw new Error(`aplicarEventoTelnyx: ${error.message}`);
  const fila = data as FilaLlamada | null;
  if (!fila) return "ignorado";

  const cambios: Record<string, unknown> = {};
  switch (ev.tipo) {
    case "call.initiated":
      // Solo si nada mas avanzado llego antes.
      if (fila.status === "calling") cambios.status = "ringing";
      break;
    case "call.answered": {
      const contesto = fila.answered_at ?? ev.ocurrio;
      cambios.answered_at = contesto;
      cambios.status = "answered";
      if (fila.ended_at) cambios.duration_seconds = segundosDeConversacion(contesto, fila.ended_at);
      // Grabar arranca al contestar: antes no hay conversacion que grabar.
      if (opts.grabar && opts.cfg && ev.callControlId && !fila.answered_at) {
        await iniciarGrabacion(opts.cfg, ev.callControlId, opts.fetchImpl).catch((err) =>
          console.warn(`[telnyx] no se pudo grabar la llamada ${fila.id}: ${err instanceof Error ? err.message : err}`)
        );
      }
      break;
    }
    case "call.hangup": {
      const colgo = fila.ended_at ?? ev.ocurrio;
      cambios.ended_at = colgo;
      cambios.status = estadoDeColgado(ev.hangupCause, Boolean(fila.answered_at));
      cambios.duration_seconds = segundosDeConversacion(fila.answered_at, colgo);
      break;
    }
    case "call.recording.saved":
      cambios.is_recorded = true;
      if (ev.recordingUrl) cambios.record_url = ev.recordingUrl;
      break;
  }
  if (!Object.keys(cambios).length) return "aplicado";

  const { error: errUpd } = await db.from("zadarma_calls").update(cambios).eq("id", fila.id);
  if (errUpd) throw new Error(`aplicarEventoTelnyx: ${errUpd.message}`);
  return "aplicado";
}
