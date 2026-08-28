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
      firstInboundText = text.slice(0, FIRST_INBOUND_MAX);
    }
  }

  return { inboundCount, firstInboundText };
}
