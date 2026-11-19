// Llave WebRTC de cada extensión, compartida entre instancias (tabla
// zadarma_webrtc_keys). El 18/11/2026 cada página abierta y cada reintento
// del teléfono le pedía la llave a la API de Zadarma, y Zadarma frenó a Kairo
// con "You exceeded the rate limit by IP". Ahora:
//   - la llave se guarda 48 h (Zadarma la da por ~72 h);
//   - si Zadarma rechaza, nadie vuelve a preguntar hasta `bloqueado_hasta`;
//   - "force" (Zadarma rechazó la clave SIP) renueva como mucho cada 5 min.

import { getDB } from "@/lib/db";
import { getWebrtcKey, ZadarmaError } from "@/lib/zadarma";

const DURA_MS = 48 * 3_600_000;
const FORZAR_CADA_MS = 5 * 60_000;

/** Cuánto esperar antes de volver a preguntarle a Zadarma tras un rechazo. */
export function esperaTrasError(mensaje: string): number {
  if (/rate limit|too many/i.test(mensaje)) return 3 * 60_000;
  if (/not authori[sz]ed/i.test(mensaje)) return 5 * 60_000;
  return 30_000;
}

/** Texto para la asesora, con cuánto falta para reintentar. */
export function mensajeBloqueo(error: string, hasta: Date, ahora = new Date()): string {
  const min = Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / 60_000));
  const motivo = /rate limit/i.test(error)
    ? "Zadarma frenó las consultas de Kairo por un rato"
    : /not authori[sz]ed/i.test(error)
      ? "Zadarma no autorizó esta extensión para el teléfono del navegador"
      : `Zadarma respondió: ${error}`;
  return `${motivo}. Se vuelve a intentar solo en ${min} min.`;
}

interface Fila {
  key: string | null;
  expires_at: string | null;
  bloqueado_hasta: string | null;
  ultimo_error: string | null;
  updated_at: string;
}

export async function llaveWebrtc(sip: string, forzar = false, ahora = new Date()): Promise<string> {
  const { data } = await getDB()
    .from("zadarma_webrtc_keys")
    .select("key,expires_at,bloqueado_hasta,ultimo_error,updated_at")
    .eq("sip", sip)
    .maybeSingle();
  const fila = data as Fila | null;
  const t = ahora.getTime();
  const vigente = fila?.key && fila.expires_at && Date.parse(fila.expires_at) > t;
  const reciente = fila && t - Date.parse(fila.updated_at) < FORZAR_CADA_MS;
  if (vigente && (!forzar || reciente)) return fila!.key!;
  if (fila?.bloqueado_hasta && Date.parse(fila.bloqueado_hasta) > t) {
    throw new ZadarmaError(mensajeBloqueo(fila.ultimo_error ?? "", new Date(fila.bloqueado_hasta), ahora), "/v1/webrtc/get_key/");
  }
  try {
    const { key } = await getWebrtcKey(sip, true);
    await getDB()
      .from("zadarma_webrtc_keys")
      .upsert(
        { sip, key, expires_at: new Date(t + DURA_MS).toISOString(), bloqueado_hasta: null, ultimo_error: null, updated_at: ahora.toISOString() },
        { onConflict: "sip" },
      );
    return key;
  } catch (err) {
    const mensaje = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const hasta = new Date(t + esperaTrasError(mensaje));
    console.warn(`[zadarma/webphone] get_key ${sip}: ${mensaje}`);
    await getDB()
      .from("zadarma_webrtc_keys")
      .upsert({ sip, bloqueado_hasta: hasta.toISOString(), ultimo_error: mensaje, updated_at: ahora.toISOString() }, { onConflict: "sip" });
    // Si había una llave todavía vigente, se sigue usando.
    if (vigente) return fila!.key!;
    throw new ZadarmaError(mensajeBloqueo(mensaje, hasta, ahora), "/v1/webrtc/get_key/");
  }
}
