// Reparto automatico de leads entre las asesoras activas.
//
// Modulo PURO (sin base, sin Node, sin navegador): decide QUE lead va a QUIEN.
// Leer la base y aplicar los cambios vive en lib/leads-assignment-server.ts; el
// tablero usa de aca los conteos por asesora.
//
// LAS REGLAS
//
//   1. Que se reparte: los leads abiertos que el tablero muestra en Hoy y en
//      Seguimiento (ni Cerrado ni Descartados), en el MISMO orden de la cola de
//      Hoy (lib/leads-queue.ts: pagos, recontactos vencidos, por cerrar, y los
//      sin llamar por segmento: carrito, enganchado, converso, solo saludo),
//      seguidos de Seguimiento del mas reciente al mas viejo.
//   2. A quien: a las asesoras que el panel de Productividad muestra como
//      "Activa" en ese momento (presenceStatus === "active"), que tienen Leads
//      en la tienda y no son supervision. Sin ninguna activa, no se toca nada.
//   3. Los leads sin dueña se reparten en el orden de la cola, siempre a la
//      activa con MENOS leads asignados: con cargas parejas sale A, B, A, B...
//      y cada una recibe la misma mezcla de carritos, enganchados, etc.
//   4. Rebalanceo: si entre las activas la diferencia pasa de
//      ASSIGNMENT_REBALANCE_MIN_GAP (p. ej. se conecto una asesora nueva), se
//      pasan leads de la mas cargada a la menos cargada DE A POCO: como mucho
//      ASSIGNMENT_REBALANCE_MAX_PER_RUN por corrida, y nunca los primeros
//      ASSIGNMENT_KEEP_TOP de su cola (lo que tiene a la vista). Solo se mueven
//      leads que su dueña NO trabajo desde que se los asignaron y que nadie
//      trabajo en los ultimos 30 minutos.
//   5. Liberacion: los leads de una dueña Desconectada hace mas de
//      ASSIGNMENT_RELEASE_OFFLINE_MS vuelven al reparto en la misma corrida,
//      salvo los que ella trabajo, que siguen siendo suyos.
//   6. Apagado: no se hace nada. Lo que haya en claimed_by queda, pero se
//      ignora.

import { buildWorkQueue, esDeSeguimiento, type QueueLead } from "./leads-queue";
import type { LeadWorkState } from "./leads-segment";
import type { PresenceStatus } from "./leads-presence";

/** Desconectada mas que esto: sus leads sin trabajar vuelven al reparto. */
export const ASSIGNMENT_RELEASE_OFFLINE_MS = 2 * 60 * 60_000;

/** Un lead trabajado por alguien en estos minutos no se mueve. */
export const ASSIGNMENT_RECENT_WORK_MINUTES = 30;

/**
 * Diferencia de carga entre activas a partir de la cual se rebalancea. Debajo
 * de esto no se mueve nada: los leads nuevos ya van a la menos cargada, y mover
 * leads de a uno cada 5 minutos solo confunde. Cuando se rebalancea, se deja
 * la diferencia en 1 como mucho.
 */
export const ASSIGNMENT_REBALANCE_MIN_GAP = 10;
/**
 * Rebalanceo GRADUAL: como mucho estos leads cambian de dueña por corrida (cada
 * 5 min). Antes se emparejaba de una vez y una asesora perdia la mitad de su
 * cola en un instante (11/11/2026: 1.474 leads de golpe).
 */
export const ASSIGNMENT_REBALANCE_MAX_PER_RUN = 40;
/** Los primeros leads de la cola de cada asesora (lo que tiene a la vista) nunca se le quitan al rebalancear. */
export const ASSIGNMENT_KEEP_TOP = 30;

/** La misma ventana que el tablero muestra por defecto (sin "Incluir antiguos"). */
export const ASSIGNMENT_WINDOW_DAYS = 30;

/** Quien puede prender o apagar el reparto: quien administra configuracion o usuarios. */
export function puedeConfigurarReparto(permisos: readonly string[]): boolean {
  return permisos.includes("config") || permisos.includes("usuarios");
}

/**
 * Puede recibir leads: tiene Leads (o Leads del equipo: en Costa Rica quien
 * más vende también supervisa) y NO administra configuracion ni usuarios, para
 * que el dueño no se quede con la mitad de la cola al abrir Leads. A una
 * persona puntual se la saca del reparto en Configuración (excluded_user_ids).
 */
export function esAsesoraRepartible(permisos: readonly string[]): boolean {
  return (
    (permisos.includes("leads") || permisos.includes("leads_equipo")) &&
    !permisos.includes("usuarios") &&
    !permisos.includes("config")
  );
}

export interface AssignableLead extends QueueLead {
  id: number;
  in_call_queue: boolean;
  work_state: LeadWorkState;
  claimed_by: number | null;
}

