// Reparto automatico de leads: las reglas puras (lib/leads-assignment.ts).
import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_KEEP_TOP,
  ASSIGNMENT_REBALANCE_MAX_PER_RUN,
  ASSIGNMENT_REBALANCE_MIN_GAP,
  ASSIGNMENT_RELEASE_OFFLINE_MS,
  assignableLeadsInOrder,
  assignmentCounts,
  esAsesoraRepartible,
  planLeadAssignment,
  puedeConfigurarReparto,
  type AssignmentAdvisor,
  type PlanLead,
} from "../lib/leads-assignment";
import { buildWorkQueue } from "../lib/leads-queue";
import type { BoardStage } from "../lib/leads-classify";
import type { LeadSegment } from "../lib/leads-segment";

const NOW = Date.parse("2026-11-07T18:00:00Z");
const HORA = 60 * 60_000;

const asesora = (userId: number, over: Partial<AssignmentAdvisor> = {}): AssignmentAdvisor => ({
  userId,
  name: `Asesora ${userId}`,
  repartible: true,
  status: "active",
  lastSeenMs: NOW,
  ...over,
});

const SEGMENTOS: LeadSegment[] = ["carrito", "enganchado", "converso", "solo_saludo"];

/** n leads sin dueña, ya en orden de prioridad (segmento i % 4 por bloques). */
function leadsEnOrden(n: number, claimed_by: number | null = null, desde = 1): PlanLead[] {
  return Array.from({ length: n }, (_, i) => ({ id: desde + i, claimed_by }));
}

function cargasFinales(leads: PlanLead[], plan: ReturnType<typeof planLeadAssignment>) {
  const final = new Map(leads.map((l) => [l.id, l.claimed_by]));
  for (const c of plan.changes) final.set(c.lead_id, c.to_user);
  const cargas = new Map<number | null, number>();
  for (const owner of Array.from(final.values())) cargas.set(owner, (cargas.get(owner) ?? 0) + 1);
  return { final, cargas };
}

describe("quien puede recibir leads y quien prende el reparto", () => {
  it("con Leads o Leads del equipo si; quien administra no", () => {
    expect(esAsesoraRepartible(["leads"])).toBe(true);
    expect(esAsesoraRepartible(["leads", "leads_productividad"])).toBe(true);
    expect(esAsesoraRepartible(["leads", "leads_equipo"])).toBe(true);
    expect(esAsesoraRepartible(["leads_equipo"])).toBe(true);
    expect(esAsesoraRepartible(["leads", "config"])).toBe(false);
    expect(esAsesoraRepartible(["leads", "usuarios"])).toBe(false);
    expect(esAsesoraRepartible(["panel", "leads", "leads_equipo", "usuarios", "config"])).toBe(false);
    expect(esAsesoraRepartible(["novedades"])).toBe(false);
  });
  it("solo configuracion o usuarios cambian el interruptor", () => {
    expect(puedeConfigurarReparto(["config"])).toBe(true);
    expect(puedeConfigurarReparto(["usuarios"])).toBe(true);
    expect(puedeConfigurarReparto(["leads", "leads_equipo"])).toBe(false);
  });
});

