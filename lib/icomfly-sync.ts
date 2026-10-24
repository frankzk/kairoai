// Nucleo de sincronizacion de iComfly, compartido por la ruta manual del
// dashboard (/api/icomfly/sync) y el cron (/api/cron/icomfly). Server-only.

import {
  upsertIcomflyOrderPayloads,
  upsertIcomflyOrders,
  upsertIcomflyAgents,
  listPayrollStaff,
  updatePayrollStaffIcomfly,
  getDispatchedBoxfulKeys,
  type IcomflyOrderRecord,
} from "@/lib/finance";
import { listOrdersWithAttribution, listAgents, resolveIcomflyStoreContext } from "@/lib/icomfly";
import {
  buildIcomflyOrderRow,
  matchStaff,
  normalizePersonName,
  type StaffLike,
  type NormalizedIcomflyOrder,
  type DispatchState,
} from "@/lib/dispatch";
import type { FinanceStoreCode } from "@/lib/store-config";
import { deLaTienda, filasDePayload, type IcomflyPayloadRow } from "@/lib/icomfly-payloads";

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
  /** Pedidos descartados porque iComfly los mando de otra tienda. */
  otra_tienda: number;
  tiendas_ajenas: string[];
}

export interface DispatchSummary {
  total: number;
  pendiente: number;
  despacho_solicitado: number;
  despachado: number;
  standby: number;
}

export async function runIcomflySync(opts: {
  store?: FinanceStoreCode | string;
  storeId?: number;
  externalStoreId?: number;
  maxPages?: number;
  startPage?: number;
  now?: Date;
} = {}): Promise<SyncResult> {
  const { store, externalStoreId } = resolveIcomflyStoreContext({
    store: opts.store,
    storeId: opts.storeId,
    externalStoreId: opts.externalStoreId,
  });
  const storeId = store.id;
  const maxPages = Math.min(Math.max(opts.maxPages ?? DEFAULT_MAX_PAGES, 1), MAX_MAX_PAGES);
  const startPage = Math.max(opts.startPage ?? 1, 1);
  const now = opts.now ?? new Date();

  const [staff, boxfulDispatched] = await Promise.all([
    listPayrollStaff(),
    getDispatchedBoxfulKeys(storeId).catch(() => new Set<string>()),
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
    const agents = await listAgents({ storeId, externalStoreId });
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
  // Un mismo pedido puede salir en dos paginas (la lista se corre si entra uno
  // nuevo mientras se pagina) y Postgres rechaza un upsert que toca la misma
  // llave dos veces: queda la ultima version vista, con su pedido completo.
  const vistos = new Map<string, { order: NormalizedIcomflyOrder; raw: unknown }>();
  let pagesFetched = 0;
  let hasMore = false;
  let page = startPage;
  let otraTienda = 0;
  const tiendasAjenas = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    const res = await listOrdersWithAttribution({ storeId, externalStoreId, page, limit: PAGE_LIMIT });
    const propia = deLaTienda(externalStoreId, res.orders, res.raw);
    otraTienda += propia.ajenos;
    propia.tiendasAjenas.forEach((t) => tiendasAjenas.add(t));
    propia.orders.forEach((order, j) => {
      if (order.icomflyOrderId) vistos.set(order.icomflyOrderId, { order, raw: propia.raw[j] });
    });
    pagesFetched += 1;
    hasMore = res.hasMore;
    if (!res.hasMore) break;
    // Una pagina entera de otra tienda: las siguientes tambien lo seran.
    if (propia.ajenos > 0 && !propia.orders.length) break;
    page += 1;
  }
  const allOrders = Array.from(vistos.values(), (v) => v.order);
  const payloads: IcomflyPayloadRow[] = filasDePayload(
    storeId,
    allOrders,
    Array.from(vistos.values(), (v) => v.raw)
  );

  // Enriquecer la planilla con quien aparece atribuido en los pedidos.
  const actors = allOrders.flatMap((o) =>
    Object.values(o.attribution)
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({ userId: a.userId, name: a.name, email: a.email }))
  );
  await enrichStaff(actors, staff, staffLikes);

  const rows = allOrders.map((o) => buildIcomflyOrderRow(o, { staff: staffLikes, boxfulDispatched, now }));

  await upsertIcomflyOrders(rows as Array<Omit<IcomflyOrderRecord, "synced_at">>);

  // Despues del despacho y best-effort: si la tabla nueva falla, el sync de
  // siempre no se entera.
  await upsertIcomflyOrderPayloads(payloads).catch((err) =>
    console.warn("[icomfly-sync] pedido completo no guardado:", err instanceof Error ? err.message : err)
  );

  return {
    synced: rows.length,
    pages_fetched: pagesFetched,
    next_page: hasMore ? page + 1 : null,
    has_more: hasMore,
    agents_synced: agentsSynced,
    summary: summarizeRows(rows),
    otra_tienda: otraTienda,
    tiendas_ajenas: Array.from(tiendasAjenas),
  };
}

// Pedidos de otra tienda no son un detalle del sync: es configuracion (el
// numero de tienda de iComfly o el acceso de su usuario) y tiene que verse
// en el monitor de crons aunque la corrida responda 200.
export function errorDeTienda(resultados: Array<{ store: string; result: SyncResult }>): string | null {
  const problemas = resultados
    .filter(({ result }) => result.otra_tienda > 0)
    .map(
      ({ store, result }) =>
        `${store}: iComfly devolvió ${result.otra_tienda} pedidos de la tienda ${result.tiendas_ajenas.join(", ")} y se descartaron`
    );
  if (!problemas.length) return null;
  return `${problemas.join("; ")}. Revisa el número de tienda de iComfly configurado y que su usuario tenga acceso a esa tienda.`;
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
