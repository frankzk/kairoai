// Cliente de la API de Zadarma (centralita virtual) para que las asesoras
// llamen desde el navegador, sin telefono fisico ni softphone instalado.
//
// Como funciona la llamada "desde la laptop":
//   1. La asesora abre /admin/leads. Kairo pide a Zadarma una llave temporal
//      (/v1/webrtc/get_key/, vive 72h) para SU extension y monta el widget
//      WebRTC de Zadarma: el navegador queda registrado como su telefono.
//   2. Al pulsar "Llamar" en un lead, Kairo llama a /v1/request/callback/ con
//      from = su extension y to = el cliente. Zadarma timbra la extension (=>
//      suena el navegador, la asesora contesta con su diadema) y enseguida
//      marca al cliente. El audio va por la laptop.
//   3. Zadarma notifica el ciclo de vida (NOTIFY_OUT_START / NOTIFY_OUT_END /
//      NOTIFY_RECORD) al webhook, que es quien deja el CDR en zadarma_calls.
//
// Este modulo es puro (fetch + crypto): no toca Supabase, para poder testear
// la firma y el parseo sin base de datos.

import crypto from "crypto";

const API_BASE = "https://api.zadarma.com";

// Rango de IPs desde el que Zadarma envia las notificaciones (185.45.152.40/30
// segun su documentacion): .40, .41, .42 y .43.
const ZADARMA_NOTIFY_IPS = new Set([
  "185.45.152.40",
  "185.45.152.41",
  "185.45.152.42",
  "185.45.152.43",
]);

export interface ZadarmaCredentials {
  key: string;
  secret: string;
}

export function getZadarmaCredentials(): ZadarmaCredentials | null {
  const key = (process.env.ZADARMA_API_KEY ?? "").trim();
  const secret = (process.env.ZADARMA_API_SECRET ?? "").trim();
  if (!key || !secret) return null;
  return { key, secret };
}

export function isZadarmaConfigured(): boolean {
  return getZadarmaCredentials() != null;
}

/**
 * Serializa los parametros como espera Zadarma: claves ordenadas
 * alfabeticamente y codificacion `application/x-www-form-urlencoded`
 * (espacio -> '+'), identica a `http_build_query` de PHP para valores planos.
 */
export function buildParamsString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    search.append(key, String(value));
  }
  return search.toString();
}

/**
 * Firma de autorizacion de Zadarma:
 *   base64( hex( hmac_sha1( metodo + params + md5(params), secret ) ) )
 * El header queda como `Authorization: <key>:<firma>`.
 */
export function signRequest(
  method: string,
  params: Record<string, string | number | undefined>,
  secret: string
): { paramsString: string; signature: string } {
  const paramsString = buildParamsString(params);
  const md5 = crypto.createHash("md5").update(paramsString).digest("hex");
  const hmacHex = crypto
    .createHmac("sha1", secret)
    .update(`${method}${paramsString}${md5}`)
    .digest("hex");
  return { paramsString, signature: Buffer.from(hmacHex).toString("base64") };
}

export class ZadarmaError extends Error {
  readonly method: string;
  constructor(message: string, method: string) {
    super(message);
    this.name = "ZadarmaError";
    this.method = method;
  }
}

