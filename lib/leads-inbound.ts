// Resumen del transcript de un lead: cuantos mensajes escribio el cliente y
// cual fue el primero. Es lo que alimenta el segmento "Converso" del tablero.
//
// Modulo puro: no toca la base ni la red, para poder probarlo solo y para que
// el bundle del cliente no arrastre Supabase.

import type { ConversationMessage } from "./leads-types";

export interface InboundSummary {
  /** Mensajes escritos por el cliente (no los del bot ni los de la asesora). */
  inboundCount: number;
  /** Texto del primer mensaje del cliente, recortado. null si no escribio. */
  firstInboundText: string | null;
}

/**
 * Un unico mensaje que ya trae el link de una ficha de producto NO es "solo
 * saludo": cuando alguien esta en la pagina del producto y toca "consultar por
 * WhatsApp", el mensaje llega prellenado con la URL —
 *
 *   "https://mireva.cr/products/collagen-plus... Tengo una consulta"
 *
 * Es un solo mensaje, pero dice exactamente que producto quiere. Contarlo como
 * frio lo hunde al fondo de la cola junto a quien escribio "hola" y nada mas.
 */
export const PRODUCT_LINK_RE = /https?:\/\/\S*\/products\/\S/i;

export function hasProductLink(text: string | null | undefined): boolean {
  return text != null && PRODUCT_LINK_RE.test(text);
}

/** Cuanto texto guardamos del primer mensaje: alcanza para ver el link. */
const FIRST_INBOUND_MAX = 500;

// Medio emoji: una mitad de un par sustituto UTF-16 sin su pareja.
const SUSTITUTO_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Recorta un texto a `max` caracteres sin partir un emoji, y le saca lo que la
 * base no acepta.
 *
 * EL CASO REAL (07/10/2026): `slice(0, 500)` cuenta unidades UTF-16, y un emoji
 * son dos. Cuando el emoji caia justo en la posicion 500 quedaba la primera
 * mitad sola (`\ud83d`), JSON.stringify la mandaba tal cual y Supabase
 * rechazaba el UPDATE con "Empty or invalid json". Ese lead encabezaba la cola,
 * asi que todas las corridas del cron morian en el mismo lugar.
 *
 * Tambien saca el caracter nulo (\u0000), que un campo text de Postgres no
 * admite.
 */
export function textoGuardable(text: string, max: number): string {
  const limpio = text.replace(/\u0000/g, "").replace(SUSTITUTO_SUELTO, "\uFFFD");
  const puntos = Array.from(limpio);
  return puntos.length > max ? puntos.slice(0, max).join("") : limpio;
}

export function summarizeInbound(messages: ConversationMessage[]): InboundSummary {
  let inboundCount = 0;
  let firstInboundText: string | null = null;
  let firstTs = Number.POSITIVE_INFINITY;

  for (const msg of messages) {
    if (msg.direction !== "inbound") continue;
    inboundCount += 1;
    // El transcript ya viene ordenado, pero no se depende de eso: el primero es
    // el de timestamp menor. Un mensaje solo de media (audio, foto) cuenta para
    // el conteo pero no puede aportar texto.
    const text = (msg.text ?? msg.caption ?? "").trim();
    if (msg.timestamp < firstTs && text !== "") {
      firstTs = msg.timestamp;
      firstInboundText = textoGuardable(text, FIRST_INBOUND_MAX);
    }
  }

  return { inboundCount, firstInboundText };
}