describe("planLeadAssignment", () => {
  it("apagado: no hace nada aunque haya activas y leads sin dueña", () => {
    const plan = planLeadAssignment({
      enabled: false,
      nowMs: NOW,
      advisors: [asesora(1), asesora(2)],
      leads: leadsEnOrden(10),
      protectedIds: new Set(),
    });
    expect(plan.skipped).toBe("apagado");
    expect(plan.changes).toEqual([]);
  });

  it("sin ninguna activa: no reparte NI libera nada", () => {
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [
        asesora(1, { status: "idle" }),
        asesora(2, { status: "offline", lastSeenMs: NOW - 5 * HORA }),
      ],
      leads: [...leadsEnOrden(5), ...leadsEnOrden(5, 2, 100)],
      protectedIds: new Set(),
    });
    expect(plan.skipped).toBe("sin_asesoras_activas");
    expect(plan.changes).toEqual([]);
  });

  it("supervision activa no cuenta como asesora", () => {
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(9, { repartible: false })],
      leads: leadsEnOrden(3),
      protectedIds: new Set(),
    });
    expect(plan.skipped).toBe("sin_asesoras_activas");
  });

  it("1735 leads entre 2 activas: 868 y 867, intercalados en el orden de la cola", () => {
    const leads = leadsEnOrden(1735);
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(1), asesora(2), asesora(3, { status: "offline", lastSeenMs: null })],
      leads,
      protectedIds: new Set(),
    });
    expect(plan.skipped).toBeNull();
    expect(plan.changes).toHaveLength(1735);
    expect(plan.stats.nuevos).toBe(1735);
    const { cargas } = cargasFinales(leads, plan);
    expect(cargas.get(1)).toBe(868);
    expect(cargas.get(2)).toBe(867);
    expect(cargas.get(3)).toBeUndefined();
    // Intercalado: A, B, A, B... asi cada una recibe la misma mezcla.
    expect(plan.changes.slice(0, 6).map((c) => c.to_user)).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it("cada una recibe la misma mezcla de segmentos", () => {
    // 4 bloques contiguos de segmento, como sale de la cola.
    const segmentoDe = (i: number) => SEGMENTOS[Math.floor((i * 4) / 1000)];
    const leads = leadsEnOrden(1000);
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(1), asesora(2)],
      leads,
      protectedIds: new Set(),
    });
    const porAsesora = new Map<number, Record<string, number>>();
    plan.changes.forEach((c) => {
      const seg = segmentoDe(c.lead_id - 1);
      const m = porAsesora.get(c.to_user) ?? {};
      m[seg] = (m[seg] ?? 0) + 1;
      porAsesora.set(c.to_user, m);
    });
    for (const seg of SEGMENTOS) {
      expect(Math.abs((porAsesora.get(1)?.[seg] ?? 0) - (porAsesora.get(2)?.[seg] ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it("los nuevos van a la que tiene menos asignados", () => {
    const leads = [...leadsEnOrden(5, 1, 100), ...leadsEnOrden(3, 2, 200), ...leadsEnOrden(2)];
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(1), asesora(2)],
      leads,
      protectedIds: new Set(),
    });
    expect(plan.changes).toEqual([
      { lead_id: 1, from_user: null, to_user: 2 },
      { lead_id: 2, from_user: null, to_user: 2 },
    ]);
  });

  it("un lead sin dueña que una activa esta trabajando es de ella", () => {
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(1), asesora(2)],
      leads: leadsEnOrden(2),
      protectedIds: new Set(),
      recentWorker: new Map([[1, 2]]),
    });
    expect(plan.changes.find((c) => c.lead_id === 1)?.to_user).toBe(2);
  });

  it("se conecta una tercera: se empareja de a poco, sin tocar lo trabajado ni lo de arriba", () => {
    const deA = leadsEnOrden(868, 1, 1);
    const deB = leadsEnOrden(868, 2, 1001);
    let leads = [...deA, ...deB];
    // A trabajo sus primeros 300; esos no se mueven.
    const protegidos = new Set(deA.slice(0, 300).map((l) => l.id));
    const arribaDeB = new Set(deB.slice(0, ASSIGNMENT_KEEP_TOP).map((l) => l.id));
    let corridas = 0;
    for (; corridas < 40; corridas++) {
      const plan = planLeadAssignment({
        enabled: true,
        nowMs: NOW,
        advisors: [asesora(1), asesora(2), asesora(3)],
        leads,
        protectedIds: protegidos,
      });
      if (!plan.changes.length) break;
      // Cada corrida mueve poco, solo a la nueva, nada trabajado ni de arriba.
      expect(plan.changes.length).toBeLessThanOrEqual(ASSIGNMENT_REBALANCE_MAX_PER_RUN);
      expect(plan.changes.every((c) => c.to_user === 3)).toBe(true);
      expect(plan.changes.every((c) => !protegidos.has(c.lead_id) && !arribaDeB.has(c.lead_id))).toBe(true);
      expect(plan.stats.rebalanceados).toBe(plan.changes.length);
      const { final } = cargasFinales(leads, plan);
      leads = leads.map((l) => ({ ...l, claimed_by: final.get(l.id) ?? null }));
    }
    const cargas = new Map<number, number>();
    for (const l of leads) cargas.set(l.claimed_by!, (cargas.get(l.claimed_by!) ?? 0) + 1);
    const valores = [cargas.get(1) ?? 0, cargas.get(2) ?? 0, cargas.get(3) ?? 0];
    expect(valores.reduce((a, b) => a + b, 0)).toBe(1736);
    // Queda dentro del umbral de rebalanceo, en varias corridas y no de golpe.
    expect(Math.max(...valores) - Math.min(...valores)).toBeLessThanOrEqual(ASSIGNMENT_REBALANCE_MIN_GAP);
    expect(corridas).toBeGreaterThan(10);
    for (const id of Array.from(protegidos)) expect(leads.find((l) => l.id === id)?.claimed_by).toBe(1);
  });

  it("si todo lo de la cargada esta trabajado, no se mueve nada", () => {
    const deA = leadsEnOrden(50, 1);
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(1), asesora(2)],
      leads: deA,
      protectedIds: new Set(deA.map((l) => l.id)),
    });
    expect(plan.changes).toEqual([]);
  });

  it("una diferencia chica no mueve leads (los nuevos ya van a la menos cargada)", () => {
    const leads = [...leadsEnOrden(ASSIGNMENT_REBALANCE_MIN_GAP, 1, 1)];
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(1), asesora(2)],
      leads,
      protectedIds: new Set(),
    });
    expect(plan.changes).toEqual([]);
  });

  it("desconectada mas de 2 h: lo no trabajado vuelve al reparto, lo trabajado sigue siendo suyo", () => {
    const deC = leadsEnOrden(10, 3, 1);
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [
        asesora(1),
        asesora(2),
        asesora(3, { status: "offline", lastSeenMs: NOW - ASSIGNMENT_RELEASE_OFFLINE_MS - 60_000 }),
      ],
      leads: deC,
      protectedIds: new Set([1, 2, 3]),
    });
    const { final } = cargasFinales(deC, plan);
    expect([1, 2, 3].map((id) => final.get(id))).toEqual([3, 3, 3]);
    expect(plan.changes).toHaveLength(7);
    expect(plan.changes.every((c) => c.from_user === 3 && (c.to_user === 1 || c.to_user === 2))).toBe(true);
    expect(plan.stats.liberados).toBe(7);
  });

  it("desconectada hace menos de 2 h, o conectada pero inactiva: conserva sus leads", () => {
    for (const persona of [
      asesora(3, { status: "offline", lastSeenMs: NOW - ASSIGNMENT_RELEASE_OFFLINE_MS + 60_000 }),
      asesora(3, { status: "idle" }),
    ]) {
      const leads = leadsEnOrden(4, 3);
      const plan = planLeadAssignment({
        enabled: true,
        nowMs: NOW,
        advisors: [asesora(1), persona],
        leads,
        protectedIds: new Set(),
      });
      expect(plan.changes).toEqual([]);
    }
  });

  it("una dueña que ya no esta en Leads (o paso a supervision) libera lo no trabajado", () => {
    const leads = leadsEnOrden(4, 77);
    const plan = planLeadAssignment({
      enabled: true,
      nowMs: NOW,
      advisors: [asesora(1)],
      leads,
      protectedIds: new Set([1]),
    });
    expect(plan.changes.map((c) => c.lead_id)).toEqual([2, 3, 4]);
  });
});

