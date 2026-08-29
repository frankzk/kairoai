// La cola de HOY: la unica lista que la asesora necesita mirar para saber a
// quien llamar. Sale ya ordenada, asi que se trabaja de arriba hacia abajo sin
// tener que elegir entre pestañas.
//
//   1. Pagos por verificar        el cliente ya pago; se verifica en orden de llegada
//   2. Recontactos vencidos       lo que se le prometio al cliente, mas reciente primero
//   3. Por cerrar                 dio datos, falta cerrar
//   4. Sin llamar, por SEGMENTO   carrito -> enganchado -> converso -> solo saludo
//
// El paso 4 es el cambio de fondo: antes el orden lo daba la ETAPA (tibios
// antes que seguimientos), que no dice nada sobre la probabilidad de cerrar.
// Ahora lo da el segmento, y ese orden esta medido sobre 2.875 leads de esta
// base: un carrito llega a cerrar el 41,4% de las veces y un converso el 1,5%.
// Con capacidad para llamar a una fraccion minima de la cola, el orden ES la
// estrategia comercial.
//
// Lo que NO entra: los leads que una asesora ya trabajo y no tienen recontacto
// vencido. Esos viven en Seguimiento. Mezclarlos aca era lo que volvia la Cola
// un monton de 2.189 leads donde no se distinguia el trabajo del dia.
//
// Dentro de los reintentos manda la misma logica del resto de la cola: primero
// el mas reciente, y pasados STALE_FOLLOWUP_DAYS el vencido deja de subir al
// tope (ver ahi por que).

import type { BoardStage } from "./leads-classify";
import { SEGMENT_ORDER, type LeadSegment, type LeadWorkState } from "./leads-segment";

export interface QueueLead {
  board_stage: BoardStage;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  /** Ya tiene un pedido: no hay nada que venderle todavia. */
  has_order?: boolean;
  /** Eje 1: si nadie lo trabajo, entra a la cola de hoy. */
  work_state?: LeadWorkState;
  /** Eje 2: decide el orden dentro de "sin llamar". */
  segment?: LeadSegment;
}

/**
 * Etapas que pueden entrar a la cola. Ahora entran TODAS las trabajables,
 * incluidas `carrito` y `frio`.
 *
 * Antes quedaban fuera, y con el orden por segmento eso rompia el diseño: los
 * carritos sin llamar — el segmento que mas convierte (41,4%) — nunca llegaban
 * a la cola porque su etapa estaba vetada. Quien decide si un lead es
 * trabajable es `isInCallQueue` (categoria open/hot), no la etapa.
 */
export const QUEUE_STAGES: BoardStage[] = [
  "pago_verificar",
  "por_cerrar",
  "carrito",
  "tibios",
  "seguimiento",
  "frio",
];

// Rango del grupo en la cola. Un lead con agenda VENCIDA se promueve al grupo
// 1 sin importar su etapa (salvo pago_verificar, que sigue siendo lo primero):
// es una promesa/reintento con hora, y ya le llego la hora.
const RANK_PAGO = 0;
const RANK_DUE = 1;
const RANK_POR_CERRAR = 2;
// A partir de aca manda el SEGMENTO, no la etapa: carrito=3, enganchado=4,
// converso=5, frio=6. Ver la medicion en lib/leads-segment.ts.
const RANK_SEGMENTO_BASE = 3;
const RANK_FUERA = 99;

function interactionMs(lead: QueueLead): number {
  const t = lead.last_interaction_at ? Date.parse(lead.last_interaction_at) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function followupMs(lead: QueueLead): number | null {
  const t = lead.next_followup_at ? Date.parse(lead.next_followup_at) : NaN;
  return Number.isNaN(t) ? null : t;
}

export function isFollowupDue(lead: QueueLead, nowMs: number): boolean {
  const t = followupMs(lead);
  return t != null && t <= nowMs;
}

/**
 * A partir de aca un recontacto vencido deja de subir al tope: sigue en su
 * etapa, pero ya no le gana a un lead fresco.
 *
 * Medido en Costa Rica cuando estos leads por fin se pudieron ver: 174
 * recontactos vencidos, 30 dias de atraso promedio, y de los 159 que eran "no
 * contesto" NINGUNO llego a tener un segundo intento. Se habian vuelto
 * invisibles por el cupo de la consulta (quedaban en el puesto 5.928 de una
 * lista que cortaba en 2.000), asi que la promesa de "el vencido vuelve solo a
 * la Cola" nunca se cumplio. Al arreglar el cupo aparecieron todos juntos y,
 * con el orden viejo, coparon las primeras 174 posiciones de la Cola con lo
 * mas muerto que hay.
 */
export const STALE_FOLLOWUP_DAYS = 7;

/** Vencido y todavia vigente: es un reintento que vale la pena hacer hoy. */
export function isFollowupActionable(lead: QueueLead, nowMs: number): boolean {
  const t = followupMs(lead);
  if (t == null || t > nowMs) return false;
  return nowMs - t <= STALE_FOLLOWUP_DAYS * 86_400_000;
}

function queueRank(lead: QueueLead, nowMs: number): number {
  if (lead.board_stage === "pago_verificar") return RANK_PAGO;
  if (isFollowupActionable(lead, nowMs)) return RANK_DUE;
  if (lead.board_stage === "por_cerrar") return RANK_POR_CERRAR;
  // Ya lo trabajo una asesora y no tiene recontacto vencido: no es trabajo de
  // hoy. Vive en Seguimiento, donde se puede buscar y filtrar.
  if (lead.work_state === "seguimiento") return RANK_FUERA;
  const i = SEGMENT_ORDER.indexOf(lead.segment ?? "solo_saludo");
  return RANK_SEGMENTO_BASE + (i < 0 ? SEGMENT_ORDER.length : i);
}

/** Un lead entra a la cola de hoy si su rango no es RANK_FUERA. */
export function isTrabajoDeHoy(lead: QueueLead, nowMs: number): boolean {
  return queueRank(lead, nowMs) !== RANK_FUERA;
}

export function buildWorkQueue<T extends QueueLead>(leads: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return leads
    .filter((l) => QUEUE_STAGES.includes(l.board_stage))
    .filter((l) => isTrabajoDeHoy(l, nowMs))
    // La cola es para VENDER. Un cliente con pedido en curso solo espera su
    // entrega: eso lo lleva el equipo de gestion de pedidos, no la asesora.
    // (Un pedido puede colar al lead en un bucket de venta si el clasificador
    // ve un SINPE o carrito que en realidad corresponde a ese mismo pedido.)
    .filter((l) => !l.has_order)
    .slice()
    .sort((a, b) => {
      const rankA = queueRank(a, nowMs);
      const rankB = queueRank(b, nowMs);
      if (rankA !== rankB) return rankA - rankB;

      if (rankA === RANK_PAGO) {
        // El cliente YA pago: se verifica en orden de llegada (el que mas
        // tiempo lleva esperando primero).
        return interactionMs(a) - interactionMs(b);
      }

      if (rankA === RANK_DUE) {
        // Reintentos: el MAS RECIENTE arriba. Antes subia primero el mas
        // vencido, que es justo el que menos convierte: un "no contesto" de
        // ayer sigue caliente, uno de hace tres semanas ya es otra cosa.
        return (followupMs(b) as number) - (followupMs(a) as number);
      }

      // Dentro del mismo segmento, el mas reciente primero (regla de los 5
      // minutos de Shopify). Importa sobre todo en carrito, que es lo unico
      // perecedero: la tasa se desploma en la primera hora.
      return interactionMs(b) - interactionMs(a);
    });
}