/**
 * Los leads que llevan dueña, en el orden en que se reparten: la cola de Hoy
 * tal cual la arma el tablero (`buildWorkQueue`) y despues Seguimiento, del mas
 * reciente al mas viejo (el orden por defecto de ese tab).
 */
export function assignableLeadsInOrder<T extends AssignableLead>(leads: T[], now: Date): T[] {
  const nowMs = now.getTime();
  const hoy = buildWorkQueue(leads, now);
  const enHoy = new Set(hoy.map((l) => l.id));
  const seguimiento = leads
    .filter((l) => !enHoy.has(l.id) && esDeSeguimiento(l, nowMs))
    .sort((a, b) => (b.last_interaction_at ?? "").localeCompare(a.last_interaction_at ?? ""));
  return [...hoy, ...seguimiento];
}

/** Leads abiertos por dueña, para los contadores del tablero y de Productividad. */
export function assignmentCounts<T extends AssignableLead>(
  leads: T[],
  now: Date
): { porUsuario: Record<number, number>; sinAsignar: number; total: number } {
  const porUsuario: Record<number, number> = {};
  let sinAsignar = 0;
  const abiertos = assignableLeadsInOrder(leads, now);
  for (const lead of abiertos) {
    if (lead.claimed_by == null) sinAsignar += 1;
    else porUsuario[lead.claimed_by] = (porUsuario[lead.claimed_by] ?? 0) + 1;
  }
  return { porUsuario, sinAsignar, total: abiertos.length };
}

export interface AssignmentAdvisor {
  userId: number;
  name: string;
  /** Asesora que puede recibir leads (ver esAsesoraRepartible). */
  repartible: boolean;
  /** El estado actual que muestra Productividad. */
  status: PresenceStatus;
  /** Ultima señal de Leads (lead_presence.last_seen_at) en ms; null = nunca. */
  lastSeenMs: number | null;
}

export interface PlanLead {
  id: number;
  claimed_by: number | null;
}

export interface AssignmentPlanInput {
  enabled: boolean;
  nowMs: number;
  /** Las personas de Leads de la tienda, con su presencia. */
  advisors: AssignmentAdvisor[];
  /** Los leads a repartir YA en orden de prioridad (assignableLeadsInOrder). */
  leads: PlanLead[];
  /** Leads con dueña que no se pueden mover: ella los trabajo, o alguien hace poco. */
  protectedIds: ReadonlySet<number>;
  /** Leads sin dueña que alguien trabajo hace poco: lead -> usuario. */
  recentWorker?: ReadonlyMap<number, number>;
}

export interface AssignmentChange {
  lead_id: number;
  from_user: number | null;
  to_user: number;
}

export type AssignmentSkip = "apagado" | "sin_asesoras_activas";

export interface AssignmentPlan {
  skipped: AssignmentSkip | null;
  changes: AssignmentChange[];
  stats: {
    /** Leads que no tenian dueña y ahora si. */
    nuevos: number;
    /** Leads de una dueña desconectada (o sin acceso) que pasaron a otra. */
    liberados: number;
    /** Leads movidos entre activas para emparejar. */
    rebalanceados: number;
    /** Leads con dueña que no se podian mover. */
    protegidos: number;
    /** Leads abiertos por dueña despues de la corrida (usuario -> cantidad). */
    cargas: Record<number, number>;
  };
}

const VACIO = (skipped: AssignmentSkip): AssignmentPlan => ({
  skipped,
  changes: [],
  stats: { nuevos: 0, liberados: 0, rebalanceados: 0, protegidos: 0, cargas: {} },
});

/**
 * Decide la corrida. No lee nada ni escribe nada: recibe la foto y devuelve
 * los cambios (de quien a quien), para que el servidor los aplique de una vez.
 */
