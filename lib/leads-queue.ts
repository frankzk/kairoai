// Cola de trabajo de las asesoras — regla de atencion acordada (audio socio,
// 2026-07): primero pagos por verificar, luego "por cerrar" con el lead MAS
// RECIENTE primero (regla de los 5 minutos de Shopify: el que acaba de caer es
// el que mas convierte), luego tibios (mas reciente primero) y al final los
// seguimientos (vencidos de agenda primero, luego los mas recientes).
// Etapas frio/ganado/descartado no entran a la cola.

import type { BoardStage } from "./leads-classify";

export interface QueueLead {
  board_stage: BoardStage;
  last_interaction_at: string | null;
  next_followup_at: string | null;
}

export const QUEUE_STAGES: BoardStage[] = [
  "pago_verificar",
  "por_cerrar",
  "tibios",
  "seguimiento",
];

function stageRank(stage: BoardStage): number {
  const i = QUEUE_STAGES.indexOf(stage);
  return i < 0 ? 99 : i;
}

function interactionMs(lead: QueueLead): number {
  const t = lead.last_interaction_at ? Date.parse(lead.last_interaction_at) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function followupMs(lead: QueueLead): number | null {
  const t = lead.next_followup_at ? Date.parse(lead.next_followup_at) : NaN;
  return Number.isNaN(t) ? null : t;
}

export function buildWorkQueue<T extends QueueLead>(leads: T[], now: Date): T[] {
  const nowMs = now.getTime();
  return leads
    .filter((l) => QUEUE_STAGES.includes(l.board_stage))
    .slice()
    .sort((a, b) => {
      const rank = stageRank(a.board_stage) - stageRank(b.board_stage);
      if (rank !== 0) return rank;

      if (a.board_stage === "pago_verificar") {
        // El cliente YA pago: se verifica en orden de llegada (el que mas
        // tiempo lleva esperando primero).
        return interactionMs(a) - interactionMs(b);
      }

      if (a.board_stage === "seguimiento") {
        // Vencidos de agenda primero (el mas vencido arriba); despues el
        // resto por actividad reciente.
        const fa = followupMs(a);
        const fb = followupMs(b);
        const aDue = fa != null && fa <= nowMs;
        const bDue = fb != null && fb <= nowMs;
        if (aDue !== bDue) return aDue ? -1 : 1;
        if (aDue && bDue) return (fa as number) - (fb as number);
        return interactionMs(b) - interactionMs(a);
      }

      // por_cerrar y tibios: el mas reciente primero (regla de los 5 minutos).
      return interactionMs(b) - interactionMs(a);
    });
}
