// Los dos ejes del tablero de leads.
//
// El tablero cruza DOS preguntas independientes sobre el mismo lead:
//
//   Eje 1 — ¿alguien ya lo llamo?   -> leadWorkState()  (Sin llamar / En seguimiento)
//   Eje 2 — ¿cuanta intencion tiene? -> leadSegment()   (Carrito / Enganchado / Converso / Solo saludó)
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

/**
 * Corte del segmento "enganchado". Sale de la medicion: la tasa salta de 7,5%
 * (4-9 mensajes) a 38,8% (10 o mas). Es el unico corte del rango de mensajes
 * que separa de verdad.
 */
export const ENGANCHADO_MIN_MENSAJES = 10;

/** Eje 1: quien lo trabajo. */
export type LeadWorkState = "sin_llamar" | "seguimiento";

/** Eje 2: cuanta intencion de compra muestra. Cascada, gana el primero. */
export type LeadSegment = "carrito" | "enganchado" | "converso" | "solo_saludo";

/** Campos que necesita la clasificacion. Nada mas: es una funcion pura. */
export interface SegmentInput {
  status: string;
  status_source: string;
  category: string;
  cart_item_count: number | null;
  shopify_cart_open: boolean;
  shopify_draft_cart_count: number;
  has_cart_signal: boolean;
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
 * llamada, y NO se copio de ningun lado: se midio en esta base.
 *
 * Sobre 2.875 leads con el chat ya leido, cuantos llegaron a "por cerrar" o a
 * tener pedido:
 *
 *   carrito ................ 41,4%  (326 leads)
 *   enganchado (10+ msgs) .. 15,8%  (165)
 *   converso (2-9 msgs) ..... 1,5%  (1.484)
 *   solo saludo (0-1 msg) ... 1,0%  (900)
 *
 * La separacion real esta entre los dos primeros y el resto: un carrito vale
 * 27 veces mas que un converso. Por eso "converso" junta 2-9 mensajes — dentro
 * de ese rango la diferencia (2,0% vs 0,9%) no alcanza para partirlo en dos
 * chips mas.
 *
 * OJO CON LA CAUSALIDAD: un lead que estuvo por comprar intercambia mas
 * mensajes POR estar negociando, asi que parte del 15,8% es efecto y no causa.
 * Sirve para ordenar a quien llamar primero, no para prometer que llamar a un
 * "enganchado" produce ese cierre.
 *
 * SE MIDIO Y SE DESCARTO: la regla del link de producto (un unico mensaje que
 * ya trae la URL de la ficha, que en el CRM de origen cuenta como "converso").
 * Aca esos 708 leads llegan lejos en el 0,1% de los casos — el peor segmento
 * de todos, por debajo de los que solo saludaron. Se dejan ahi.
 *
 * `district` se saco de la cascada: la columna nunca se poblo y no hay con que
 * ubicarla en este orden.
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
  if ((lead.inbound_count ?? 0) >= ENGANCHADO_MIN_MENSAJES) return "enganchado";
  if ((lead.inbound_count ?? 0) >= 2) return "converso";
  return "solo_saludo";
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

/** Orden de llamada, de mas a menos probable. Ver `leadSegment`. */
export const SEGMENT_ORDER: LeadSegment[] = ["carrito", "enganchado", "converso", "solo_saludo"];

export const SEGMENT_META: Record<LeadSegment, { label: string; emoji: string; hint: string }> = {
  carrito: { label: "Carrito", emoji: "🛒", hint: "Armó un carrito real · 41% llega a cerrar" },
  enganchado: { label: "Enganchado", emoji: "🔥", hint: "10+ mensajes suyos · 16% llega a cerrar" },
  converso: { label: "Conversó", emoji: "💬", hint: "2 a 9 mensajes suyos · 1,5%" },
  // Se llama "Solo saludó" y no "Frío" a proposito: `frio` tambien es una
  // ETAPA (status que pone el bot por inactividad) y las dos cosas convivian en
  // la misma pantalla significando cosas distintas. Medido: de 231 leads en
  // etapa Frío, 116 NO eran frios de intencion (108 conversaron, 6 enganchados,
  // 2 con carrito). El nombre dice lo que el cliente hizo, no como se "siente".
  solo_saludo: { label: "Solo saludó", emoji: "👋", hint: "Un mensaje o ninguno · 1%" },
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

/**
 * Cuenta los segmentos del conjunto que se le pase.
 *
 * REGLA: el que llama tiene que pasarle los leads del TAB ACTIVO ya filtrados,
 * pero SIN aplicar el filtro de intencion. Asi los chips suman exactamente el
 * total del tab y el numero coincide con lo que uno recibe al hacer clic.
 *
 * Antes esto era boardFacets(), que recibia todos los leads de la cola y solo
 * aplicaba el eje de gestion. En el tab "Hoy" — que no es un estado de gestion
 * sino una cola armada — se le pasaba null y contaba TODA la cola: los chips
 * decian 2.580 (Hoy + Seguimiento) parado en un Hoy de 619. El chip "Carrito
 * 196" filtraba a los carritos de Hoy, que son muchos menos.
 */
export function segmentCounts<T extends { segment: LeadSegment }>(
  leads: T[]
): Record<LeadSegment, number> {
  const counts: Record<LeadSegment, number> = {
    carrito: 0,
    enganchado: 0,
    converso: 0,
    solo_saludo: 0,
  };
  for (const lead of leads) counts[lead.segment] += 1;
  return counts;
}

