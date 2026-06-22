// Nucleo de sincronizacion de iComfly, compartido por la ruta manual del
// dashboard (/api/icomfly/sync) y el cron (/api/cron/icomfly). Server-only.

import {
  upsertIcomflyOrders,
  upsertIcomflyAgents,
  listPayrollStaff,
  updatePayrollStaffIcomfly,
  getDispatchedBoxfulKeys,
  type IcomflyOrderRecord,
} from "@/lib/finance";
import { listOrdersWithAttribution, listAgents, defaultStoreId } from "@/lib/icomfly";
import {
  buildIcomflyOrderRow,
  matchStaff,
  normalizePersonName,
  type StaffLike,
  type NormalizedIcomflyOrder,
  type DispatchState,
} from "@/lib/dispatch";

const DEFAULT_MAX_PAGES = 5;
const MAX_MAX_PAGES = 20;
const PAGE_LIMIT = 100;

export interface SyncResult {
  synced: number;
  pages_fetched: number;
  next_page: number | null;
  has_more: boolean;
  agents_synced: number;
  summary: DispatchSummary;
}

export interface DispatchSummary {
  total: number;
  pendiente: number;
  despacho_solicitado: number;
  despachado: number;
  standby: number;
}

export async function runIcomflySync(opts: {
  storeId?: number;
  maxPages?: number;
  startPage?: number;
  now?: Date;
} = {}): Promise<SyncResult> {
  const storeId = opts.storeId ?? defaultStoreId();
  const maxPages = Math.min(Math.max(opts.maxPages ?? DEFAULT_MAX_PAGES, 1), MAX_MAX_PAGES);
  const startPage = Math.max(opts.startPage ?? 1, 1);
  const now = opts.now ?? new Date();

  const [staff, boxfulDispatched] = await Promise.all([
    listPayrollStaff(),
    getDispatchedBoxfulKeys().catch(() => new Set<string>()),
  ]);
  const staffLikes: StaffLike[] = staff.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email ?? null,
    icomfly_user_id: s.icomfly_user_id ?? null,
  }));

  // ── Agentes (catalogo) ────────────────────────────────────────────────────
  let agentsSynced = 0;
  try {
    const agents = await listAgents({ storeId });
    if (agents.length) {
      await upsertIcomflyAgents(
        agents.map((a) => ({
          store_id: storeId,
          user_id: a.userId,
          name: a.name,
          email: a.email,
          staff_id: matchStaff({ userId: a.userId, name: a.name, email: a.email }, staffLikes),
          metrics: a.metrics,
        }))
      );
      agentsSynced = agents.length;
      await enrichStaff(
        agents.map((a) => ({ userId: a.userId, name: a.name, email: a.email })),
        staff,
        staffLikes
      );
    }
  } catch (err) {
    console.warn("[icomfly-sync] agentes no disponibles:", err instanceof Error ? err.message : err);
  }

  // ── Pedidos con atribucion ─────────────────────────────────────────────────
  const allOrders: NormalizedIcomflyOrder[] = [];
  let pagesFetched = 0;
  let hasMore = false;
  let page = startPage;
  for (let i = 0; i < maxPages; i++) {
    const res = await listOrdersWithAttribution({ storeId, page, limit: PAGE_LIMIT });
    allOrders.push(...res.orders);
    pagesFetched += 1;
    hasMore = res.hasMore;
    if (!res.hasMore) break;
    page += 1;
  }

  // Enriquecer la planilla con quien aparece atribuido en los pedidos.
  const actors = allOrders.flatMap((o) =>
    Object.values(o.attribution)
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({ userId: a.userId, name: a.name, email: a.email }))
  );
  await enrichStaff(actors, staff, staffLikes);

  const rows = allOrders
    .filter((o) => o.icomflyOrderId)
    .map((o) => buildIcomflyOrderRow(o, { staff: staffLikes, boxfulDispatched, now }));

  await upsertIcomflyOrders(rows as Array<Omit<IcomflyOrderRecord, "synced_at">>);

  return {
    synced: rows.length,
    pages_fetched: pagesFetched,
    next_page: hasMore ? page + 1 : null,
    has_more: hasMore,
    agents_synced: agentsSynced,
    summary: summarizeRows(rows),
  };
}

// Completa user_id/correo faltantes en personas de la planilla que hacen match
// por nombre con una persona vista en iComfly. Muta staff/staffLikes en sitio.
async function enrichStaff(
  actors: Array<{ userId: number | null; name: string; email: string }>,
  staff: Awaited<ReturnType<typeof listPayrollStaff>>,
  staffLikes: StaffLike[]
): Promise<void> {
  const seen = new Map<string, { userId: number | null; name: string; email: string }>();
  for (const actor of actors) {
    const key = normalizePersonName(actor.name);
    if (key && !seen.has(key)) seen.set(key, actor);
  }
  for (const [key, actor] of Array.from(seen.entries())) {
    const match = staff.find((s) => normalizePersonName(s.name) === key);
    if (!match) continue;
    const patch: { email?: string; icomfly_user_id?: number } = {};
    if (actor.userId != null && match.icomfly_user_id == null) patch.icomfly_user_id = actor.userId;
    if (actor.email && !match.email) patch.email = actor.email;
    if (!Object.keys(patch).length) continue;
    await updatePayrollStaffIcomfly(match.id, patch);
    const like = staffLikes.find((s) => s.id === match.id);
    if (patch.icomfly_user_id != null) {
      match.icomfly_user_id = patch.icomfly_user_id;
      if (like) like.icomfly_user_id = patch.icomfly_user_id;
    }
    if (patch.email != null) {
      match.email = patch.email;
      if (like) like.email = patch.email;
    }
  }
}

export function summarizeRows(
  rows: Array<{ dispatch_state: DispatchState | string; is_standby: boolean }>
): DispatchSummary {
  const s: DispatchSummary = {
    total: rows.length,
    pendiente: 0,
    despacho_solicitado: 0,
    despachado: 0,
    standby: 0,
  };
  for (const r of rows) {
    if (r.dispatch_state === "pendiente") s.pendiente += 1;
    else if (r.dispatch_state === "despacho_solicitado") s.despacho_solicitado += 1;
    else if (r.dispatch_state === "despachado") s.despachado += 1;
    if (r.is_standby) s.standby += 1;
  }
  return s;
}
