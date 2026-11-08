// Cliente de la API de Telnyx para que las asesoras llamen desde el navegador.
//
// Como funciona (distinto de Zadarma, ver lib/zadarma.ts):
//   1. Cada asesora tiene una credencial de telefonia en la Credential
//      Connection de Telnyx (TELNYX_CONNECTION_ID). Kairo la crea sola la
//      primera vez y la guarda en payroll_staff.telnyx_credential_id.
//   2. Al abrir Leads, Kairo le pide a Telnyx un token (JWT) de esa credencial
//      y el navegador se conecta con @telnyx/webrtc.
//   3. Al pulsar "Llamar", Kairo decide el numero (del lead o del pedido, nunca
//      de la pantalla) y el caller ID de la tienda, y el navegador marca al
//      cliente DIRECTO: una sola llamada, no "timbra a la asesora y despues al
//      cliente" como el callback de Zadarma.
//   4. Telnyx avisa el ciclo de vida (call.initiated / answered / hangup /
//      recording.saved) a /api/telnyx/webhook, firmado con Ed25519. El
//      client_state que manda el navegador lleva el id de la llamada que creo
//      Kairo, y con eso el webhook llena la misma tabla de llamadas que usa
//      Zadarma (zadarma_calls, columna provider = 'telnyx').
//
// Este modulo es puro (fetch + crypto): no toca Supabase, para poder testear
// la firma y el parseo sin base de datos.
//
// Endpoints y campos verificados contra el SDK oficial `telnyx` 7.26 y
// `@telnyx/webrtc` 2.27.10 (noviembre de 2026).

import crypto from "crypto";

const API_BASE = "https://api.telnyx.com/v2";

// ─── Proveedor de telefonia ──────────────────────────────────────────────────

export type ProveedorTelefonia = "zadarma" | "telnyx";

/**
 * Que telefono usan las asesoras. TELEFONIA=telnyx lo cambia sin compilar de
 * nuevo; sin la variable sigue Zadarma, que es lo que habia.
 */
export function proveedorTelefonia(env: Record<string, string | undefined> = process.env): ProveedorTelefonia {
  return (env.TELEFONIA ?? "").trim().toLowerCase() === "telnyx" ? "telnyx" : "zadarma";
}

// ─── Configuracion ───────────────────────────────────────────────────────────

export interface TelnyxConfig {
  apiKey: string;
  /** Credential Connection donde viven las credenciales de las asesoras. */
  connectionId: string;
}

export function getTelnyxConfig(env: Record<string, string | undefined> = process.env): {
  config: TelnyxConfig | null;
  faltan: string[];
} {
  const apiKey = (env.TELNYX_API_KEY ?? "").trim();
  const connectionId = (env.TELNYX_CONNECTION_ID ?? "").trim();
  const faltan = [!apiKey ? "TELNYX_API_KEY" : "", !connectionId ? "TELNYX_CONNECTION_ID" : ""].filter(Boolean);
  return { config: faltan.length ? null : { apiKey, connectionId }, faltan };
}

/** Llave publica (base64) con la que Telnyx firma los webhooks: Mission Control → Keys & Credentials → Public Key. */
export function telnyxPublicKey(env: Record<string, string | undefined> = process.env): string | null {
  return (env.TELNYX_PUBLIC_KEY ?? "").trim() || null;
}

/** Nombre de la variable del numero que ve el cliente en cada pais. */
export function variableCallerId(countryCode: string): string {
  return `TELNYX_CALLER_ID_${countryCode.toUpperCase()}`;
}

/**
 * Numero que ve el cliente, en E.164 con '+'. Va por PAIS de la tienda: un
 * cliente de Costa Rica que ve un +1 de Estados Unidos contesta mucho menos.
 * Tiene que ser un numero de la cuenta de Telnyx (o uno verificado ahi).
 */
export function callerIdDeTienda(
  countryCode: string,
  env: Record<string, string | undefined> = process.env
): string | null {
  const digits = (env[variableCallerId(countryCode)] ?? "").replace(/\D+/g, "");
  return digits.length >= 8 ? `+${digits}` : null;
}

/**
 * Grabar las llamadas: TELNYX_GRABAR=1. Apagado por defecto: grabar exige
 * avisarle al cliente, y eso lo decide la operacion, no el codigo.
 */
export function grabarLlamadas(env: Record<string, string | undefined> = process.env): boolean {
  return (env.TELNYX_GRABAR ?? "").trim() === "1";
}

// ─── API REST ────────────────────────────────────────────────────────────────

export class TelnyxError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "TelnyxError";
  }
}

type Fetch = typeof fetch;

const TIMEOUT_TELNYX_MS = 8_000;

