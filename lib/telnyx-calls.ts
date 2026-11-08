// Persistencia de la telefonia Telnyx: la credencial de cada asesora y el CDR
// que completa el webhook. Separado de lib/telnyx.ts para que aquel siga
// siendo puro y testeable sin Supabase.
//
// Las llamadas van a la MISMA tabla que las de Zadarma (zadarma_calls, con
// provider = 'telnyx'): el historial del lead, la "ultima llamada" y la
// productividad ya leen de ahi y no hay que tocarlos.

import crypto from "crypto";
import { getDB } from "@/lib/db";
import { esColumnaFaltante, type FilaGrabacion } from "@/lib/grabaciones";
import {
  claveLlamadaTelnyx,
  crearCredencial,
  ESTADO_NO_MARCADA,
  estadoDeColgado,
  iniciarGrabacion,
  leerEstadoCliente,
  segundosDeConversacion,
  tokenDeCredencial,
  vencimientoToken,
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
    // Con la base saturada, mejor fallar rapido: el navegador reintenta.
    .abortSignal(AbortSignal.timeout(8_000))
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

// Token por asesora, mientras le queden mas de 10 minutos. El 02/11/2026, con
// la base saturada, pedir credencial y token en cada carga de pagina hacia que
// /api/telnyx/token llegara a su limite de 20 s y el telefono no se conectara.
// Con esto, una pagina recargada no toca ni la base ni Telnyx.
const MARGEN_TOKEN_MS = 10 * 60_000;
const tokens = new Map<number, { token: string; vence: number; asesora: string }>();

/** El token del navegador de la asesora (reutilizado si sigue vigente). */
export async function tokenDeAsesora(
  staffId: number,
  cfg: TelnyxConfig,
  fetchImpl?: typeof fetch,
  forzarToken = false,
): Promise<{ token: string; asesora: string } | null> {
  // A browser-rejected JWT must not come back from the server cache.
  if (forzarToken) tokens.delete(staffId);
  const guardado = tokens.get(staffId);
  if (guardado && guardado.vence - MARGEN_TOKEN_MS > Date.now()) {
    return { token: guardado.token, asesora: guardado.asesora };
  }
  const asesora = await credencialDeAsesora(staffId, cfg, fetchImpl);
  if (!asesora) return null;
  const token = await tokenDeCredencial(cfg, asesora.credentialId, fetchImpl);
  const vence = vencimientoToken(token);
  if (vence) tokens.set(staffId, { token, vence, asesora: asesora.name });
  return { token, asesora: asesora.name };
}

/** Solo para tests. */
export function olvidarTokensTelnyx(): void {
  tokens.clear();
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
  /** Pedido por el que se llama (Gestion de pedidos o Novedades), o null. */
  orderName?: string | null;
}): Promise<string> {
  const llamadaId = crypto.randomUUID();
  const db = getDB();
  // Las de esta asesora que quedaron preparadas y sin ningun aviso de Telnyx
  // hace mas de un minuto no salieron: una asesora no tiene dos llamadas a la
  // vez. Si Telnyx avisa despues, el webhook pone el estado real.
  const { error: errViejas } = await db
    .from("zadarma_calls")
    .update({ status: ESTADO_NO_MARCADA })
    .eq("provider", "telnyx")
    .eq("vendedora", opts.vendedoraId)
    .eq("status", "calling")
    .lt("started_at", new Date(Date.now() - 60_000).toISOString());
  if (errViejas) console.warn(`[telnyx] no se pudieron cerrar llamadas sin marcar: ${errViejas.message}`);

  const fila: Record<string, unknown> = {
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
  };
  const orderName = (opts.orderName ?? "").trim();
  if (orderName) fila.order_name = orderName;
  let { error } = await db.from("zadarma_calls").insert(fila);
  // Sin la migracion de grabaciones no existe order_name: la llamada sale
  // igual, solo sin el pedido (el historial la encuentra por el telefono).
  if (error && "order_name" in fila && esColumnaFaltante(error)) {
    delete fila.order_name;
    ({ error } = await db.from("zadarma_calls").insert(fila));
  }
  if (error) throw new Error(`crearLlamadaTelnyx: ${error.message}`);
  return llamadaId;
}

