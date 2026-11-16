// Rellamadas al buzon: Telnyx cobra cada llamada CONTESTADA por minuto
// completo, y en Costa Rica el buzon de voz (o el aviso de la operadora)
// "contesta". Medido del 8 al 16/11/2026: 1.219 llamadas contestadas que
// duraron menos de 10 s costaron US$138 (35 % del gasto), y cerca de 1.000 de
// ellas eran a numeros que ya se habian llamado ese mismo dia.
//
// Regla: si hoy (hora de la tienda) una llamada a ese numero fue contestada y
// duro menos de BUZON_SEGUNDOS, la siguiente se frena y se sugiere WhatsApp.
// La asesora puede llamar igual (forzar) si es urgente.

import { getDB } from "@/lib/db";

export const BUZON_SEGUNDOS = 10;

export interface LlamadaPrevia {
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
}

export interface BuzonHoy {
  /** Cuando fue la llamada corta (ISO). */
  at: string;
  segundos: number;
}

const diaEn = (timeZone: string) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (d: Date) => f.format(d);
};

/** La ultima llamada de hoy (en la zona de la tienda) que contesto y duro menos de BUZON_SEGUNDOS. */
export function buzonDeHoy(llamadas: LlamadaPrevia[], timeZone: string, ahora = new Date()): BuzonHoy | null {
  const dia = diaEn(timeZone);
  const hoy = dia(ahora);
  let ultima: BuzonHoy | null = null;
  for (const l of llamadas) {
    if (!l.started_at || !l.answered_at || !l.ended_at || l.duration_seconds == null) continue;
    if (l.duration_seconds >= BUZON_SEGUNDOS) continue;
    if (dia(new Date(l.started_at)) !== hoy) continue;
    if (!ultima || l.started_at > ultima.at) ultima = { at: l.started_at, segundos: l.duration_seconds };
  }
  return ultima;
}

export function mensajeBuzon(b: BuzonHoy, timeZone: string): string {
  const hora = new Date(b.at).toLocaleTimeString("es-CR", { timeZone, hour: "numeric", minute: "2-digit" });
  return `Hoy a las ${hora} contestó el buzón de este número (${b.segundos} s). Cada intento se cobra como un minuto aunque vuelva a caer al buzón: mejor mándale un WhatsApp y llama mañana.`;
}

/** Busca en la base las llamadas de las ultimas 30 h a ese numero. */
export async function buzonHoyDeNumero(storeId: number, phone: string, timeZone: string, ahora = new Date()): Promise<BuzonHoy | null> {
  const { data, error } = await getDB()
    .from("zadarma_calls")
    .select("started_at,answered_at,ended_at,duration_seconds")
    .eq("store_id", storeId)
    .eq("phone", phone)
    .gte("started_at", new Date(ahora.getTime() - 30 * 3_600_000).toISOString())
    .limit(50);
  // Si la consulta falla, la llamada sale: el freno es un ahorro, no un permiso.
  if (error) {
    console.warn(`[telnyx] no se pudo revisar el buzon de hoy: ${error.message}`);
    return null;
  }
  return buzonDeHoy((data ?? []) as LlamadaPrevia[], timeZone, ahora);
}