async function telnyxFetch(
  cfg: TelnyxConfig,
  path: string,
  opts: { method?: string; body?: unknown; accept?: string } = {},
  fetchImpl: Fetch = fetch
): Promise<string> {
  const res = await fetchImpl(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: opts.accept ?? "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    // Telnyx lento no puede colgar la ruta hasta su limite (20 s): mejor un
    // error rapido que el navegador reintenta.
    signal: AbortSignal.timeout(TIMEOUT_TELNYX_MS),
  });
  const texto = await res.text();
  if (!res.ok) {
    // Telnyx explica el error en errors[0].detail; se muestra eso y no el JSON.
    let detalle = texto.slice(0, 200);
    try {
      const data = JSON.parse(texto) as { errors?: Array<{ title?: string; detail?: string }> };
      const e = data.errors?.[0];
      if (e) detalle = e.detail || e.title || detalle;
    } catch {
      // No era JSON: queda el texto.
    }
    const pista = res.status === 401 ? " (revisa TELNYX_API_KEY)" : "";
    throw new TelnyxError(`Telnyx ${res.status}: ${detalle}${pista}`, res.status);
  }
  return texto;
}

export interface CredencialTelnyx {
  id: string;
  sipUsername: string | null;
}

/** POST /telephony_credentials: credencial nueva en la Credential Connection. */
export async function crearCredencial(
  cfg: TelnyxConfig,
  opts: { nombre: string; tag: string },
  fetchImpl?: Fetch
): Promise<CredencialTelnyx> {
  const texto = await telnyxFetch(
    cfg,
    "/telephony_credentials",
    { method: "POST", body: { connection_id: cfg.connectionId, name: opts.nombre, tag: opts.tag } },
    fetchImpl
  );
  const data = (JSON.parse(texto) as { data?: { id?: string; sip_username?: string } }).data;
  if (!data?.id) throw new TelnyxError("Telnyx no devolvió la credencial creada", 502);
  return { id: data.id, sipUsername: data.sip_username ?? null };
}

/** POST /telephony_credentials/{id}/token: el JWT con que se conecta el navegador (texto plano). */
export async function tokenDeCredencial(cfg: TelnyxConfig, credentialId: string, fetchImpl?: Fetch): Promise<string> {
  const token = (
    await telnyxFetch(
      cfg,
      `/telephony_credentials/${encodeURIComponent(credentialId)}/token`,
      { method: "POST", accept: "text/plain" },
      fetchImpl
    )
  ).trim();
  if (!token) throw new TelnyxError("Telnyx no devolvió el token", 502);
  return token;
}

/**
 * Si la Credential Connection manda el evento call.cost al terminar cada
 * llamada (call_cost_in_webhooks). Sin eso Kairo no se entera del costo.
 */
export async function costoEnWebhooksActivo(cfg: TelnyxConfig, fetchImpl?: Fetch): Promise<boolean> {
  const texto = await telnyxFetch(cfg, `/credential_connections/${encodeURIComponent(cfg.connectionId)}`, {}, fetchImpl);
  const data = (JSON.parse(texto) as { data?: { call_cost_in_webhooks?: unknown } }).data;
  return data?.call_cost_in_webhooks === true;
}

/** PATCH de la Credential Connection: activa call_cost_in_webhooks y nada mas. */
export async function activarCostoEnWebhooks(cfg: TelnyxConfig, fetchImpl?: Fetch): Promise<boolean> {
  const texto = await telnyxFetch(
    cfg,
    `/credential_connections/${encodeURIComponent(cfg.connectionId)}`,
    { method: "PATCH", body: { call_cost_in_webhooks: true } },
    fetchImpl
  );
  const data = (JSON.parse(texto) as { data?: { call_cost_in_webhooks?: unknown } }).data;
  return data?.call_cost_in_webhooks === true;
}

/**
 * Hasta cuando sirve un token (el `exp` del JWT, en ms), o null si no se puede
 * leer. Con esto el servidor y el navegador reutilizan el mismo token mientras
 * siga vigente, en vez de pedirlo en cada carga de pagina (02/11/2026: con la
 * base saturada, pedirlo de nuevo dejaba el telefono "conectandose").
 */
