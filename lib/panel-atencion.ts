// Panel (inicio): "Para atender ahora". Lee las respuestas de las rutas que ya
// usan Novedades, Leads y Gestion, sin pedir nada nuevo:
//
//  - GET /api/incidents?store=<code>          -> novedades abiertas
//  - GET /api/leads?store=<code>              -> leads sin llamar (tablero)
//  - GET /api/finance/orders?store=<code>&status=despacho_solicitado&pageSize=1
//                                              -> pedidos pendientes de despacho
//
// Cada bloque se degrada solo: sin permiso (401/403) dice "Sin acceso"; otro
// error o una respuesta sin la forma esperada, "No disponible".
// Modulo puro; se prueba en tests/panel-atencion.test.ts.

import { TERMINAL_STATUSES, type IncidentStatus } from "./incidents-types";

export type BlockFailure = "sin_acceso" | "no_disponible";

/** Que estado muestra un bloque cuya respuesta no fue 2xx. */
export function failureFromStatus(status: number): BlockFailure {
  return status === 401 || status === 403 ? "sin_acceso" : "no_disponible";
}

export class PanelShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PanelShapeError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

// ─── Novedades ───────────────────────────────────────────────────────────────

export interface IncidentsSummary {
  /** Novedades en estado no terminal. */
  open: number;
  /** De esas, las nuevas sin gestionar ("pendiente"). */
  unattended: number;
  /** Abiertas con mas de 48 h; null si la ruta no mando las metricas. */
  over48h: number | null;
}

export function summarizeIncidents(json: unknown): IncidentsSummary {
  if (!isObject(json) || !isObject(json.counts)) throw new PanelShapeError("novedades sin conteos");
  const counts = json.counts as Record<string, unknown>;
  let fromCounts = 0;
  for (const [status, value] of Object.entries(counts)) {
    if (TERMINAL_STATUSES.includes(status as IncidentStatus)) continue;
    fromCounts += num(value) ?? 0;
  }
  const estado = isObject(json.exec) && isObject(json.exec.estado) ? json.exec.estado : null;
  const open = num(estado?.abiertas) ?? fromCounts;
  return {
    open,
    unattended: num(counts.pendiente) ?? 0,
    over48h: num(estado?.abiertas_48h),
  };
}

// ─── Leads ───────────────────────────────────────────────────────────────────

export interface LeadsSummary {
  /** Leads del tablero de trabajo que nadie llamo todavia. */
  uncalled: number;
  /** De esos, los que tienen carrito (los que mas convierten). */
  uncalledWithCart: number;
}

/**
 * Mismo criterio que el tablero (lib/leads-segment.ts): sin llamar = ninguna
 * gestion manual (status_source distinto de "manual"). La ruta ya manda
 * work_state; si faltara, se deduce de status_source.
 */
export function summarizeLeads(json: unknown): LeadsSummary {
  if (!isObject(json) || !Array.isArray(json.leads)) throw new PanelShapeError("leads sin lista");
  let uncalled = 0;
  let uncalledWithCart = 0;
  for (const lead of json.leads as unknown[]) {
    if (!isObject(lead)) continue;
    const state =
      lead.work_state === "sin_llamar" || lead.work_state === "seguimiento"
        ? lead.work_state
        : lead.status_source === "manual"
          ? "seguimiento"
          : "sin_llamar";
    if (state !== "sin_llamar") continue;
    uncalled += 1;
    if (lead.segment === "carrito") uncalledWithCart += 1;
  }
  return { uncalled, uncalledWithCart };
}

// ─── Despacho ────────────────────────────────────────────────────────────────

export interface DispatchSummary {
  /** Pedidos en "Despacho solicitado" (todavia no salen con la transportadora). */
  pending: number;
  toRequest: number;
  waitingGuide: number;
  waitingPickup: number;
}

/** dispatchCounts de /api/finance/orders?status=despacho_solicitado. */
export function summarizeDispatch(json: unknown): DispatchSummary {
  if (!isObject(json)) throw new PanelShapeError("pedidos sin respuesta");
  const counts = isObject(json.dispatchCounts) ? json.dispatchCounts : null;
  if (counts) {
    return {
      pending: num(counts.all) ?? 0,
      toRequest: num(counts.por_solicitar) ?? 0,
      waitingGuide: num(counts.esperando_guia) ?? 0,
      waitingPickup: num(counts.esperando_recoleccion) ?? 0,
    };
  }
  const tracking = isObject(json.trackingCounts) ? num(json.trackingCounts.despacho_solicitado) : null;
  if (tracking == null) throw new PanelShapeError("pedidos sin conteo de despacho");
  return { pending: tracking, toRequest: 0, waitingGuide: 0, waitingPickup: 0 };
}

/** Lista "3 por solicitar · 2 esperando guía" sin las partes en cero. */
export function joinParts(parts: Array<[number, string]>): string {
  return parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${new Intl.NumberFormat("es-CR").format(n)} ${label}`)
    .join(" · ");
}