export function planLeadAssignment(input: AssignmentPlanInput): AssignmentPlan {
  if (!input.enabled) return VACIO("apagado");

  const activas = input.advisors
    .filter((a) => a.repartible && a.status === "active")
    .sort((a, b) => a.userId - b.userId);
  if (!activas.length) return VACIO("sin_asesoras_activas");

  const personas = new Map(input.advisors.map((a) => [a.userId, a]));
  const esActiva = new Set(activas.map((a) => a.userId));
  const carga = new Map<number, number>(activas.map((a) => [a.userId, 0]));
  const sumar = (userId: number, n: number) => {
    if (carga.has(userId)) carga.set(userId, (carga.get(userId) ?? 0) + n);
  };

  /** Una dueña conserva sus leads mientras sea asesora y no lleve 2 h desconectada. */
  const conserva = (userId: number): boolean => {
    const p = personas.get(userId);
    if (!p || !p.repartible) return false;
    if (p.status !== "offline") return true;
    if (p.lastSeenMs == null) return false;
    return input.nowMs - p.lastSeenMs <= ASSIGNMENT_RELEASE_OFFLINE_MS;
  };

  const duena = new Map<number, number | null>();
  const motivo = new Map<number, "nuevo" | "liberado" | "rebalanceo">();
  const prioridad = new Map<number, number>();
  // Asignados en esta corrida a quien los estaba trabajando: no se rebalancean.
  const fijos = new Set<number>();
  const pozo: PlanLead[] = [];
  let protegidos = 0;

  input.leads.forEach((lead, i) => {
    prioridad.set(lead.id, i);
    const actual = lead.claimed_by;
    if (actual == null) {
      pozo.push(lead);
      motivo.set(lead.id, "nuevo");
      return;
    }
    const protegido = input.protectedIds.has(lead.id);
    if (protegido) protegidos += 1;
    if (protegido || conserva(actual)) {
      duena.set(lead.id, actual);
      sumar(actual, 1);
      return;
    }
    pozo.push(lead);
    motivo.set(lead.id, "liberado");
  });

  const menosCargada = (candidatas: readonly number[]): number | null => {
    let mejor: number | null = null;
    for (const id of candidatas) {
      if (mejor === null || (carga.get(id) ?? 0) < (carga.get(mejor) ?? 0)) mejor = id;
    }
    return mejor;
  };
  const ordenActivas = activas.map((a) => a.userId);

  // 1. Sin dueña -> en orden de la cola, a la menos cargada. Si alguien activa
  //    lo estaba trabajando recien, es suyo.
  for (const lead of pozo) {
    const trabajando = input.recentWorker?.get(lead.id);
    const para =
      trabajando != null && esActiva.has(trabajando) ? trabajando : (menosCargada(ordenActivas) as number);
    if (trabajando != null && trabajando === para) fijos.add(lead.id);
    duena.set(lead.id, para);
    sumar(para, 1);
  }

  // 2. Rebalanceo entre activas.
  const cargas = () => ordenActivas.map((id) => carga.get(id) ?? 0);
  if (Math.max(...cargas()) - Math.min(...cargas()) > ASSIGNMENT_REBALANCE_MIN_GAP) {
    const total = cargas().reduce((s, n) => s + n, 0);
    const base = Math.floor(total / ordenActivas.length);
    let extra = total % ordenActivas.length;
    // Las mas cargadas se quedan con el +1: asi se mueve lo minimo.
    const meta = new Map<number, number>();
    for (const id of [...ordenActivas].sort((a, b) => (carga.get(b) ?? 0) - (carga.get(a) ?? 0) || a - b)) {
      meta.set(id, base + (extra > 0 ? 1 : 0));
      if (extra > 0) extra -= 1;
    }

    // De cada cargada se toman leads repartidos a lo largo de SU cola (no los
    // primeros), para que la que recibe se lleve la misma mezcla.
    const aMover: Array<{ id: number; desde: number }> = [];
    let cupo = ASSIGNMENT_REBALANCE_MAX_PER_RUN;
    for (const id of ordenActivas) {
      const sobra = (carga.get(id) ?? 0) - (meta.get(id) ?? 0);
      if (sobra <= 0 || cupo <= 0) continue;
      // Su cola en orden; lo que tiene arriba (lo que esta mirando) se queda.
      const suyos = input.leads.filter((l) => duena.get(l.id) === id);
      const movibles = suyos
        .slice(ASSIGNMENT_KEEP_TOP)
        .filter((l) => !input.protectedIds.has(l.id) && !fijos.has(l.id));
      const k = Math.min(sobra, movibles.length, cupo);
      cupo -= k;
      for (let i = 0; i < k; i++) {
        aMover.push({ id: movibles[Math.floor(((i + 0.5) * movibles.length) / k)].id, desde: id });
      }
    }
    aMover.sort((a, b) => (prioridad.get(a.id) ?? 0) - (prioridad.get(b.id) ?? 0));
    for (const { id, desde } of aMover) {
      const para = menosCargada(ordenActivas.filter((u) => (carga.get(u) ?? 0) < (meta.get(u) ?? 0)));
      if (para === null) break;
      duena.set(id, para);
      sumar(desde, -1);
      sumar(para, 1);
      if (!motivo.has(id)) motivo.set(id, "rebalanceo");
    }
  }

  const changes: AssignmentChange[] = [];
  const stats = { nuevos: 0, liberados: 0, rebalanceados: 0, protegidos, cargas: {} as Record<number, number> };
  for (const lead of input.leads) {
    const final = duena.get(lead.id) ?? null;
    if (final != null) stats.cargas[final] = (stats.cargas[final] ?? 0) + 1;
    if (final == null || final === lead.claimed_by) continue;
    changes.push({ lead_id: lead.id, from_user: lead.claimed_by, to_user: final });
    const m = motivo.get(lead.id) ?? "rebalanceo";
    if (m === "nuevo") stats.nuevos += 1;
    else if (m === "liberado") stats.liberados += 1;
    else stats.rebalanceados += 1;
  }
  return { skipped: null, changes, stats };
}