export function vencimientoToken(token: string): number | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const json = JSON.parse(Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
      exp?: unknown;
    };
    const exp = Number(json.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Llave de la API para lo que no necesita la Credential Connection (bajar
 * grabaciones): basta TELNYX_API_KEY. null sin la llave.
 */
export function telnyxApiConfig(env: Record<string, string | undefined> = process.env): TelnyxConfig | null {
  const apiKey = (env.TELNYX_API_KEY ?? "").trim();
  return apiKey ? { apiKey, connectionId: (env.TELNYX_CONNECTION_ID ?? "").trim() } : null;
}

/**
 * GET /recordings/{id}: enlace NUEVO para bajar el mp3 de una grabacion. Los
 * enlaces del webhook (recording_urls) son prefirmados y vencen en ~10
 * minutos; este se pide justo antes de bajar el archivo. Campo:
 * data.download_urls.mp3 (Telnyx v2, Recordings API).
 */
export async function urlGrabacionTelnyx(cfg: TelnyxConfig, recordingId: string, fetchImpl?: Fetch): Promise<string> {
  const texto = await telnyxFetch(cfg, `/recordings/${encodeURIComponent(recordingId)}`, {}, fetchImpl);
  const data = (JSON.parse(texto) as { data?: { download_urls?: { mp3?: unknown } } }).data;
  const mp3 = data?.download_urls?.mp3;
  if (typeof mp3 !== "string" || !mp3) throw new TelnyxError("Telnyx no devolvió el enlace del mp3", 502);
  return mp3;
}

/** POST /calls/{id}/actions/record_start: graba la conversacion (las dos voces, por separado). */
export async function iniciarGrabacion(cfg: TelnyxConfig, callControlId: string, fetchImpl?: Fetch): Promise<void> {
  await telnyxFetch(
    cfg,
    `/calls/${encodeURIComponent(callControlId)}/actions/record_start`,
    { method: "POST", body: { format: "mp3", channels: "dual" } },
    fetchImpl
  );
}

// ─── Firma de los webhooks ───────────────────────────────────────────────────

// Prefijo DER (SubjectPublicKeyInfo) de una llave Ed25519: Telnyx da los 32
// bytes crudos en base64 y Node necesita la llave envuelta.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Telnyx rechaza mas de 5 minutos de diferencia; aqui igual (anti-replay). */
const TOLERANCIA_SEGUNDOS = 300;

/**
 * Verifica telnyx-signature-ed25519 sobre `${telnyx-timestamp}|${cuerpo}`.
 * El cuerpo tiene que ser el TEXTO CRUDO tal como llego: re-serializar el JSON
 * cambia espacios y rompe la firma.
 */
export function verificarFirmaTelnyx(opts: {
  cuerpo: string;
  firma: string | null;
  timestamp: string | null;
  publicKey: string;
  ahoraSegundos?: number;
}): { ok: true } | { ok: false; motivo: string } {
  const { cuerpo, firma, timestamp, publicKey } = opts;
  if (!firma || !timestamp) return { ok: false, motivo: "faltan las cabeceras de firma" };
  if (!/^\d+$/.test(timestamp)) return { ok: false, motivo: "timestamp invalido" };
  const ahora = opts.ahoraSegundos ?? Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - Number(timestamp)) > TOLERANCIA_SEGUNDOS) {
    return { ok: false, motivo: "timestamp fuera de tiempo" };
  }

  const llave = Buffer.from(publicKey, "base64");
  if (llave.length !== 32) return { ok: false, motivo: "TELNYX_PUBLIC_KEY no es una llave Ed25519 (32 bytes en base64)" };
  const sig = Buffer.from(firma, "base64");
  if (sig.length !== 64) return { ok: false, motivo: "firma invalida" };

  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, llave]), format: "der", type: "spki" });
    const valida = crypto.verify(null, Buffer.from(`${timestamp}|${cuerpo}`), key, sig);
    return valida ? { ok: true } : { ok: false, motivo: "la firma no coincide" };
  } catch {
    return { ok: false, motivo: "no se pudo verificar la firma" };
  }
}

// ─── client_state: el id de la llamada de Kairo ──────────────────────────────

const PREFIJO_ESTADO = "kairo:";

/**
 * Lo que el navegador manda como clientState y Telnyx devuelve en cada evento
 * (en base64). Lleva SOLO el id aleatorio de la llamada que creo Kairo: lead,
 * tienda y asesora salen de esa fila, no del navegador, asi que no se pueden
 * falsificar desde la pantalla.
 */
export function codificarEstadoCliente(llamadaId: string): string {
  return Buffer.from(`${PREFIJO_ESTADO}${llamadaId}`).toString("base64");
}

