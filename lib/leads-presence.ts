// Shared presence rules. A signed-in session is not evidence of work in Leads.
export const PRESENCE_HEARTBEAT_MS = 30_000;
export const PRESENCE_POLL_MS = 15_000;
export const PRESENCE_IDLE_MS = 2 * 60_000;
export const PRESENCE_OFFLINE_MS = 90_000;
export const MAX_ACTIVITY_AGE_MS = 12 * 60 * 60_000;

export type PresenceStatus = "active" | "idle" | "offline";
export interface PresenceTab {
  last_seen_at: string;
  last_activity_at: string | null;
  visible: boolean;
  closed: boolean;
}
export interface PresenceRow {
  user_id: number;
  name: string;
  staff_id: number | null;
  last_activity_at: string | null;
  last_seen_at: string | null;
  active_until: string | null;
  connected_until: string | null;
}

const millis = (iso: string | null) => iso ? Date.parse(iso) : NaN;

/** A hidden tab can remain connected, but cannot make its user active. */
export function presenceDeadlines(tabs: PresenceTab[], now: number) {
  let active = 0;
  let connected = 0;
  for (const tab of tabs) {
    const expires = millis(tab.last_seen_at) + PRESENCE_OFFLINE_MS;
    if (tab.closed || !Number.isFinite(expires) || expires <= now) continue;
    connected = Math.max(connected, expires);
    const activityExpires = millis(tab.last_activity_at) + PRESENCE_IDLE_MS;
    if (tab.visible && Number.isFinite(activityExpires)) {
      active = Math.max(active, Math.min(expires, activityExpires));
    }
  }
  return {
    active_until: active > now ? new Date(active).toISOString() : null,
    connected_until: connected > now ? new Date(connected).toISOString() : null,
  };
}

export function presenceStatus(row: Pick<PresenceRow, "active_until" | "connected_until">, now: number): PresenceStatus {
  if (millis(row.connected_until) <= now || !Number.isFinite(millis(row.connected_until))) return "offline";
  return millis(row.active_until) > now ? "active" : "idle";
}

export function activityAgo(iso: string | null, now: number): string {
  if (!Number.isFinite(millis(iso))) return "Sin actividad registrada";
  const seconds = Math.max(0, Math.floor((now - millis(iso)) / 1000));
  if (seconds < 60) return "hace menos de 1 min";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h ${minutes % 60} min`;
  return `hace ${Math.floor(hours / 24)} días`;
}

export interface PresenceSignal {
  tab_id: string;
  sequence: number;
  visible: boolean;
  closed: boolean;
  activity_age_ms: number | null;
}

export function parsePresenceSignal(body: unknown): PresenceSignal | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.tab_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.tab_id)) return null;
  if (!Number.isSafeInteger(b.sequence) || Number(b.sequence) < 1 || Number(b.sequence) > 2_147_483_647) return null;
  if (typeof b.visible !== "boolean" || typeof b.closed !== "boolean") return null;
  if (b.activity_age_ms !== null && (!Number.isSafeInteger(b.activity_age_ms) || Number(b.activity_age_ms) < 0 || Number(b.activity_age_ms) > MAX_ACTIVITY_AGE_MS)) return null;
  return { tab_id: b.tab_id, sequence: Number(b.sequence), visible: b.visible, closed: b.closed, activity_age_ms: b.activity_age_ms as number | null };
}
