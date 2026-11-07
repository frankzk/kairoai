// Reparto automatico de leads: la parte que lee y escribe la base. Las reglas
// (que lead va a quien) viven en lib/leads-assignment.ts, sin base.
//
// Todo funciona aunque la migracion 20261107120000_lead_assignment.sql no este
// aplicada: el reparto queda apagado y el tablero se ve como siempre.

import { getDB } from "./db";
import { leadBoardStage, listLeads, type LeadRecord } from "./leads";
import { daysAgoIso } from "./leads-metrics";
import { presenceStatus } from "./leads-presence";
import { readStoreLeadsTeamPresence } from "./leads-presence-server";
import { isInCallQueue, leadSegment, leadWorkState } from "./leads-segment";
import {
  ASSIGNMENT_RECENT_WORK_MINUTES,
  ASSIGNMENT_WINDOW_DAYS,
  assignableLeadsInOrder,
  esAsesoraRepartible,
  planLeadAssignment,
  type AssignmentChange,
  type AssignmentPlan,
} from "./leads-assignment";

const TABLE = "lead_assignment_settings";
/** Turno de una corrida: el cron tiene maxDuration de 60 s; sobra margen. */
const LEASE_SECONDS = 240;
/** Cambios por llamada al RPC que los aplica. */
const APPLY_CHUNK = 1000;

export interface AssignmentSettings {
  store_id: number;
  /** false = falta aplicar la migracion: el reparto no se puede prender. */
  available: boolean;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string | null;
  last_run_at: string | null;
  last_run_summary: unknown;
}

/** El error de PostgREST/Postgres cuando la tabla o las funciones del reparto no existen. */
export function faltaMigracionReparto(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "")) return true;
  return /lead_assignment|does not exist|schema cache/i.test(error.message ?? "");
}

function sinMigracion(storeId: number): AssignmentSettings {
  return {
    store_id: storeId,
    available: false,
    enabled: false,
    updated_by: null,
    updated_at: null,
    last_run_at: null,
    last_run_summary: null,
  };
}

export async function readAssignmentSettings(storeId: number): Promise<AssignmentSettings> {
  const { data, error } = await getDB()
    .from(TABLE)
    .select("store_id,enabled,updated_by,updated_at,last_run_at,last_run_summary")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) {
    if (faltaMigracionReparto(error)) return sinMigracion(storeId);
    throw new Error(`readAssignmentSettings: ${error.message}`);
  }
  const row = data as Partial<AssignmentSettings> | null;
  return {
    store_id: storeId,
    available: true,
    enabled: row?.enabled === true,
    updated_by: row?.updated_by ?? null,
    updated_at: row?.updated_at ?? null,
    last_run_at: row?.last_run_at ?? null,
    last_run_summary: row?.last_run_summary ?? null,
  };
}