export function leerEstadoCliente(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const texto = Buffer.from(valor, "base64").toString("utf8");
  if (!texto.startsWith(PREFIJO_ESTADO)) return null;
  const id = texto.slice(PREFIJO_ESTADO.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** pbx_call_id de la fila de una llamada de Telnyx en zadarma_calls. */
export function claveLlamadaTelnyx(llamadaId: string): string {
  return `telnyx:${llamadaId}`;
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

export type TipoEventoTelnyx =
  | "call.initiated"
  | "call.answered"
  | "call.hangup"
  | "call.recording.saved"
  | "call.cost";

const TIPOS: ReadonlySet<string> = new Set<TipoEventoTelnyx>([
  "call.initiated",
  "call.answered",
  "call.hangup",
  "call.recording.saved",
  "call.cost",
]);

/** Lo que costo una llamada, del evento call.cost. */
export interface CostoTelnyx {
  total: number;
  /** Moneda de la cuenta de Telnyx (USD), de cost_parts. */
  moneda: string | null;
  segundosCobrados: number | null;
}

export interface EventoTelnyx {
  tipo: TipoEventoTelnyx;
  /** Cuando paso (occurred_at). */
  ocurrio: string;
  callControlId: string | null;
  clientState: string | null;
  hangupCause: string | null;
  /** recording_urls.mp3: prefirmado, vence en ~10 minutos. */
  recordingUrl: string | null;
  /**
   * recording_id de call.recording.saved: con el se pide un enlace nuevo
   * (urlGrabacionTelnyx) cuando el del webhook ya vencio.
   */
  recordingId: string | null;
  /** Solo en call.cost, y solo si Telnyx pudo calcularlo. */
  costo: CostoTelnyx | null;
}

/** Los eventos que usa Kairo; cualquier otro (o un cuerpo raro) da null. */
export function leerEventoTelnyx(cuerpo: unknown): EventoTelnyx | null {
  const data = (cuerpo as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data.event_type !== "string" || !TIPOS.has(data.event_type)) return null;
  const p = (data.payload ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
  const urls = (p.recording_urls ?? {}) as { mp3?: unknown };
  return {
    tipo: data.event_type as TipoEventoTelnyx,
    ocurrio: texto(data.occurred_at) ?? new Date().toISOString(),
    callControlId: texto(p.call_control_id),
    clientState: texto(p.client_state),
    hangupCause: texto(p.hangup_cause),
    recordingUrl: texto(urls.mp3),
    recordingId: texto(p.recording_id),
    costo: data.event_type === "call.cost" ? leerCosto(p) : null,
  };
}

/**
 * total_cost viene como texto ("0.0125"). Con status "error" o sin total no
 * hay costo: mejor vacio que un 0 que parezca una llamada gratis.
 */
function leerCosto(p: Record<string, unknown>): CostoTelnyx | null {
  if (p.status === "error") return null;
  const total = Number(p.total_cost);
  if (p.total_cost == null || p.total_cost === "" || !Number.isFinite(total) || total < 0) return null;
  const partes = Array.isArray(p.cost_parts) ? (p.cost_parts as Array<Record<string, unknown>>) : [];
  const moneda = partes.map((c) => c.currency).find((c): c is string => typeof c === "string" && c.length > 0) ?? null;
  const seg = Number(p.billed_duration_secs);
  return {
    total,
    moneda: moneda ? moneda.toUpperCase() : null,
    segundosCobrados: p.billed_duration_secs != null && Number.isFinite(seg) ? Math.round(seg) : null,
  };
}

/**
 * Como termino la llamada, en las palabras que ya usa el CDR de Zadarma
 * (describeZadarmaCall las traduce para el timeline): asi el historial del
 * lead, la "ultima llamada" y la productividad leen las dos telefonias igual.
 */
export function estadoDeColgado(causa: string | null | undefined, contestada: boolean): string {
  if (contestada) return "answered";
  switch (causa) {
    case "user_busy":
    case "call_rejected":
      return "busy";
    case "no_answer":
    case "timeout":
      return "no answer";
    case "originator_cancel":
      return "cancel";
    case "not_found":
      return "unallocated number";
    default:
      return "failed";
  }
}

// ─── Llamadas que nunca salieron ─────────────────────────────────────────────

/**
 * Estado de una llamada que Kairo preparo pero el navegador nunca marco (se
 * cerro la pagina, se nego el microfono, un doble clic). No se muestra en
 * ningun historial: no hubo llamada.
 */
export const ESTADO_NO_MARCADA = "not_dialed";

/** Pasado esto sin ningun aviso de Telnyx, una llamada "calling" no salio. */
export const MINUTOS_SIN_MARCAR = 5;

/** Si una fila del CDR es una llamada de verdad (para los historiales). */
export function esLlamadaReal(
  fila: { status?: string | null; started_at?: string | null },
  ahora: number = Date.now()
): boolean {
  if (fila.status === ESTADO_NO_MARCADA) return false;
  if (fila.status === "calling" && fila.started_at) {
    return ahora - Date.parse(fila.started_at) < MINUTOS_SIN_MARCAR * 60_000;
  }
  return true;
}

/** Segundos de conversacion: desde que contesto el cliente hasta que se colgo. */
export function segundosDeConversacion(contestoEn: string | null | undefined, colgoEn: string | null | undefined): number {
  if (!contestoEn || !colgoEn) return 0;
  const ms = Date.parse(colgoEn) - Date.parse(contestoEn);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
}
