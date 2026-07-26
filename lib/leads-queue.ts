// Cola de trabajo de las asesoras — regla de atencion acordada (audio socio,
// 2026-07): primero pagos por verificar, luego los REINTENTOS/agenda vencida
// (el "no contesto" de ayer vuelve a aparecer solo, sin revisar Seguimiento),
// luego "por cerrar" con el lead MAS RECIENTE primero (regla de los 5 minutos
// de Shopify: el que acaba de caer es el que mas convierte), luego tibios
// (mas reciente primero) y al final el resto de seguimientos.
// Etapas frio/ganado/descartado no entran a la cola.

import type { BoardStage } from "./leads-classify";

export interface QueueLead {
  board_stage: BoardStage;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  /** Ya tiene un pedido: no hay nada que venderle todavia. */
  has_order?: boolean;
}

export const QUEUE_STAGES: BoardStage[] = [
  "pago_verificar",
  "por_cerrar",
  "tibios",
  "seguimiento",
];

// Rango del grupo en la cola. Un lead con agenda VENCIDA se promueve al grupo
// 1 sin importar su etapa (salvo pago_verificar, que sigue siendo lo primero):
// es una promesa/reintento con hora, y ya le llego la hora.
const RANK_PAGO = 0;
const RANK_DUE = 1;
const RANK_STAGE_BASE = 2; // por_cerrar=2, tibios=3, seguimiento=4

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

function queueRank(lead: QueueLead, nowMs: number): number {
  if (lead.board_stage === "pago_verificar") return RANK_PAGO;
  if (isFollowupDue(lead, nowMs)) return RANK_DUE;
  const i = QUEUE_STAGES.indexOf(lead.board_stage);
  return i < 0 ? 99 : RANK_STAGE_BASE + (i - 1);
}

export function buildWorkQueue<T extends QueueLead>(leads: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return leads
    .filter((l) => QUEUE_STAGES.includes(l.board_stage))
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
        // Reintentos: el mas vencido arriba.
        return (followupMs(a) as number) - (followupMs(b) as number);
      }

      // por_cerrar, tibios y seguimiento: el mas reciente primero (regla de
      // los 5 minutos).
      return interactionMs(b) - interactionMs(a);
    });
}
