// Grabaciones de las llamadas, guardadas en NUESTRO almacenamiento.
//
// POR QUE: los enlaces que dan los proveedores vencen. Los de Telnyx
// (recording_urls del webhook) son prefirmados y viven ~10 minutos; los de
// Zadarma se pedian con 60 dias de vida y muchos ya no sirven. Para que una
// grabacion se pueda escuchar siempre desde el lead, el pedido o la novedad,
// el mp3 se copia al bucket PRIVADO `call-recordings` de Supabase y se sirve
// con una URL firmada de corta vida (/api/calls/[id]/recording).
//
// Quien copia:
//   1. El webhook de Telnyx, apenas llega call.recording.saved, en segundo
//      plano (lib/segundo-plano.ts): la respuesta a Telnyx no espera la copia.
//   2. El cron `call-recordings` (cada 15 min), para lo que el webhook no pudo:
//      pide a Telnyx un enlace nuevo con el recording_id, y de paso intenta
//      las grabaciones viejas de Zadarma cuyo enlace todavia sirva.
//
// NUNCA se escriben en logs ni en recording_error los enlaces: llevan la
// firma que da acceso al audio.

import { getDB } from "@/lib/db";
import { TelnyxError, urlGrabacionTelnyx, type TelnyxConfig } from "@/lib/telnyx";

/** Bucket privado (migracion 20261107130000_call_recordings.sql). */
export const BUCKET_GRABACIONES = "call-recordings";

/** Vida de la URL firmada con que se escucha una grabacion. */
export const TTL_URL_GRABACION_S = 600;

/** Tope del bucket (file_size_limit): una llamada larga en mp3 pesa unos pocos MB. */
export const MAX_BYTES_GRABACION = 50 * 1024 * 1024;

/**
 * Intentos de copia antes de darla por perdida. Un error definitivo (el enlace
 * vencio, la grabacion ya no existe) la marca de una vez con este numero, para
 * que el cron no la reintente para siempre.
 */
export const MAX_INTENTOS_GRABACION = 6;

const TIMEOUT_DESCARGA_MS = 20_000;
const MAX_ERROR = 300;

// ─── Estado que ve la pantalla ───────────────────────────────────────────────

/**
 * - lista: copiada a nuestro bucket, se puede escuchar.
 * - procesando: el proveedor la grabo y todavia no se copio.
 * - no_disponible: no se pudo copiar (el enlace vencio): no se va a poder.
 */
export type EstadoGrabacion = "lista" | "procesando" | "no_disponible";

export interface CamposGrabacion {
  is_recorded?: boolean | null;
  recording_path?: string | null;
  recording_attempts?: number | null;
}

export function estadoGrabacion(f: CamposGrabacion): EstadoGrabacion | null {
  if (f.recording_path) return "lista";
  if (!f.is_recorded) return null;
  return (f.recording_attempts ?? 0) >= MAX_INTENTOS_GRABACION ? "no_disponible" : "procesando";
}

/** Columnas que leen los historiales para saber si hay grabacion. */
export const COLUMNAS_GRABACION = "is_recorded,recording_path,recording_attempts";

/**
 * true si el error de PostgREST es porque falta una columna: la migracion de
 * grabaciones todavia no se aplico. Los historiales siguen funcionando sin
 * ella (sin el boton de escuchar), en vez de quedarse sin llamadas.
 */
