// Los dos ejes del tablero de leads.
//
// El tablero cruza DOS preguntas independientes sobre el mismo lead:
//
//   Eje 1 — ¿alguien ya lo llamo?   -> leadWorkState()  (Sin llamar / En seguimiento)
//   Eje 2 — ¿cuanta intencion tiene? -> leadSegment()   (Carrito / Distrito / Converso / Frio)
//
// Se combinan con Y: el segmento filtra DENTRO del estado activo, no lo
// reemplaza. Por eso los segmentos suman exactamente el total del eje 1 activo.
//
// POR QUE IMPORTA: antes los dos ejes vivian en una sola fila de tabs
// excluyentes ("Carrito" competia con "Seguimiento"), asi que un lead con
// carrito abierto Y ya contactado tenia que elegir uno. Esa era la causa del
// reporte "pongo Contactado en el carrito y no pasa a Seguimiento": el tablero
// pedia elegir entre dos cosas que son ciertas a la vez. Separados en ejes, el
// lead esta en "En seguimiento x Carrito" y aparece en los dos filtros sin
// contradiccion.

import { statusBoardStage } from "./leads-classify";

/** Eje 1: quien lo trabajo. */
export type LeadWorkState = "sin_llamar" | "seguimiento";

/** Eje 2: cuanta intencion de compra muestra. Cascada, gana el primero. */
export type LeadSegment = "carrito" | "distrito" | "converso" | "frio";

/** Campos que necesita la clasificacion. Nada mas: es una funcion pura. */
export interface SegmentInput {
  status: string;
  status_source: string;
  category: string;
  cart_item_count: number | null;
  shopify_cart_open: boolean;
  shopify_draft_cart_count: number;
  has_cart_signal: boolean;
  district: string | null;
  inbound_count: number;
}

/**
 * Eje 1. En kairoai NO sirve el truco de "status !== 'nuevo'": el bot escribe
 * estados automaticos todo el tiempo (frio, conversando, carrito_abandonado,
 * por_cerrar) y ninguno de esos fue llamado por nadie. El campo correcto es
 * status_source, que ya distingue lo que puso una persona de lo que puso el
 * bot — es la misma ley 2 del clasificador.
 */
export function leadWorkState(lead: Pick<SegmentInput, "status_source">): LeadWorkState {
  return lead.status_source === "manual" ? "seguimiento" : "sin_llamar";
}

/**
 * Eje 2, en cascada: gana la primera que coincida. El orden es el orden de
 * llamada, de mas a menos intencion.
 *
 * Un lead cae en UN solo balde. Si se permitieran etiquetas acumulables los
 * contadores dejarian de sumar el total y la pantalla se contradiria sola.
 *
 * OJO — dos segmentos estan vacios hoy: `district` e `inbound_count` existen
 * como columnas pero ningun codigo las escribe (0 de 20.140 leads), porque el
 * transcript se lee en vivo de Icomfly y no se persiste. La cascada los deja
 * implementados para que al poblarlos el tablero funcione solo. Falta tambien
 * la regla del link de producto (un unico mensaje que ya trae la URL de la
 * ficha cuenta como "converso"): necesita first_inbound_text, que todavia no
 * existe en la tabla.
 */
export function leadSegment(lead: SegmentInput): LeadSegment {
  if (
    (lead.cart_item_count ?? 0) > 0 ||
    lead.shopify_cart_open ||
    (lead.shopify_draft_cart_count ?? 0) > 0 ||
    lead.has_cart_signal
  ) {
    return "carrito";
  }
  if ((lead.district ?? "").trim() !== "") return "distrito";
  if ((lead.inbound_count ?? 0) >= 2) return "converso";
  return "frio";
}

/**
 * La cola de llamadas: que leads entran siquiera a los dos tabs del eje 1.
 *
 * Los pagos por verificar quedan fuera aunque sean `hot`: tienen su propia
 * pestaña porque son otro trabajo, con otra persona. Ganados y descartados
 * quedan fuera por definicion.
 */
export function isInCallQueue(lead: SegmentInput): boolean {
  if (lead.category !== "open" && lead.category !== "hot") return false;
  const stage = statusBoardStage(lead.status);
  return stage !== "pago_verificar" && stage !== "cerrado" && stage !== "descartado";
}

export const SEGMENT_ORDER: LeadSegment[] = ["carrito", "distrito", "converso", "frio"];
export const WORK_STATE_ORDER: LeadWorkState[] = ["sin_llamar", "seguimiento"];

export const SEGMENT_META: Record<LeadSegment, { label: string; emoji: string; hint: string }> = {
  carrito: { label: "Carrito", emoji: "🛒", hint: "Armo un carrito real" },
  distrito: { label: "Dio distrito", emoji: "📍", hint: "Dio su distrito de envio" },
  converso: { label: "Conversó", emoji: "💬", hint: "Dos o mas mensajes suyos" },
  frio: { label: "Frío", emoji: "❄️", hint: "Solo saludo, o ni respondio" },
};

export const WORK_STATE_META: Record<LeadWorkState, { label: string; emoji: string }> = {
  sin_llamar: { label: "Sin llamar", emoji: "📵" },
  seguimiento: { label: "En seguimiento", emoji: "💬" },
};

/** Los dos ejes ya resueltos. Los calcula la API una vez y viajan con el lead. */
export interface ClassifiedLead {
  work_state: LeadWorkState;
  segment: LeadSegment;
  in_call_queue: boolean;
  needs_attention?: boolean;
}

/** Resuelve los dos ejes de un lead. Unico lugar donde se clasifica. */
export function classifyLead(lead: SegmentInput): Omit<ClassifiedLead, "needs_attention"> {
  return {
    work_state: leadWorkState(lead),
    segment: leadSegment(lead),
    in_call_queue: isInCallQueue(lead),
  };
}

export interface BoardFacets {
  /** Total de la cola, sin aplicar ninguna de las dos facetas. */
  total: number;
  /** Ignora eje 1 Y eje 2: los tabs de arriba no se encogen al filtrar. */
  byWorkState: Record<LeadWorkState, number>;
  /** Aplica eje 1, ignora eje 2: los segmentos suman el total del tab activo. */
  bySegment: Record<LeadSegment, number>;
  /** Cuantos del tab activo piden atencion (semaforo). */
  needsAttention: number;
}

/**
 * Contadores facetados. Cada faceta se cuenta sobre el conjunto filtrado por
 * todo MENOS por ella misma. Son dos reglas distintas y hay que respetarlas o
 * los numeros se contradicen en pantalla:
 *
 *   - Segmentos: aplican el filtro de eje 1 -> suman el total del tab activo.
 *   - Eje 1: NO aplican el filtro de segmento -> totales estables, no se
 *     encogen al elegir un segmento. Si se encogieran, el usuario perderia la
 *     referencia de donde esta parado.
 */
export function boardFacets<T extends ClassifiedLead>(
  leads: T[],
  activeWorkState: LeadWorkState | null
): BoardFacets {
  const byWorkState: Record<LeadWorkState, number> = { sin_llamar: 0, seguimiento: 0 };
  const bySegment: Record<LeadSegment, number> = {
    carrito: 0,
    distrito: 0,
    converso: 0,
    frio: 0,
  };
  let total = 0;
  let needsAttention = 0;

  for (const lead of leads) {
    if (!lead.in_call_queue) continue;
    total += 1;
    byWorkState[lead.work_state] += 1;
    if (activeWorkState === null || lead.work_state === activeWorkState) {
      bySegment[lead.segment] += 1;
      if (lead.needs_attention) needsAttention += 1;
    }
  }

  return { total, byWorkState, bySegment, needsAttention };
}