interface FilaLlamada {
  id: number;
  store_id: number | null;
  started_at: string | null;
  created_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  status: string | null;
  telnyx_call_control_id: string | null;
}

/**
 * Aplica un evento del webhook a su llamada. Los eventos pueden llegar
 * repetidos o desordenados: cada uno solo escribe lo suyo y el estado final se
 * recalcula con lo que ya se sabia (un "contestada" tardio corrige un colgado
 * que llego antes).
 */
export async function aplicarEventoTelnyx(
  ev: EventoTelnyx,
  opts: {
    cfg: TelnyxConfig | null;
    grabar: boolean;
    fetchImpl?: typeof fetch;
    /**
     * Con call.recording.saved ya anotado: copiar el mp3 a nuestro bucket. La
     * ruta del webhook lo manda a segundo plano (lib/segundo-plano.ts).
     */
    copiarGrabacion?: (fila: FilaGrabacion, url: string | null) => void;
  }
): Promise<"aplicado" | "ignorado"> {
  const llamadaId = leerEstadoCliente(ev.clientState);
  // Sin client_state solo se reconoce por el id de Telnyx guardado en un
  // evento anterior (pasa si call.cost llega sin el client_state).
  if (!llamadaId && !ev.callControlId) return "ignorado";

  const db = getDB();
  const consulta = db
    .from("zadarma_calls")
    .select("id, store_id, started_at, created_at, answered_at, ended_at, status, telnyx_call_control_id");
  const { data, error } = await (llamadaId
    ? consulta.eq("pbx_call_id", claveLlamadaTelnyx(llamadaId))
    : consulta.eq("provider", "telnyx").eq("telnyx_call_control_id", ev.callControlId as string)
  ).maybeSingle();
  if (error) throw new Error(`aplicarEventoTelnyx: ${error.message}`);
  const fila = data as FilaLlamada | null;
  if (!fila) return "ignorado";

  const cambios: Record<string, unknown> = {};
  if (ev.callControlId && !fila.telnyx_call_control_id) cambios.telnyx_call_control_id = ev.callControlId;
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
      if (ev.recordingId) cambios.recording_id = ev.recordingId;
      break;
    case "call.cost":
      // Sin costo calculable (status error) no se escribe nada: vacio, no 0.
      if (ev.costo) {
        cambios.cost = ev.costo.total;
        cambios.cost_currency = ev.costo.moneda;
        cambios.billed_seconds = ev.costo.segundosCobrados;
      }
      break;
  }
  if (!Object.keys(cambios).length) return "aplicado";

  let { error: errUpd } = await db.from("zadarma_calls").update(cambios).eq("id", fila.id);
  // Sin la migracion de grabaciones no existe recording_id: se guarda lo de
  // siempre (y Telnyx no reintenta el evento por un 500).
  if (errUpd && "recording_id" in cambios && esColumnaFaltante(errUpd)) {
    delete cambios.recording_id;
    ({ error: errUpd } = await db.from("zadarma_calls").update(cambios).eq("id", fila.id));
  }
  if (errUpd) throw new Error(`aplicarEventoTelnyx: ${errUpd.message}`);

  if (ev.tipo === "call.recording.saved" && opts.copiarGrabacion && (ev.recordingUrl || ev.recordingId)) {
    opts.copiarGrabacion(
      {
        id: fila.id,
        provider: "telnyx",
        store_id: fila.store_id,
        started_at: fila.started_at,
        created_at: fila.created_at,
        recording_id: ev.recordingId,
        record_url: ev.recordingUrl,
        recording_attempts: 0,
      },
      ev.recordingUrl
    );
  }
  return "aplicado";
}