export function esColumnaFaltante(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

// ─── Ruta en el bucket ───────────────────────────────────────────────────────

export interface FilaGrabacion {
  id: number;
  provider: string | null;
  store_id: number | null;
  started_at: string | null;
  created_at?: string | null;
  recording_id?: string | null;
  record_url?: string | null;
  recording_attempts?: number | null;
}

/**
 * `<tienda>/<yyyy>/<mm>/<id de la fila>.mp3`, con el mes en que se hizo la
 * llamada (UTC). La ruta es fija por llamada: copiar dos veces la misma
 * (webhook y cron a la vez) reemplaza el archivo, no lo duplica.
 */
export function rutaGrabacion(fila: Pick<FilaGrabacion, "id" | "store_id" | "started_at" | "created_at">): string {
  const cuando = Date.parse(fila.started_at ?? fila.created_at ?? "");
  const fecha = Number.isFinite(cuando) ? new Date(cuando) : new Date();
  const yyyy = String(fecha.getUTCFullYear());
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  return `${fila.store_id ?? "sin-tienda"}/${yyyy}/${mm}/${fila.id}.mp3`;
}

// ─── Errores sin secretos ────────────────────────────────────────────────────

/** Texto corto para recording_error / logs: sin enlaces (llevan la firma). */
export function errorSinSecretos(err: unknown): string {
  const texto = err instanceof Error ? err.message : String(err ?? "error");
  return texto
    .replace(/https?:\/\/\S+/gi, "[enlace]")
    .replace(/[?&](X-Amz-[A-Za-z-]+|Signature|Expires|token|key)=\S+/gi, "")
    .slice(0, MAX_ERROR);
}

/** Error de copia; `definitivo` = no vale la pena reintentar. */
export class ErrorGrabacion extends Error {
  constructor(
    message: string,
    readonly definitivo: boolean,
  ) {
    super(message);
    this.name = "ErrorGrabacion";
  }
}

/** 4xx (menos 408/429) = el enlace o la grabacion ya no existen. */
function esDefinitivo(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// ─── Bajar y subir ───────────────────────────────────────────────────────────

/**
 * Baja el audio de un enlace del proveedor. Sin Authorization: los enlaces de
 * Telnyx son prefirmados (S3) y los de Zadarma llevan su propia firma.
 */
export async function descargarAudio(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_DESCARGA_MS,
): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetchImpl(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const nombre = err instanceof Error ? err.name : "";
    throw new ErrorGrabacion(
      nombre === "TimeoutError" || nombre === "AbortError" ? "la descarga tardó demasiado" : "no se pudo conectar para bajar el audio",
      false,
    );
  }
  if (!res.ok) throw new ErrorGrabacion(`descarga: HTTP ${res.status}`, esDefinitivo(res.status));
  const tipo = (res.headers.get("content-type") ?? "").toLowerCase();
  // Un enlace vencido a veces responde 200 con una pagina o un JSON de error.
  if (/json|html|xml|text\//.test(tipo)) throw new ErrorGrabacion(`descarga: no es audio (${tipo.split(";")[0]})`, true);
  const largo = Number(res.headers.get("content-length"));
  if (Number.isFinite(largo) && largo > MAX_BYTES_GRABACION) throw new ErrorGrabacion("descarga: el audio pasa de 50 MB", true);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new ErrorGrabacion("descarga: archivo vacío", false);
  if (bytes.byteLength > MAX_BYTES_GRABACION) throw new ErrorGrabacion("descarga: el audio pasa de 50 MB", true);
  return bytes;
}

/** Enlace con que bajar la grabacion de una fila, o error si no hay como. */
async function enlaceDeFila(
  fila: FilaGrabacion,
  opts: { url?: string | null; cfg: TelnyxConfig | null; fetchImpl?: typeof fetch },
): Promise<string> {
  if (opts.url) return opts.url;
  if (fila.provider === "telnyx" && fila.recording_id) {
    if (!opts.cfg) throw new ErrorGrabacion("falta TELNYX_API_KEY para pedir el enlace", false);
    try {
      return await urlGrabacionTelnyx(opts.cfg, fila.recording_id, opts.fetchImpl);
    } catch (err) {
      if (err instanceof TelnyxError) throw new ErrorGrabacion(err.message, err.status === 404);
      throw new ErrorGrabacion("no se pudo pedir el enlace a Telnyx", false);
    }
  }
  if (fila.record_url) return fila.record_url;
  throw new ErrorGrabacion("sin enlace para bajar la grabación", true);
}

export type ResultadoCopia = { ok: true; path: string } | { ok: false; error: string; definitivo: boolean };

/**
 * Copia la grabacion de una llamada a nuestro bucket y lo anota en la fila.
 * No lanza: cualquier falla queda en recording_error (sin enlaces) y en
 * recording_attempts, para que el cron la reintente o la deje.
 *
 * @param opts.url Enlace recien llegado en el webhook (vigente ~10 min). Sin
 *   el, se pide uno nuevo a Telnyx con el recording_id, o se usa record_url.
 */
export async function copiarGrabacion(
  fila: FilaGrabacion,
  opts: { url?: string | null; cfg: TelnyxConfig | null; fetchImpl?: typeof fetch; timeoutMs?: number } = { cfg: null },
): Promise<ResultadoCopia> {
  const db = getDB();
  const path = rutaGrabacion(fila);
  try {
    const url = await enlaceDeFila(fila, opts);
    const bytes = await descargarAudio(url, opts.fetchImpl, opts.timeoutMs);
    const { error: errSubir } = await db.storage
      .from(BUCKET_GRABACIONES)
      .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
    if (errSubir) throw new ErrorGrabacion(`almacenamiento: ${errSubir.message}`, false);
    const { error: errFila } = await db
      .from("zadarma_calls")
      .update({ recording_path: path, recording_saved_at: new Date().toISOString(), recording_error: null })
      .eq("id", fila.id);
    if (errFila) throw new ErrorGrabacion(`no se pudo anotar la copia: ${errFila.message}`, false);
    return { ok: true, path };
  } catch (err) {
    const definitivo = err instanceof ErrorGrabacion ? err.definitivo : false;
    const error = errorSinSecretos(err);
    const intentos = definitivo ? MAX_INTENTOS_GRABACION : Math.min((fila.recording_attempts ?? 0) + 1, MAX_INTENTOS_GRABACION);
    try {
      const { error: errFila } = await db
        .from("zadarma_calls")
        .update({ recording_error: error, recording_attempts: intentos })
        .eq("id", fila.id);
      if (errFila) console.warn(`[grabaciones] llamada ${fila.id}: no se pudo anotar el error: ${errFila.message}`);
    } catch (e) {
      console.warn(`[grabaciones] llamada ${fila.id}: no se pudo anotar el error: ${errorSinSecretos(e)}`);
    }
    console.warn(`[grabaciones] llamada ${fila.id}: ${error}`);
    return { ok: false, error, definitivo };
  }
}

// ─── Lo pendiente (cron) ─────────────────────────────────────────────────────

const COLUMNAS_PENDIENTE = "id,provider,store_id,started_at,created_at,recording_id,record_url,recording_attempts";

export interface ResumenGrabaciones {
  ok: boolean;
  telnyx: { copiadas: number; fallidas: number };
  /** Sin TELNYX_API_KEY no se piden enlaces nuevos: las de Telnyx esperan. */
  telnyx_sin_llave?: boolean;
  zadarma: { copiadas: number; fallidas: number };
  /** Se corto por tiempo: queda para la proxima corrida. */
  sin_tiempo: boolean;
  pendiente_migracion?: string;
  error?: string;
}

/**
 * Copia lo que falta, de a una y en orden: primero Telnyx (las recientes), y
 * con lo que quede de cupo y de tiempo, las viejas de Zadarma (las mas nuevas
 * primero: son las que todavia pueden tener el enlace vigente).
 */
export async function copiarGrabacionesPendientes(opts: {
  cfg: TelnyxConfig | null;
  fetchImpl?: typeof fetch;
  limite: number;
  /** Instante (ms) desde el que no se empieza otra copia. */
  hastaMs: number;
  /** Tope de cada descarga. */
  timeoutMs?: number;
  ahora?: () => number;
}): Promise<ResumenGrabaciones> {
  const ahora = opts.ahora ?? Date.now;
  const resumen: ResumenGrabaciones = {
    ok: true,
    telnyx: { copiadas: 0, fallidas: 0 },
    zadarma: { copiadas: 0, fallidas: 0 },
    sin_tiempo: false,
  };
  const db = getDB();
  const pendientes = (provider: "telnyx" | "zadarma", limite: number) => {
    let q = db
      .from("zadarma_calls")
      .select(COLUMNAS_PENDIENTE)
      .eq("provider", provider)
      .eq("is_recorded", true)
      .is("recording_path", null)
      .lt("recording_attempts", MAX_INTENTOS_GRABACION);
    // Telnyx: con recording_id se pide enlace nuevo; sin el, solo el del webhook.
    q = provider === "telnyx" ? q.or("recording_id.not.is.null,record_url.not.is.null") : q.not("record_url", "is", null);
    return q
      .order("recording_attempts", { ascending: true })
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(limite);
  };

  let cupo = opts.limite;
  for (const provider of ["telnyx", "zadarma"] as const) {
    if (cupo <= 0) break;
    // Sin llave no se puede pedir un enlace nuevo a Telnyx: se dejan intactas
    // (sin gastarles intentos) hasta que la llave este.
    if (provider === "telnyx" && !opts.cfg) {
      resumen.telnyx_sin_llave = true;
      continue;
    }
    const { data, error } = await pendientes(provider, cupo);
    if (error) {
      if (esColumnaFaltante(error)) {
        return { ...resumen, pendiente_migracion: "aplicar la migración 20261107130000_call_recordings.sql" };
      }
      return { ...resumen, ok: false, error: `grabaciones pendientes: ${error.message}` };
    }
    for (const fila of (data ?? []) as FilaGrabacion[]) {
      if (ahora() >= opts.hastaMs) {
        resumen.sin_tiempo = true;
        return resumen;
      }
      cupo--;
      const r = await copiarGrabacion(fila, { cfg: opts.cfg, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
      if (r.ok) resumen[provider].copiadas++;
      else resumen[provider].fallidas++;
    }
  }
  return resumen;
}

// ─── Escuchar ────────────────────────────────────────────────────────────────

/** URL firmada (corta) del mp3 guardado. */
export async function urlFirmadaGrabacion(path: string, ttlS: number = TTL_URL_GRABACION_S): Promise<string> {
  const { data, error } = await getDB().storage.from(BUCKET_GRABACIONES).createSignedUrl(path, ttlS);
  if (error) throw new Error(`urlFirmadaGrabacion: ${error.message}`);
  if (!data?.signedUrl) throw new Error("urlFirmadaGrabacion: sin URL");
  return data.signedUrl;
}
