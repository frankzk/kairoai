// Reserva de leads en la base (tabla lead_holds, migración
// 20261128120000_lead_holds.sql). Reglas y textos: lib/lead-holds.ts.
//
// Toda consulta es por PK (lead_id) o por el índice (store_id, expires_at),
// que devuelve solo las reservas vigentes de la tienda (tantas como asesoras
// con un lead abierto). La base de producción es chica: nada de barridos.
//
// FALLA SUAVE: si la tabla o la función no existen (migración sin aplicar) o la
// base falla, los leads se abren y se gestionan como antes. Nunca se deja a
// todo el equipo sin poder trabajar por una reserva. Los avisos de log no
// llevan nombres ni teléfonos: solo la operación y el código de error.

import { NextResponse } from "next/server";
import { getDB } from "./db";
import { identidadActual } from "./identidad";
import type { Identidad } from "./auth";
import {
  blockingHold,
  canTakeOverHold,
  holdActive,
  LEAD_HOLD_TTL_SECONDS,
  parseLeadHold,
  writeConflictText,
  type BoardHold,
  type LeadHold,
} from "./lead-holds";

const MISSING_CODES = ["42P01", "42883", "PGRST202", "PGRST205"];
/** Tras ver que falta la migración, no se vuelve a preguntar por un rato. */
const MISSING_BACKOFF_MS = 5 * 60_000;
let missingUntil = 0;

interface DbError {
  code?: string | null;
  message?: string | null;
}

function isMissing(error: DbError | null | undefined): boolean {
  return MISSING_CODES.includes(String(error?.code ?? ""));
}

function unavailableNow(now = Date.now()): boolean {
  return now < missingUntil;
}

function failSoft(op: string, error: DbError | null | undefined): void {
  if (isMissing(error)) {
    missingUntil = Date.now() + MISSING_BACKOFF_MS;
    console.warn(`[lead-holds] ${op}: tabla/función no disponible (migración pendiente); se abre sin reserva.`);
    return;
  }
  console.warn(`[lead-holds] ${op}: error ${String(error?.code ?? "desconocido")}; se sigue sin reserva.`);
}

/** Solo para tests: olvida que faltaba la migración. */
export function resetLeadHoldsAvailabilityForTests(): void {
  missingUntil = 0;
}

export type AcquireResult =
  | { status: "held"; hold: LeadHold; server_now: string }
  | { status: "blocked"; hold: LeadHold; server_now: string; can_take_over: boolean }
  | { status: "not_found" }
  | { status: "unavailable" };

/**
 * Toma (o confirma) la reserva de quien abre el lead. `takeover` solo cuenta
 * con permiso de supervisión (leads_equipo); para el resto se ignora.
 */
