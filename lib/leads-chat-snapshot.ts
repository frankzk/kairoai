// Copia compacta del chat de un lead, para poder leerlo fuera de Icomfly.
//
// POR QUE: el tablero lee el chat en vivo cada vez que se abre y nunca lo
// guarda. Para analizar los carritos ("¿a cual le falta poco para cerrar?") hay
// que leer el texto de cada conversacion, y eso solo se puede desde el
// servidor, que es el que tiene la llave de Icomfly.
//
// Modulo puro: sin base ni red. Lo usa app/api/leads/chat-snapshots y se prueba
// en tests/leads-chat-snapshot.test.ts.

import { textoGuardable } from "./leads-inbound";
import type { ConversationMessage } from "./leads-types";

export type Autor = "cliente" | "bot" | "asesora" | "nosotros";

export interface MensajeCompacto {
  /** Fecha ISO del mensaje. */
  t: string;
  de: Autor;
  texto: string;
}

/** Cuantos mensajes se guardan: los ultimos, que son los que dicen como quedo. */
export const MAX_MENSAJES = 80;
/** Largo maximo de cada mensaje guardado. */
export const MAX_TEXTO = 1000;

const CLIENTE = new Set(["contact", "customer", "client", "cliente", "inbound", "in"]);
const BOT = new Set(["bot", "ai", "assistant", "automation", "system", "chatbot", "flow"]);
const ASESORA = new Set(["admin", "agent", "user", "human", "operator", "asesora"]);

/**
 * Quien escribio. La diferencia entre bot y asesora es la que importa: "el
 * cliente pregunto y solo le contesto el bot" es otra situacion que "lo atendio
 * una persona". Si Icomfly no dice quien fue, queda "nosotros".
 */
export function autorDe(msg: Pick<ConversationMessage, "direction" | "sender">): Autor {
  if (msg.direction === "inbound") return "cliente";
  const s = (msg.sender ?? "").toLowerCase();
  if (CLIENTE.has(s)) return "cliente";
  if (BOT.has(s)) return "bot";
  if (ASESORA.has(s)) return "asesora";
  return "nosotros";
}

/** Texto legible de un mensaje; los adjuntos quedan como [audio], [imagen]... */
function textoDe(msg: ConversationMessage): string {
  const texto = (msg.text ?? msg.caption ?? "").trim();
  if (texto) return texto;
  if (msg.template) return `[plantilla: ${msg.template}]`;
  const media: Record<string, string> = {
    image: "[imagen]",
    audio: "[audio]",
    video: "[video]",
    document: "[documento]",
    sticker: "[sticker]",
  };
  return msg.mediaKind ? media[msg.mediaKind] : "";
}

export function compactarChat(messages: ConversationMessage[]): MensajeCompacto[] {
  return messages
    .map((m) => ({ m, texto: textoDe(m) }))
    .filter(({ texto }) => texto !== "")
    .sort((a, b) => a.m.timestamp - b.m.timestamp)
    .slice(-MAX_MENSAJES)
    .map(({ m, texto }) => ({
      t: new Date(m.timestamp || 0).toISOString(),
      de: autorDe(m),
      texto: textoGuardable(texto, MAX_TEXTO),
    }));
}