interface ZadarmaResponse {
  status?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Llamada firmada a la API. Zadarma responde 200 con `status: "error"` en los
 * fallos de negocio (saldo, extension inexistente), asi que tambien se revisa
 * el cuerpo y no solo el codigo HTTP.
 */
export async function zadarmaRequest<T extends ZadarmaResponse>(
  method: string,
  params: Record<string, string | number | undefined> = {},
  httpMethod: "GET" | "POST" = "GET",
  timeoutMs = 15_000
): Promise<T> {
  const credentials = getZadarmaCredentials();
  if (!credentials) {
    throw new ZadarmaError("Faltan ZADARMA_API_KEY / ZADARMA_API_SECRET", method);
  }

  const { paramsString, signature } = signRequest(method, params, credentials.secret);
  const headers: Record<string, string> = {
    Authorization: `${credentials.key}:${signature}`,
  };

  const url =
    httpMethod === "GET" && paramsString
      ? `${API_BASE}${method}?${paramsString}`
      : `${API_BASE}${method}`;

  if (httpMethod === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: httpMethod,
      headers,
      body: httpMethod === "POST" ? paramsString : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
    throw new ZadarmaError(`No se pudo contactar a Zadarma (${reason})`, method);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    throw new ZadarmaError(
      `Respuesta no-JSON de Zadarma (HTTP ${response.status}): ${text.slice(0, 200)}`,
      method
    );
  }

  if (!response.ok || body.status === "error") {
    throw new ZadarmaError(body.message || `Zadarma respondio HTTP ${response.status}`, method);
  }
  return body;
}

// ─── Extensiones de la centralita ────────────────────────────────────────────

export interface PbxExtension {
  /** Numero corto, p.ej. '100'. */
  number: string;
  /** Login completo que usan el widget y el callback, p.ej. '499499-100'. */
  sip: string;
}

/**
 * La API devuelve el id de la centralita y los numeros cortos por separado;
 * el login que usan el widget y el callback es la union de ambos
 * (`499499` + `100` -> `499499-100`).
 */
export function toPbxExtensions(
  pbxId: string | number | undefined,
  numbers: Array<string | number> | undefined
): PbxExtension[] {
  const prefix = String(pbxId ?? "").trim();
  return (numbers ?? []).map((value) => {
    const number = String(value).trim();
    return { number, sip: prefix ? `${prefix}-${number}` : number };
  });
}

/**
 * Extensiones existentes en la centralita. Es el paso que Zadarma llama
 * "vincular a los usuarios de la centralita con los de tu sistema": en vez de
 * escribir la extension a mano en la base, se elige de la lista real.
 */
export async function getPbxExtensions(): Promise<{ pbxId: string; extensions: PbxExtension[] }> {
  const body = await zadarmaRequest<{
    status?: string;
    pbx_id?: string | number;
    numbers?: Array<string | number>;
  }>("/v1/pbx/internal/");

  return {
    pbxId: String(body.pbx_id ?? ""),
    extensions: toPbxExtensions(body.pbx_id, body.numbers),
  };
}

// ─── Widget WebRTC (el telefono dentro del navegador) ────────────────────────

export interface WebrtcKey {
  /** Llave temporal del widget. */
  key: string;
  /** Momento (epoch ms) en que Kairo deja de servir esta llave desde cache. */
  cachedUntil: number;
}

export type WidgetShape = "square" | "rounded";
export type WidgetPosition = "top_left" | "top_right" | "bottom_right" | "bottom_left";

export interface WebrtcIntegration {
  isExists: boolean;
  /** Dominios autorizados a montar el widget (incluye subdominios). */
  domains: string[];
  shape: WidgetShape;
  position: WidgetPosition;
}

/**
 * Ajustes de la integración del widget tal como están en el área personal
 * (forma y esquina). Se leen en vez de fijarlos en el código para que cambiar
 * la apariencia sea un click en Zadarma, no un deploy.
 */
export async function getWebrtcIntegration(): Promise<WebrtcIntegration> {
  const body = await zadarmaRequest<{
    status?: string;
    is_exists?: boolean;
    domains?: string[];
    settings?: { shape?: string; position?: string };
  }>("/v1/webrtc/");

  const shape = body.settings?.shape === "rounded" ? "rounded" : "square";
  const position = (
    ["top_left", "top_right", "bottom_right", "bottom_left"] as const
  ).includes(body.settings?.position as WidgetPosition)
    ? (body.settings?.position as WidgetPosition)
    : "bottom_right";

  return {
    isExists: Boolean(body.is_exists),
    domains: body.domains ?? [],
    shape,
    position,
  };
}

// La llave vive 72h del lado de Zadarma; se cachea 12h para no pedir una nueva
// en cada carga de /admin/leads y para que un reinicio de Vercel no importe.
const WEBRTC_KEY_TTL_MS = 12 * 60 * 60 * 1000;
const webrtcKeyCache = new Map<string, WebrtcKey>();

/** Valida el login de extension: digitos y guiones, p.ej. '499499-100'. */
export function isValidSipLogin(sip: string): boolean {
  return /^[0-9]{2,10}(-[0-9]{2,6})?$/.test(sip.trim());
}

/**
 * Extension corta a partir del login completo: '499499-100' -> '100'.
 *
 * Zadarma NO usa el mismo formato en todos los metodos y no perdona la
 * diferencia: el widget WebRTC y `/v1/webrtc/get_key/` quieren el login
 * completo, pero el parametro `sip` de `/v1/request/callback/` solo acepta la
 * extension corta y responde "Field sip could be only SIP or PBX number".
 * Guardamos el login completo (es lo que muestra el area personal) y
 * convertimos aqui, en el unico lugar que lo necesita.
 */
export function toShortExtension(sip: string): string {
  const value = sip.trim();
  const dash = value.lastIndexOf("-");
  return dash >= 0 ? value.slice(dash + 1) : value;
}

/**
 * Devuelve la llave del widget WebRTC para una extension. Cachea en memoria
 * del proceso; `force` la renueva (util si Zadarma la invalida).
 */
export async function getWebrtcKey(sip: string, force = false): Promise<WebrtcKey> {
  const login = sip.trim();
  if (!isValidSipLogin(login)) {
    throw new ZadarmaError(`Extension invalida: ${sip}`, "/v1/webrtc/get_key/");
  }

  const cached = webrtcKeyCache.get(login);
  if (!force && cached && cached.cachedUntil > Date.now()) return cached;

  const body = await zadarmaRequest<{ status?: string; key?: string }>("/v1/webrtc/get_key/", {
    sip: login,
  });
  const key = String(body.key ?? "");
  if (!key) {
    throw new ZadarmaError("Zadarma no devolvio llave del widget", "/v1/webrtc/get_key/");
  }

  const value: WebrtcKey = { key, cachedUntil: Date.now() + WEBRTC_KEY_TTL_MS };
  webrtcKeyCache.set(login, value);
  return value;
}

/** Solo para tests: limpia el cache de llaves. */
export function clearWebrtcKeyCache(): void {
  webrtcKeyCache.clear();
}

// ─── Click-to-call ───────────────────────────────────────────────────────────

export interface CallbackResult {
  status: string;
  /** Zadarma no siempre devuelve id; el CDR real llega por webhook. */
  message?: string;
}

/**
 * Pide a Zadarma que conecte la extension de la asesora con el cliente.
 * Timbra primero `from` (su extension = su navegador) y luego marca a `to`.
 */
export async function requestCallback(input: {
  /** Extension de la asesora, p.ej. '499499-100'. */
  from: string;
  /** Telefono del cliente en E.164 sin '+', p.ej. '50688887777'. */
  to: string;
  /** Extension que origina la llamada (para tarifas/CallerID). */
  sip?: string;
}): Promise<CallbackResult> {
  const from = input.from.trim();
  const to = input.to.replace(/\D+/g, "");
  if (!isValidSipLogin(from)) {
    throw new ZadarmaError(`Extension invalida: ${input.from}`, "/v1/request/callback/");
  }
  if (to.length < 8) {
    throw new ZadarmaError(`Telefono invalido: ${input.to}`, "/v1/request/callback/");
  }

  // `sip` va en corto (100), no como login completo (499499-100). De el
  // dependen el CallerID, la grabacion y a que extension se le atribuye la
  // llamada en la estadistica, asi que se manda igual: no se omite.
  const sip = toShortExtension(input.sip?.trim() || from);

  const body = await zadarmaRequest<{ status?: string; message?: string }>(
    "/v1/request/callback/",
    { from, to, sip },
    "GET"
  );
  return { status: String(body.status ?? "success"), message: body.message };
}

// ─── Grabaciones ─────────────────────────────────────────────────────────────

/** Vida del enlace de grabacion: 60 dias, el maximo que acepta Zadarma. */
const RECORD_LINK_LIFETIME_SECONDS = 5_184_000;

/**
 * Enlace de descarga de la grabacion. Se pide tras NOTIFY_RECORD, que es
 * cuando el archivo ya existe. Devuelve null si la cuenta no tiene grabacion
 * activa para esa llamada.
 */
export async function getRecordLink(callIdWithRec: string): Promise<string | null> {
  const callId = callIdWithRec.trim();
  if (!callId) return null;
  const body = await zadarmaRequest<{ status?: string; link?: string; links?: string[] }>(
    "/v1/pbx/record/request/",
    { call_id: callId, lifetime: RECORD_LINK_LIFETIME_SECONDS }
  );
  return body.link ?? body.links?.[0] ?? null;
}

// ─── Cuenta ──────────────────────────────────────────────────────────────────

/**
 * Saldo de la cuenta. Las llamadas por callback se cobran: sin saldo la
 * centralita responde `disposition: "no money"` y la asesora solo ve que
 * "no entra la llamada".
 */
export async function getBalance(): Promise<{ balance: number; currency: string }> {
  const body = await zadarmaRequest<{ balance?: number; currency?: string }>("/v1/info/balance/");
  return { balance: Number(body.balance ?? 0), currency: String(body.currency ?? "") };
}

/**
 * Convierte el huso que reporta Zadarma ("UTC+0", "UTC-6", "UTC+5:30") al
 * formato que espera ZADARMA_TIMEZONE_OFFSET ("+00:00", "-06:00", "+05:30").
 */
export function parseUtcOffset(timezone: string | undefined | null): string | null {
  const match = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(String(timezone ?? "").trim());
  if (!match) return null;
  return `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
}

/**
 * Zona horaria de la centralita. Es la que usa `call_start` en los webhooks,
 * y de ella sale el valor correcto de ZADARMA_TIMEZONE_OFFSET.
 */
export async function getPbxTimezone(): Promise<{ timezone: string; offset: string | null }> {
  const body = await zadarmaRequest<{ timezone?: string; datetime?: string; unixtime?: number }>(
    "/v1/info/timezone/"
  );
  const timezone = String(body.timezone ?? "");
  return { timezone, offset: parseUtcOffset(timezone) };
}

// ─── Configuración de notificaciones (PBX call info) ─────────────────────────

export interface CallInfoSettings {
  url: string;
  notifications: Record<string, boolean>;
}

/** Eventos que Kairo necesita para armar el CDR. */
export const REQUIRED_NOTIFICATIONS = [
  "notify_start",
  "notify_internal",
  "notify_answer",
  "notify_end",
  "notify_out_start",
  "notify_out_end",
] as const;

function parseNotifications(raw: Record<string, unknown> | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    out[key] = value === true || value === "true" || value === 1 || value === "1";
  }
  return out;
}

export async function getCallInfoSettings(): Promise<CallInfoSettings> {
  const body = await zadarmaRequest<{
    url?: string;
    notifications?: Record<string, unknown>;
  }>("/v1/pbx/callinfo/");
  return { url: String(body.url ?? ""), notifications: parseNotifications(body.notifications) };
}

/**
 * Apunta las notificaciones de la centralita al webhook de Kairo y enciende
 * los eventos del ciclo de vida. Zadarma valida la URL con `zd_echo` antes de
 * aceptarla, así que esto solo funciona con el deploy ya publicado.
 */
export async function configureCallInfo(url: string): Promise<CallInfoSettings> {
  await zadarmaRequest("/v1/pbx/callinfo/url/", { url }, "POST");

  const params: Record<string, string> = {};
  for (const event of REQUIRED_NOTIFICATIONS) params[event] = "true";
  const body = await zadarmaRequest<{ notifications?: Record<string, unknown> }>(
    "/v1/pbx/callinfo/notifications/",
    params,
    "POST"
  );

  return { url, notifications: parseNotifications(body.notifications) };
}

// ─── Webhooks (notificaciones de la centralita) ──────────────────────────────

export type ZadarmaEvent =
  | "NOTIFY_START"
  | "NOTIFY_INTERNAL"
  | "NOTIFY_ANSWER"
  | "NOTIFY_END"
  | "NOTIFY_OUT_START"
  | "NOTIFY_OUT_END"
  | "NOTIFY_RECORD"
  | "NOTIFY_IVR"
  | "SMS"
  | "NUMBER_LOOKUP"
  | "CALL_TRACKING"
  | "SPEECH_RECOGNITION";

export function isZadarmaNotifyIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  // `x-forwarded-for` puede traer una cadena; la IP de origen es la primera.
  const first = ip.split(",")[0].trim();
  const withoutPort = first.replace(/^\[|\]$/g, "").split("%")[0];
  return ZADARMA_NOTIFY_IPS.has(withoutPort);
}

/**
 * Cadena que Zadarma firma en cada evento. Cambia por tipo de evento, por eso
 * se resuelve aqui en un solo lugar. Devuelve null si el evento no viene
 * firmado o no lo manejamos.
 */
export function signatureStringForEvent(
  event: string,
  body: Record<string, string | undefined>
): string | null {
  switch (event) {
    case "NOTIFY_START":
    case "NOTIFY_INTERNAL":
    case "NOTIFY_END":
    case "NOTIFY_IVR":
      return `${body.caller_id ?? ""}${body.called_did ?? ""}${body.call_start ?? ""}`;
    case "NOTIFY_ANSWER":
      return `${body.caller_id ?? ""}${body.destination ?? ""}${body.call_start ?? ""}`;
    case "NOTIFY_OUT_START":
    case "NOTIFY_OUT_END":
      return `${body.internal ?? ""}${body.destination ?? ""}${body.call_start ?? ""}`;
    case "NOTIFY_RECORD":
      return `${body.pbx_call_id ?? ""}${body.call_id_with_rec ?? ""}`;
    case "SMS":
    case "NUMBER_LOOKUP":
    case "CALL_TRACKING":
      return String(body.result ?? "");
    default:
      return null;
  }
}

/**
 * Verifica el header `Signature` de una notificacion:
 *   base64( hex( hmac_sha1( cadena_del_evento, secret ) ) )
 * Comparacion en tiempo constante.
 */
export function verifyNotifySignature(
  signatureString: string,
  headerSignature: string | null | undefined,
  secret?: string
): boolean {
  const apiSecret = secret ?? getZadarmaCredentials()?.secret ?? "";
  if (!apiSecret || !headerSignature) return false;

  const hmacHex = crypto.createHmac("sha1", apiSecret).update(signatureString).digest("hex");
  const expected = Buffer.from(Buffer.from(hmacHex).toString("base64"));
  const received = Buffer.from(headerSignature);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

/**
 * Convierte `call_start` de Zadarma ("YYYY-MM-DD HH:mm:ss", hora de la
 * centralita) a ISO. La centralita entrega la hora en la zona configurada en
 * la cuenta; `ZADARMA_TIMEZONE_OFFSET` (p.ej. "-06:00") la ancla. Sin ese
 * valor se asume UTC.
 */
export function parseZadarmaTime(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value.trim());
  if (!match) {
    const direct = Date.parse(value);
    return Number.isNaN(direct) ? null : new Date(direct).toISOString();
  }
  const offset = (process.env.ZADARMA_TIMEZONE_OFFSET ?? "Z").trim() || "Z";
  const suffix = /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "Z";
  const parsed = Date.parse(`${match[1]}T${match[2]}${suffix}`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Estados de Zadarma que cuentan como conversacion real. */
export function isAnsweredDisposition(disposition: string | undefined | null): boolean {
  return String(disposition ?? "").toLowerCase() === "answered";
}

// ─── Presentacion de una llamada ─────────────────────────────────────────────

// Estados que reporta la centralita. Los de saldo/limite importan tanto como
// los de la conversacion: sin ellos la asesora solo ve "no entro la llamada"
// y nadie se entera de que el problema es la cuenta, no el cliente.
const DISPOSITION_LABEL: Record<string, string> = {
  answered: "contestada",
  busy: "ocupado",
  cancel: "cancelada",
  "no answer": "sin respuesta",
  failed: "no se pudo",
  "call failed": "no se pudo",
  "no money": "SIN SALDO en Zadarma",
  "no money, no limit": "SIN SALDO / límite superado",
  "no limit": "límite de la cuenta superado",
  "no day limit": "límite diario superado",
  "line limit": "sin líneas libres",
  "unallocated number": "el número no existe",
  calling: "marcando",
  ringing: "timbrando",
};

/** "Saliente · contestada · 1m 20s" para el timeline del lead. */
export function describeZadarmaCall(row: {
  direction?: string | null;
  status?: string | null;
  duration_seconds?: number | null;
}): string {
  const direction = row.direction === "incoming" ? "Entrante" : "Saliente";
  const raw = String(row.status ?? "");
  const status = DISPOSITION_LABEL[raw.toLowerCase()] ?? raw;
  const seconds = row.duration_seconds ?? 0;
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return [direction, status, seconds > 0 ? duration : null].filter(Boolean).join(" · ");
}