describe("assignableLeadsInOrder: la misma cola que el tablero", () => {
  const base = {
    has_order: false,
    next_followup_at: null as string | null,
    claimed_by: null as number | null,
  };
  const lead = (
    id: number,
    board_stage: BoardStage,
    segment: LeadSegment,
    work_state: "sin_llamar" | "seguimiento",
    minutosAtras: number,
    extra: Record<string, unknown> = {}
  ) => ({
    ...base,
    id,
    board_stage,
    segment,
    work_state,
    in_call_queue: board_stage !== "pago_verificar",
    last_interaction_at: new Date(NOW - minutosAtras * 60_000).toISOString(),
    ...extra,
  });

  const leads = [
    lead(1, "frio", "solo_saludo", "sin_llamar", 5),
    lead(2, "carrito", "carrito", "sin_llamar", 50),
    lead(3, "seguimiento", "converso", "seguimiento", 10), // Seguimiento
    lead(4, "tibios", "enganchado", "sin_llamar", 20),
    lead(5, "seguimiento", "converso", "seguimiento", 30, {
      next_followup_at: new Date(NOW - HORA).toISOString(), // recontacto vencido: Hoy, primero
    }),
    lead(6, "seguimiento", "converso", "seguimiento", 2), // Seguimiento, mas reciente
  ];

  it("Hoy en el orden de buildWorkQueue y despues Seguimiento del mas reciente al mas viejo", () => {
    const now = new Date(NOW);
    const ordenados = assignableLeadsInOrder(leads, now).map((l) => l.id);
    const hoy = buildWorkQueue(leads, now).map((l) => l.id);
    expect(ordenados.slice(0, hoy.length)).toEqual(hoy);
    expect(hoy).toEqual([5, 2, 4, 1]);
    expect(ordenados).toEqual([5, 2, 4, 1, 6, 3]);
  });

  it("los contadores por dueña cuentan solo leads abiertos", () => {
    const conDuena = leads.map((l) => ({ ...l, claimed_by: l.id % 2 ? 7 : null }));
    const ganado = lead(9, "frio", "solo_saludo", "sin_llamar", 1, { has_order: true, claimed_by: 7 });
    const c = assignmentCounts([...conDuena, ganado], new Date(NOW));
    expect(c).toEqual({ porUsuario: { 7: 3 }, sinAsignar: 3, total: 6 });
  });
});
