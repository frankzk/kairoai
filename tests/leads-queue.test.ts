import { describe, expect, it } from "vitest";

import { buildWorkQueue, type QueueLead } from "../lib/leads-queue";
import type { BoardStage } from "../lib/leads-classify";

const NOW = new Date("2026-07-25T18:00:00Z");

function lead(
  id: string,
  stage: BoardStage,
  lastInteraction: string | null,
  nextFollowup: string | null = null
): QueueLead & { id: string } {
  return {
    id,
    board_stage: stage,
    last_interaction_at: lastInteraction,
    next_followup_at: nextFollowup,
  };
}

const ids = (queue: Array<{ id: string }>) => queue.map((l) => l.id);

describe("buildWorkQueue", () => {
  it("ordena por etapa: pago_verificar > por_cerrar > tibios > seguimiento", () => {
    const queue = buildWorkQueue(
      [
        lead("seg", "seguimiento", "2026-07-25T17:00:00Z"),
        lead("tib", "tibios", "2026-07-25T17:00:00Z"),
        lead("cerrar", "por_cerrar", "2026-07-25T17:00:00Z"),
        lead("pago", "pago_verificar", "2026-07-25T17:00:00Z"),
      ],
      NOW
    );
    expect(ids(queue)).toEqual(["pago", "cerrar", "tib", "seg"]);
  });

  it("excluye frio, ganado, descartado y carrito de la cola", () => {
    const queue = buildWorkQueue(
      [
        lead("frio", "frio", "2026-07-25T17:00:00Z"),
        lead("ganado", "ganado", "2026-07-25T17:00:00Z"),
        lead("desc", "descartado", "2026-07-25T17:00:00Z"),
        lead("carr", "carrito", "2026-07-25T17:00:00Z"),
        lead("cerrar", "por_cerrar", "2026-07-25T17:00:00Z"),
      ],
      NOW
    );
    expect(ids(queue)).toEqual(["cerrar"]);
  });

  it("por_cerrar: el lead mas reciente primero (regla de los 5 minutos)", () => {
    const queue = buildWorkQueue(
      [
        lead("viejo", "por_cerrar", "2026-07-25T10:00:00Z"),
        lead("nuevo", "por_cerrar", "2026-07-25T17:55:00Z"),
        lead("medio", "por_cerrar", "2026-07-25T14:00:00Z"),
      ],
      NOW
    );
    expect(ids(queue)).toEqual(["nuevo", "medio", "viejo"]);
  });

  it("pago_verificar: orden de llegada (el que mas espera primero)", () => {
    const queue = buildWorkQueue(
      [
        lead("reciente", "pago_verificar", "2026-07-25T17:50:00Z"),
        lead("esperando", "pago_verificar", "2026-07-25T12:00:00Z"),
      ],
      NOW
    );
    expect(ids(queue)).toEqual(["esperando", "reciente"]);
  });

  it("seguimiento: vencidos de agenda primero (mas vencido arriba), luego recientes", () => {
    const queue = buildWorkQueue(
      [
        lead("sin-agenda-nuevo", "seguimiento", "2026-07-25T17:00:00Z"),
        lead("vencido-hoy", "seguimiento", "2026-07-24T10:00:00Z", "2026-07-25T15:00:00Z"),
        lead("muy-vencido", "seguimiento", "2026-07-20T10:00:00Z", "2026-07-23T15:00:00Z"),
        lead("futuro", "seguimiento", "2026-07-25T16:00:00Z", "2026-07-28T15:00:00Z"),
        lead("sin-agenda-viejo", "seguimiento", "2026-07-22T09:00:00Z"),
      ],
      NOW
    );
    expect(ids(queue)).toEqual([
      "muy-vencido",
      "vencido-hoy",
      "sin-agenda-nuevo",
      "futuro",
      "sin-agenda-viejo",
    ]);
  });

  it("promueve reintentos vencidos arriba de por_cerrar, debajo de pago_verificar", () => {
    const queue = buildWorkQueue(
      [
        lead("cerrar-nuevo", "por_cerrar", "2026-07-25T17:55:00Z"),
        // "No contesto" de ayer: reintento agendado que ya vencio.
        lead("reintento", "seguimiento", "2026-07-24T15:00:00Z", "2026-07-25T15:00:00Z"),
        lead("pago", "pago_verificar", "2026-07-25T12:00:00Z"),
        lead("tibio-vencido", "tibios", "2026-07-24T10:00:00Z", "2026-07-25T10:00:00Z"),
      ],
      NOW
    );
    // pago primero; luego los vencidos (mas vencido arriba); luego por_cerrar.
    expect(ids(queue)).toEqual(["pago", "tibio-vencido", "reintento", "cerrar-nuevo"]);
  });

  it("una agenda a futuro NO promueve: espera su hora en su etapa", () => {
    const queue = buildWorkQueue(
      [
        lead("agendado-futuro", "seguimiento", "2026-07-25T17:00:00Z", "2026-07-28T15:00:00Z"),
        lead("tibio", "tibios", "2026-07-25T10:00:00Z"),
      ],
      NOW
    );
    expect(ids(queue)).toEqual(["tibio", "agendado-futuro"]);
  });

  it("excluye leads que ya tienen pedido: la cola es para vender", () => {
    const queue = buildWorkQueue(
      [
        // Pedido en curso + el clasificador lo colo en un bucket de venta
        // (SINPE del propio pedido leido como pago nuevo).
        { ...lead("con-pedido", "pago_verificar", "2026-07-25T17:55:00Z"), has_order: true },
        { ...lead("vencido-con-pedido", "seguimiento", "2026-07-24T10:00:00Z", "2026-07-25T10:00:00Z"), has_order: true },
        lead("sin-pedido", "tibios", "2026-07-25T10:00:00Z"),
      ],
      NOW
    );
    expect(ids(queue)).toEqual(["sin-pedido"]);
  });

  it("tolera fechas nulas sin romper el orden de etapas", () => {
    const queue = buildWorkQueue(
      [
        lead("sin-fecha", "por_cerrar", null),
        lead("con-fecha", "por_cerrar", "2026-07-25T17:00:00Z"),
        lead("tibio", "tibios", null),
      ],
      NOW
    );
    expect(ids(queue)).toEqual(["con-fecha", "sin-fecha", "tibio"]);
  });
});