export async function setAssignmentEnabled(
  storeId: number,
  enabled: boolean,
  by: string
): Promise<AssignmentSettings> {
  const { error } = await getDB()
    .from(TABLE)
    .upsert(
      {
        store_id: storeId,
        enabled,
        updated_by: by.slice(0, 200) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" }
    );
  if (error) {
    if (faltaMigracionReparto(error)) return sinMigracion(storeId);
    throw new Error(`setAssignmentEnabled: ${error.message}`);
  }
  return readAssignmentSettings(storeId);
}

export interface AssignmentBoardInfo {
  enabled: boolean;
  /** Personas de Leads de la tienda, para mostrar "Asignado a ...". */
  users: Array<{ id: number; nombre: string }>;
}

/**
 * Lo que el tablero necesita saber del reparto. NUNCA rompe el tablero: ante
 * cualquier error (o sin la migracion) dice "apagado" y todo se ve como antes.
 */
export async function readAssignmentBoardInfo(storeId: number, storeCode: string): Promise<AssignmentBoardInfo> {
  try {
    const settings = await readAssignmentSettings(storeId);
    if (!settings.enabled) return { enabled: false, users: [] };
    const { data, error } = await getDB()
      .from("kairo_users")
      .select("id,nombre")
      .contains("tiendas", [storeCode])
      .overlaps("permisos", ["leads", "leads_equipo"])
      .order("nombre");
    if (error) throw new Error(error.message);
    return { enabled: true, users: (data ?? []) as Array<{ id: number; nombre: string }> };
  } catch (err) {
    console.warn(`[leads-assignment] ${storeCode}: reparto ignorado en el tablero:`, err instanceof Error ? err.message : err);
    return { enabled: false, users: [] };
  }
}

/** Las personas de la tienda que pueden recibir leads (para Configuración). */
export async function listRepartibleAdvisors(storeCode: string): Promise<string[]> {
  const { data, error } = await getDB()
    .from("kairo_users")
    .select("nombre,permisos")
    .eq("activo", true)
    .contains("tiendas", [storeCode])
    .overlaps("permisos", ["leads"])
    .order("nombre");
  if (error) throw new Error(`listRepartibleAdvisors: ${error.message}`);
  return ((data ?? []) as Array<{ nombre: string; permisos: string[] | null }>)
    .filter((u) => esAsesoraRepartible(u.permisos ?? []))
    .map((u) => u.nombre);
}

export type AssignmentRunSkip = "sin_migracion" | "apagado" | "en_curso" | "turno_perdido";

export interface AssignmentRunResult {
  store: string;
  skipped: AssignmentRunSkip | AssignmentPlan["skipped"];
  /** Leads abiertos considerados (Hoy + Seguimiento). */
  abiertos?: number;
  activas?: string[];
  planeados?: number;
  aplicados?: number;
  stats?: AssignmentPlan["stats"];
}

/** Los dos ejes del tablero, calculados igual que en GET /api/leads. */
function conEjes(lead: LeadRecord) {
  return {
    ...lead,
    board_stage: leadBoardStage(lead),
    work_state: leadWorkState(lead),
    segment: leadSegment(lead),
    in_call_queue: isInCallQueue(lead),
  };
}

interface ActivityPayload {
  protected?: unknown[];
  recent?: Array<{ lead_id?: unknown; user_id?: unknown }>;
}

/**
 * Una corrida del reparto para una tienda. Apagado, sin migracion o con otra
 * corrida en curso no hace nada. Una sola corrida a la vez por tienda (turno en
 * la base), y los cambios se aplican en lote con un RPC que vuelve a validar el
 * turno y que la dueña anterior no haya trabajado el lead mientras tanto.
 */
export async function runLeadAssignment(
  store: { id: number; code: string },
  now: Date = new Date()
): Promise<AssignmentRunResult> {
  const settings = await readAssignmentSettings(store.id);
  if (!settings.available) return { store: store.code, skipped: "sin_migracion" };
  if (!settings.enabled) return { store: store.code, skipped: "apagado" };

  const db = getDB();
  const lease = await db.rpc("lead_assignment_lease", { p_store: store.id, p_seconds: LEASE_SECONDS });
  if (lease.error) {
    if (faltaMigracionReparto(lease.error)) return { store: store.code, skipped: "sin_migracion" };
    throw new Error(`lead_assignment_lease: ${lease.error.message}`);
  }
  const token = typeof lease.data === "string" ? lease.data : null;
  if (!token) return { store: store.code, skipped: "en_curso" };

  let result: AssignmentRunResult | null = null;
  try {
    const nowMs = now.getTime();
    const [team, leads] = await Promise.all([
      readStoreLeadsTeamPresence(store.id, store.code, nowMs),
      listLeads({
        storeId: store.id,
        scope: "trabajo",
        sinceIso: daysAgoIso(now, ASSIGNMENT_WINDOW_DAYS),
        limit: 20000,
      }),
    ]);
    const ordered = assignableLeadsInOrder(leads.map(conEjes), now);
    const activity = await db.rpc("lead_assignment_activity", {
      p_store: store.id,
      p_recent_minutes: ASSIGNMENT_RECENT_WORK_MINUTES,
      p_lead_ids: ordered.filter((l) => l.claimed_by != null).map((l) => l.id),
    });
    if (activity.error) throw new Error(`lead_assignment_activity: ${activity.error.message}`);
    const payload = (activity.data ?? {}) as ActivityPayload;
    const protectedIds = new Set((payload.protected ?? []).map(Number).filter(Number.isFinite));
    const recentWorker = new Map<number, number>();
    for (const r of payload.recent ?? []) {
      const leadId = Number(r.lead_id);
      const userId = Number(r.user_id);
      if (Number.isFinite(leadId) && Number.isFinite(userId)) recentWorker.set(leadId, userId);
    }

    const advisors = team.map((p) => ({
      userId: p.user_id,
      name: p.name,
      repartible: esAsesoraRepartible(p.permisos),
      status: presenceStatus(p, nowMs),
      lastSeenMs: p.last_seen_at ? Date.parse(p.last_seen_at) : null,
    }));
    const plan = planLeadAssignment({
      enabled: true,
      nowMs,
      advisors,
      leads: ordered.map((l) => ({ id: l.id, claimed_by: l.claimed_by })),
      protectedIds,
      recentWorker,
    });

    const base: AssignmentRunResult = {
      store: store.code,
      skipped: plan.skipped,
      abiertos: ordered.length,
      activas: advisors.filter((a) => a.repartible && a.status === "active").map((a) => a.name),
      planeados: plan.changes.length,
      stats: plan.stats,
    };

    let aplicados = 0;
    for (let i = 0; i < plan.changes.length; i += APPLY_CHUNK) {
      const chunk: AssignmentChange[] = plan.changes.slice(i, i + APPLY_CHUNK);
      const { data, error } = await db.rpc("lead_assignment_apply", {
        p_store: store.id,
        p_token: token,
        p_changes: chunk,
      });
      if (error) throw new Error(`lead_assignment_apply: ${error.message}`);
      const n = Number(data ?? 0);
      // -1: el reparto se apago o el turno vencio a mitad de corrida.
      if (n < 0) {
        result = { ...base, skipped: "turno_perdido", aplicados };
        return result;
      }
      aplicados += n;
    }
    result = { ...base, aplicados };
    return result;
  } finally {
    const { error } = await db.rpc("lead_assignment_release", {
      p_store: store.id,
      p_token: token,
      p_summary: result,
    });
    if (error) console.warn(`[leads-assignment] ${store.code}: no se pudo soltar el turno: ${error.message}`);
  }
}