export async function acquireLeadHold(opts: {
  leadId: number;
  storeId: number;
  yo: Identidad;
  takeover?: boolean;
}): Promise<AcquireResult> {
  if (unavailableNow()) return { status: "unavailable" };
  const canTakeOver = canTakeOverHold(opts.yo.permisos);
  try {
    const { data, error } = await getDB().rpc("lead_hold_acquire", {
      p_lead_id: opts.leadId,
      p_store_id: opts.storeId,
      p_user_id: opts.yo.id,
      p_user_name: (opts.yo.nombre || (opts.yo.id === 0 ? "Administrador" : "")).slice(0, 120),
      p_ttl_seconds: LEAD_HOLD_TTL_SECONDS,
      p_takeover: Boolean(opts.takeover && canTakeOver),
    });
    if (error) {
      if (/Lead not found/i.test(String(error.message ?? ""))) return { status: "not_found" };
      failSoft("acquire", error);
      return { status: "unavailable" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const hold = parseLeadHold(row);
    if (!hold) {
      failSoft("acquire", { code: "sin_fila" });
      return { status: "unavailable" };
    }
    const serverNow =
      row && typeof (row as { server_now?: unknown }).server_now === "string"
        ? String((row as { server_now: string }).server_now)
        : new Date().toISOString();
    if (hold.holder_user_id === opts.yo.id) return { status: "held", hold, server_now: serverNow };
    return { status: "blocked", hold, server_now: serverNow, can_take_over: canTakeOver };
  } catch (err) {
    failSoft("acquire", { code: err instanceof Error ? err.name : "excepcion" });
    return { status: "unavailable" };
  }
}

/** La reserva del lead (vigente o no), null si no hay, "unavailable" si no se pudo leer. */
export async function readLeadHold(leadId: number): Promise<LeadHold | null | "unavailable"> {
  if (unavailableNow()) return "unavailable";
  try {
    const { data, error } = await getDB()
      .from("lead_holds")
      .select("lead_id,holder_user_id,holder_name,acquired_at,expires_at")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (error) {
      failSoft("read", error);
      return "unavailable";
    }
    return parseLeadHold(data);
  } catch (err) {
    failSoft("read", { code: err instanceof Error ? err.name : "excepcion" });
    return "unavailable";
  }
}

/** Suelta la reserva SOLO si es de esta persona (no le quita la suya a otra). */
export async function releaseLeadHold(leadId: number, userId: number): Promise<void> {
  if (unavailableNow()) return;
  try {
    const { error } = await getDB().from("lead_holds").delete().eq("lead_id", leadId).eq("holder_user_id", userId);
    if (error) failSoft("release", error);
  } catch (err) {
    failSoft("release", { code: err instanceof Error ? err.name : "excepcion" });
  }
}

/**
 * 409 si OTRA persona tiene abierto el lead; null si se puede escribir.
 *
 * Sin persona (crons, entrada de chats, reparto automático) nunca bloquea.
 * Sin fila, vencida, propia, o la base no responde: se puede escribir.
 */
export async function leadHoldConflict(opts: {
  leadId: number | null | undefined;
  timeZone: string;
  yo?: Identidad | null;
  now?: number;
}): Promise<NextResponse | null> {
  const leadId = Number(opts.leadId);
  if (!Number.isSafeInteger(leadId) || leadId <= 0) return null;
  const yo = opts.yo === undefined ? identidadActual() : opts.yo;
  if (!yo) return null;
  const hold = await readLeadHold(leadId);
  if (hold === "unavailable") return null;
  const now = opts.now ?? Date.now();
  const blocking = blockingHold(hold, yo.id, now);
  if (!blocking) return null;
  return NextResponse.json(
    {
      error: writeConflictText(blocking, now, opts.timeZone),
      code: "lead_hold",
      hold: {
        holder_name: blocking.holder_name,
        acquired_at: blocking.acquired_at,
        expires_at: blocking.expires_at,
      },
    },
    { status: 409 }
  );
}

/**
 * Reservas vigentes de OTRAS personas en la tienda, para la etiqueta del
 * tablero. Una consulta con el índice (store_id, expires_at). Falla suave: [].
 */
export async function activeBoardHolds(storeId: number, viewerId: number | null, now = Date.now()): Promise<BoardHold[]> {
  if (unavailableNow(now)) return [];
  try {
    const { data, error } = await getDB()
      .from("lead_holds")
      .select("lead_id,holder_user_id,holder_name,acquired_at,expires_at")
      .eq("store_id", storeId)
      .gt("expires_at", new Date(now).toISOString())
      .limit(200);
    if (error) {
      failSoft("board", error);
      return [];
    }
    const out: BoardHold[] = [];
    for (const row of data ?? []) {
      const hold = parseLeadHold(row);
      if (!hold || !holdActive(hold, now) || hold.holder_user_id === viewerId) continue;
      out.push({ lead_id: hold.lead_id, holder_name: hold.holder_name, expires_at: hold.expires_at });
    }
    return out;
  } catch (err) {
    failSoft("board", { code: err instanceof Error ? err.name : "excepcion" });
    return [];
  }
}
