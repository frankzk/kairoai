// Llamadas del navegador a /api/leads/[leadId]/hold. Reglas y textos:
// lib/lead-holds.ts.
//
// Sin sondeo: se pide la reserva al abrir, se consulta UNA vez cuando vence y
// se suelta al cerrar (o con un beacon en pagehide). Si el servidor no
// responde, el lead se abre como siempre (falla suave): una reserva no puede
// dejar a la asesora sin trabajar.

import { parseLeadHold, type LeadHold } from "./lead-holds";

const OPEN_TIMEOUT_MS = 4_000;

/** Diferencia reloj del servidor − reloj del navegador (para las cuentas atrás). */
function offsetFrom(serverNow: unknown): number {
  const t = typeof serverNow === "string" ? Date.parse(serverNow) : NaN;
  return Number.isFinite(t) ? t - Date.now() : 0;
}

export type HoldOpenResult =
  /** Abrir. `hold` null: sin reserva (falta la migración, la base o la red falló). */
  | { kind: "open"; hold: LeadHold | null; offsetMs: number }
  | { kind: "blocked"; hold: LeadHold; canTakeOver: boolean; offsetMs: number };

/**
 * Liberaciones en camino, por lead. Cerrar y volver a abrir enseguida manda
 * dos pedidos; si el de soltar llegara DESPUÉS del de tomar, borraría la
 * reserva recién confirmada. Por eso tomar espera a que termine el de soltar.
 */
const pendingReleases = new Map<number, Promise<void>>();
const RELEASE_WAIT_MS = 2_000;

function holdUrl(leadId: number): string {
  return `/api/leads/${encodeURIComponent(String(leadId))}/hold`;
}

/** Interpreta la respuesta del POST (separado para probarlo sin red). */
export function parseAcquireResponse(ok: boolean, data: unknown): HoldOpenResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const offsetMs = offsetFrom(d.server_now);
  if (!ok) return { kind: "open", hold: null, offsetMs: 0 };
  const hold = parseLeadHold(d.hold);
  if (d.status === "blocked" && hold) {
    return { kind: "blocked", hold, canTakeOver: d.can_take_over === true, offsetMs };
  }
  if (d.status === "held" && hold) return { kind: "open", hold, offsetMs };
  return { kind: "open", hold: null, offsetMs: 0 };
}

/** Pide la reserva al abrir un lead (o "Abrir de todos modos" con takeover). */
export async function requestLeadHold(leadId: number, store: string, takeover = false): Promise<HoldOpenResult> {
  const pending = pendingReleases.get(leadId);
  if (pending) await Promise.race([pending, new Promise((r) => setTimeout(r, RELEASE_WAIT_MS))]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPEN_TIMEOUT_MS);
  try {
    const res = await fetch(holdUrl(leadId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store, action: "acquire", ...(takeover ? { takeover: true } : {}) }),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return parseAcquireResponse(res.ok, data);
  } catch {
    return { kind: "open", hold: null, offsetMs: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export type HoldCheck =
  | { status: "free" | "unavailable"; hold: null; canTakeOver: boolean; offsetMs: number }
  | { status: "mine" | "other"; hold: LeadHold; canTakeOver: boolean; offsetMs: number };

export function parseCheckResponse(ok: boolean, data: unknown): HoldCheck {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const canTakeOver = d.can_take_over === true;
  const offsetMs = offsetFrom(d.server_now);
  if (!ok) return { status: "unavailable", hold: null, canTakeOver, offsetMs: 0 };
  const hold = parseLeadHold(d.hold);
  if ((d.status === "mine" || d.status === "other") && hold) {
    return { status: d.status, hold, canTakeOver, offsetMs };
  }
  return { status: d.status === "free" ? "free" : "unavailable", hold: null, canTakeOver, offsetMs };
}

/** Quién tiene el lead, sin tomarlo. Se llama una vez al vencer la reserva. */
export async function checkLeadHold(leadId: number, store: string): Promise<HoldCheck> {
  try {
    const res = await fetch(`${holdUrl(leadId)}?store=${encodeURIComponent(store)}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    return parseCheckResponse(res.ok, data);
  } catch {
    return { status: "unavailable", hold: null, canTakeOver: false, offsetMs: 0 };
  }
}

/**
 * Suelta la reserva propia. `beacon` en pagehide (la página se va: fetch
 * normal no llega). Si falla, la reserva vence sola a los 10 minutos.
 */
export function releaseLeadHold(leadId: number, store: string, beacon = false): void {
  const body = JSON.stringify({ store, action: "release" });
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon(holdUrl(leadId), new Blob([body], { type: "application/json" }))) return;
    } catch {
      // cae al fetch keepalive
    }
  }
  const p: Promise<void> = fetch(holdUrl(leadId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  })
    .then(
      () => undefined,
      () => undefined
    )
    .finally(() => {
      if (pendingReleases.get(leadId) === p) pendingReleases.delete(leadId);
    });
  pendingReleases.set(leadId, p);
}
