import { getDB } from "./db";
import { veProductividadDelEquipo } from "./permisos";
import type { Identidad } from "./auth";
import { presenceDeadlines, PRESENCE_OFFLINE_MS, type PresenceRow, type PresenceSignal, type PresenceTab } from "./leads-presence";

export function canSeePresenceTeam(yo: Identidad): boolean {
  return veProductividadDelEquipo(yo.permisos) || yo.permisos.includes("usuarios");
}

export async function recordPresence(userId: number, storeId: number, signal: PresenceSignal): Promise<void> {
  // The shared legacy administrator has no individual user row to track.
  if (userId === 0) return;
  const { error } = await getDB().rpc("record_lead_presence", {
    p_user_id: userId, p_store_id: storeId, p_tab_id: signal.tab_id,
    p_sequence: signal.sequence, p_visible: signal.visible, p_closed: signal.closed,
    p_activity_age_ms: signal.activity_age_ms,
  });
  if (error) throw new Error("No se pudo registrar la presencia en Leads.");
}

interface LeadsUser { id: number; nombre: string; staff_id: number | null }

/** Current presence (same rule as the Productividad panel) for the given users. */
async function presenceForUsers<U extends LeadsUser>(
  users: U[],
  storeId: number,
  now: number
): Promise<Array<U & PresenceRow>> {
  if (!users.length) return [];
  const db = getDB();
  const ids = users.map((u) => u.id);
  const [summary, tabs] = await Promise.all([
    db.from("lead_presence").select("user_id,last_activity_at,last_seen_at").eq("store_id", storeId).in("user_id", ids),
    db.from("lead_presence_tabs").select("user_id,last_seen_at,last_activity_at,visible,closed")
      .eq("store_id", storeId).in("user_id", ids).eq("closed", false)
      .gt("last_seen_at", new Date(now - PRESENCE_OFFLINE_MS).toISOString()),
  ]);
  if (summary.error || tabs.error) throw new Error("No se pudo consultar la presencia en Leads.");
  const byUser = new Map((summary.data ?? []).map((r) => [r.user_id, r]));
  const tabsByUser = new Map<number, PresenceTab[]>();
  for (const tab of tabs.data ?? []) {
    const list = tabsByUser.get(tab.user_id) ?? [];
    list.push(tab);
    tabsByUser.set(tab.user_id, list);
  }
  return users.map((u) => ({
    ...u,
    user_id: u.id, name: u.nombre, staff_id: u.staff_id,
    last_activity_at: byUser.get(u.id)?.last_activity_at ?? null,
    last_seen_at: byUser.get(u.id)?.last_seen_at ?? null,
    ...presenceDeadlines(tabsByUser.get(u.id) ?? [], now),
  }));
}

export async function readPresence(yo: Identidad, storeId: number, storeCode: string, now: number, period?: { fromIso: string; toIso: string }): Promise<PresenceRow[]> {
  const db = getDB();
  let usersQuery = db.from("kairo_users").select("id,nombre,staff_id")
    .eq("activo", true).contains("tiendas", [storeCode]).overlaps("permisos", ["leads", "leads_equipo"]);
  if (!canSeePresenceTeam(yo)) usersQuery = usersQuery.eq("id", yo.id);
  const { data: users, error: usersError } = await usersQuery.order("nombre");
  if (usersError) throw new Error("No se pudo consultar el equipo de Leads.");
  if (!users?.length) return [];
  const periodByUser = new Map<number, { period_last_seen_at: string; period_last_activity_at: string | null }>();
  if (period) {
    const { data, error } = await db.rpc("lead_presence_in_period", { p_store_id: storeId, p_from: period.fromIso, p_to: period.toIso });
    if (error) throw new Error("No se pudieron consultar las conexiones del período.");
    for (const row of data ?? []) periodByUser.set(row.user_id, row);
  }
  const participants = period ? users.filter((u) => periodByUser.has(u.id)) : users;
  const rows = await presenceForUsers(participants, storeId, now);
  return rows.map((row) => ({
    user_id: row.user_id, name: row.name, staff_id: row.staff_id,
    last_activity_at: row.last_activity_at, last_seen_at: row.last_seen_at,
    active_until: row.active_until, connected_until: row.connected_until,
    ...(period ? periodByUser.get(row.user_id) : {}),
  }));
}

/**
 * Everyone with Leads in the store and their current presence, with no viewer
 * restriction. Only for system processes (the automatic lead assignment cron).
 */
export async function readStoreLeadsTeamPresence(
  storeId: number,
  storeCode: string,
  now: number
): Promise<Array<PresenceRow & { permisos: string[] }>> {
  const { data: users, error } = await getDB().from("kairo_users").select("id,nombre,staff_id,permisos")
    .eq("activo", true).contains("tiendas", [storeCode]).overlaps("permisos", ["leads", "leads_equipo"])
    .order("nombre");
  if (error) throw new Error("No se pudo consultar el equipo de Leads.");
  const rows = await presenceForUsers((users ?? []) as Array<LeadsUser & { permisos: string[] | null }>, storeId, now);
  return rows.map((row) => ({
    user_id: row.user_id, name: row.name, staff_id: row.staff_id,
    last_activity_at: row.last_activity_at, last_seen_at: row.last_seen_at,
    active_until: row.active_until, connected_until: row.connected_until,
    permisos: Array.isArray(row.permisos) ? row.permisos : [],
  }));
}
