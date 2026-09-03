import { getDB } from "@/lib/db";
import { DEFAULT_FINANCE_STORE_ID } from "@/lib/store-config";
import { applyDetection, buildIncidentKey } from "@/lib/incidents-detect";
import { buildTrend } from "@/lib/incidents-trend";

export * from "./incidents-types";
import type {
  DetectedIncident,
  Incident,
  IncidentCategory,
  IncidentEvent,
  IncidentEventKind,
  IncidentSource,
  IncidentStatus,
  IncidentTimeStats,
  IncidentWindowStats,
  IncidentExecutiveStats,
  IncidentCausaStat,
  IncidentTrendPoint,
  IncidentPeriodTotal,
  IncidentMatrixCell,
  IncidentMatrixKey,
  IncidentEstadoActual,
} from "./incidents-types";

export interface IncidentFilters {
  storeId?: number; // tienda (stores.id); se aplica siempre que venga
  status?: IncidentStatus;
  category?: IncidentCategory;
  source?: IncidentSource;
  search?: string;
  soloReintento?: boolean; // cola de "fin del dia" (status = sin_contestar)
}

export interface IncidentEventInput {
  kind: IncidentEventKind;
  from_status?: string;
  to_status?: string;
  message?: string;
  result?: "ok" | "error" | "info";
  metadata?: Record<string, unknown>;
}

function escapeOr(value: string): string {
  // PostgREST: comas y parentesis rompen el filtro .or(); se quitan del termino.
  return value.replace(/[,()]/g, " ").trim();
}

// Tope duro de filas que trae la bandeja. PostgREST/Supabase corta cada
// respuesta a `max-rows` (1000 por defecto), asi que un `.limit(2000)` a secas
// devolvia SOLO 1000 filas: la bandeja mostraba las 1000 novedades mas recientes
// y el buscador (que filtra en el cliente) no encontraba nada mas viejo. Se
// pagina con .range() igual que listLogisticsRows/listSettlementRows para pasar
// ese tope. 20000 cubre el historico completo por tienda con margen.
const INCIDENTS_PAGE_SIZE = 1000;
const INCIDENTS_MAX_ROWS = 20000;

export async function listIncidents(filters: IncidentFilters = {}): Promise<Incident[]> {
  const q = escapeOr(filters.search ?? "");
  const buildQuery = (from: number) => {
    let query = getDB()
      .from("incidents")
      .select("*")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + INCIDENTS_PAGE_SIZE - 1);
    if (filters.storeId) query = query.eq("store_id", filters.storeId);
    if (filters.soloReintento) query = query.eq("status", "sin_contestar");
    else if (filters.status) query = query.eq("status", filters.status);
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.source) query = query.eq("source", filters.source);
    if (q) {
      query = query.or(
        `order_name.ilike.%${q}%,guide_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`
      );
    }
    return query;
  };

  const all: Incident[] = [];
  for (let from = 0; from < INCIDENTS_MAX_ROWS; from += INCIDENTS_PAGE_SIZE) {
    const { data, error } = await buildQuery(from);
    if (error) throw new Error(`listIncidents: ${error.message}`);
    const page = (data ?? []) as Incident[];
    all.push(...page);
    if (page.length < INCIDENTS_PAGE_SIZE) break;
  }
  return all;
}

// Conteo de novedades por estado para TODA la tienda, SIN los filtros de la
// bandeja. Alimenta los chips-resumen, que deben reflejar el panorama global y
// no la lista filtrada que se muestra en la tabla. Usa count exacto por estado
// (head: true, sin traer filas).
export async function countIncidentsByStatus(storeId: number): Promise<Record<string, number>> {
  const statuses: IncidentStatus[] = [
    "pendiente", "reprogramada", "reprog_fallida", "sin_contestar", "no_llamar", "resuelta", "perdida", "descartada",
  ];
  const pairs = await Promise.all(
    statuses.map(async (s) => {
      const { count, error } = await getDB()
        .from("incidents")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("status", s);
      if (error) throw new Error(`countIncidentsByStatus(${s}): ${error.message}`);
      return [s, count ?? 0] as const;
    })
  );
  return Object.fromEntries(pairs);
}

// Conteo de novedades por causa para TODA la tienda (sin los filtros de la
// bandeja), en paralelo a countIncidentsByStatus. Alimenta el conteo de las
// pildoras de causa.
export async function countIncidentsByCategory(storeId: number): Promise<Record<string, number>> {
  const categories: IncidentCategory[] = [
    "fallo_entrega", "direccion_incorrecta", "cliente_no_responde", "cliente_rechaza",
    "devuelto_origen", "dano_paquete", "otro",
  ];
  const pairs = await Promise.all(
    categories.map(async (c) => {
      const { count, error } = await getDB()
        .from("incidents")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId)
        .eq("category", c);
      if (error) throw new Error(`countIncidentsByCategory(${c}): ${error.message}`);
      return [c, count ?? 0] as const;
    })
  );
  return Object.fromEntries(pairs);
}

// Estadistica temporal de flujo (hoy / ayer / ultimos 7 / ultimos 30 dias) para la
// tienda. "resueltas" cuenta novedades DISTINTAS con una transicion a 'resuelta'
// (manual o auto por entrega) en la ventana, leyendo el historial (incident_events).
// "nuevas" usa la fecha de alta (incidents.created_at). Los limites de dia se calculan
// en hora local de Centroamerica (UTC-6, sin horario de verano en CR/HN), porque el
// runtime corre en UTC y "hoy" debe cuadrar con el dia del operador.
export async function incidentTimeStats(storeId: number): Promise<IncidentTimeStats> {
  const DAY = 86_400_000;
  const TZ_OFFSET = 6 * 60 * 60 * 1000; // UTC-6 (Costa Rica / Honduras)
  const nowMs = Date.now();
  const startToday = Math.floor((nowMs - TZ_OFFSET) / DAY) * DAY + TZ_OFFSET;
  const startYesterday = startToday - DAY;
  const start7 = startToday - 6 * DAY;
  const start30 = startToday - 29 * DAY;
  const sinceIso = new Date(start30).toISOString();

  // Paginado, no `.limit(5000)`: PostgREST corta en 1.000 en silencio (ver
  // fetchAll). Con `.limit()` a secas los chips de la cabecera contaban de
  // menos igual que la tendencia.
  const db = getDB();
  const [nuevasRes, resueltasRes] = await Promise.all([
    fetchAll((from, to) =>
      db.from("incidents").select("id, created_at")
        .eq("store_id", storeId).gte("created_at", sinceIso).order("id").range(from, to)
    ),
    fetchAll((from, to) =>
      // Excluye eventos de llamada: sellan to_status con el estado ACTUAL (no una
      // entrega), y contarian doble al registrar "contesto" sobre una ya resuelta.
      db.from("incident_events").select("incident_id, created_at, incidents!inner(store_id)")
        .eq("incidents.store_id", storeId).eq("to_status", "resuelta").neq("kind", "llamada").gte("created_at", sinceIso)
        .order("id").range(from, to)
    ),
  ]);
  if (nuevasRes.error) throw new Error(`incidentTimeStats(nuevas): ${nuevasRes.error.message}`);
  if (resueltasRes.error) throw new Error(`incidentTimeStats(resueltas): ${resueltasRes.error.message}`);

  const nuevasRows = (nuevasRes.data ?? []) as Array<{ id: number; created_at: string }>;
  const resueltaRows = (resueltasRes.data ?? []) as Array<{ incident_id: number; created_at: string }>;

  const END = nowMs + DAY; // cota superior holgada (no hay eventos en el futuro)
  const distinct = (rows: Array<{ id: number; at: number }>, from: number, to: number): number => {
    const seen = new Set<number>();
    for (const r of rows) if (r.at >= from && r.at < to) seen.add(r.id);
    return seen.size;
  };
  const windows = (rows: Array<{ id: number; at: number }>): IncidentWindowStats => ({
    hoy: distinct(rows, startToday, END),
    ayer: distinct(rows, startYesterday, startToday),
    d7: distinct(rows, start7, END),
    d30: distinct(rows, start30, END),
  });

  return {
    nuevas: windows(nuevasRows.map((r) => ({ id: r.id, at: Date.parse(r.created_at) }))),
    resueltas: windows(resueltaRows.map((r) => ({ id: r.incident_id, at: Date.parse(r.created_at) }))),
  };
}

// Capa de metricas ejecutivas: TODOS los periodos a la vez (sin selector). Calcula
// en hora local de Centroamerica (UTC-6, CR/HN). Lee 4 consultas acotadas a 30 dias:
// incidencias creadas (matriz + causas + tendencia), eventos de resolucion (flujo,
// monto, tendencia), abiertas (snapshot: edad / >48h / mas antigua) y llamadas
// (primera gestion 30d). El embed incidents!inner filtra eventos por tienda y trae
// el cod / fecha de alta de la incidencia padre.
/**
 * Trae TODAS las filas de una consulta, de a paginas.
 *
 * POR QUE: PostgREST corta la respuesta en 1.000 filas por mas que se pida
 * `.limit(8000)`, y lo hace EN SILENCIO. Este modulo pedia 8.000 de una y
 * recibia 1.000 — sin ORDER BY, las mas VIEJAS — asi que todo el tablero de
 * Novedades venia contando de menos la actividad reciente.
 *
 * Medido cuando se encontro: la tabla mostraba 64 nuevas en 7 dias y 342 en 30
 * cuando en la base habia 272 y 905. Simular el corte de 1.000 reproducia 66 y
 * 379, casi exacto.
 *
 * El `.order("id")` no es decorativo: sin un orden estable dos paginas pueden
 * traer la misma fila o saltarse otra.
 *
 * lib/leads.ts ya paginaba de a 1.000 por este mismo motivo (fetchLeadPages);
 * Novedades nunca lo hizo.
 */
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

async function fetchAll<T>(
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: all, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return { data: all, error: null };
}

export async function incidentExecutiveStats(storeId: number): Promise<IncidentExecutiveStats> {
  const DAY = 86_400_000;
  const TZ_OFFSET = 6 * 60 * 60 * 1000; // UTC-6 (Costa Rica / Honduras)
  const nowMs = Date.now();
  const startToday = Math.floor((nowMs - TZ_OFFSET) / DAY) * DAY + TZ_OFFSET;
  const END = nowMs + DAY;
  const since30 = new Date(startToday - 29 * DAY).toISOString();
  // Limites de mes en hora local CR/HN, para "Mes actual" / "Mes pasado".
  const localNow = new Date(nowMs - TZ_OFFSET);
  const startOfMonth = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 1) + TZ_OFFSET;
  const startOfPrevMonth = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() - 1, 1) + TZ_OFFSET;
  // Piso de fetch para creadas/resueltas: cubre 30d y el mes pasado completo.
  const sinceIso = new Date(Math.min(startToday - 29 * DAY, startOfPrevMonth)).toISOString();

  const db = getDB();
  const [createdRes, resolvedRes, openRes, callRes, reprogRes, dispatchedRes] = await Promise.all([
    fetchAll((from, to) =>
      db.from("incidents").select("id, created_at, status, category, cod_amount")
        .eq("store_id", storeId).gte("created_at", sinceIso).order("id").range(from, to)
    ),
    fetchAll((from, to) =>
      // Solo transiciones reales a 'resuelta' (estado_cambiado manual o auto por
      // entrega). Se excluyen las llamadas: su to_status es el estado actual, no
      // una entrega, y duplicaban ENTREGAS al poner "contesto" en una ya resuelta.
      db.from("incident_events").select("incident_id, created_at, incidents!inner(store_id, cod_amount)")
        .eq("incidents.store_id", storeId).eq("to_status", "resuelta").neq("kind", "llamada").gte("created_at", sinceIso)
        .order("id").range(from, to)
    ),
    fetchAll((from, to) =>
      db.from("incidents").select("order_name, guide_number, created_at")
        .eq("store_id", storeId).not("status", "in", "(resuelta,perdida,descartada)")
        .order("id").range(from, to)
    ),
    fetchAll((from, to) =>
      db.from("incident_events").select("incident_id, created_at, incidents!inner(store_id, created_at)")
        .eq("incidents.store_id", storeId).eq("kind", "llamada").gte("created_at", sinceIso)
        .order("id").range(from, to)
    ),
    fetchAll((from, to) =>
      // Igual que resueltas: una llamada "contesto" sobre una novedad ya
      // reprogramada NO es una reprogramacion nueva; se excluye para no inflar REPROG.
      db.from("incident_events").select("incident_id, created_at, incidents!inner(store_id)")
        .eq("incidents.store_id", storeId).eq("to_status", "reprogramada").neq("kind", "llamada").gte("created_at", sinceIso)
        .order("id").range(from, to)
    ),
    // Pedidos despachados (con guia) por fecha de pedido, para la tasa Inc./Despachados.
    fetchAll((from, to) =>
      db.from("shopify_orders").select("shopify_created_at")
        .eq("store_id", storeId).neq("tracking_number", "").gte("shopify_created_at", since30)
        .order("id").range(from, to)
    ),
  ]);
  for (const r of [createdRes, resolvedRes, openRes, callRes]) {
    if (r.error) throw new Error(`incidentExecutiveStats: ${r.error.message}`);
  }
  // Despachados es auxiliar: si la consulta falla (p.ej. falta la columna tracking),
  // el resto del resumen sigue y la tasa Inc./Despachados sale "—".
  const dispatchedAt: number[] = dispatchedRes.error
    ? []
    : ((dispatchedRes.data ?? []) as Array<{ shopify_created_at: string }>)
        .map((r) => Date.parse(r.shopify_created_at))
        .filter((n) => !Number.isNaN(n));

  // El embed a-uno puede venir como objeto o como array de 1 segun la version.
  type Embedded<T> = T | T[] | null;
  const one = <T,>(e: Embedded<T>): T | null => (Array.isArray(e) ? e[0] ?? null : e);
  type CreatedRow = { id: number; created_at: string; status: string; category: IncidentCategory; cod_amount: number };
  type ResolvedRow = { incident_id: number; created_at: string; incidents: Embedded<{ cod_amount: number }> };
  type OpenRow = { order_name: string; guide_number: string; created_at: string };
  type CallRow = { incident_id: number; created_at: string; incidents: Embedded<{ created_at: string }> };
  const created = (createdRes.data ?? []) as unknown as CreatedRow[];
  const resolved = (resolvedRes.data ?? []) as unknown as ResolvedRow[];
  const open = (openRes.data ?? []) as unknown as OpenRow[];
  const calls = (callRes.data ?? []) as unknown as CallRow[];
  // Reprogramaciones (eventos to_status='reprogramada'); tolerante a fallo.
  const reprog = reprogRes.error
    ? []
    : ((reprogRes.data ?? []) as unknown as Array<{ incident_id: number; created_at: string }>);

  // ----- Matriz de desempeño: una celda por periodo (nuevas, resueltas, tasa, monto).
  const ranges: Record<IncidentMatrixKey, { from: number; to: number }> = {
    hoy: { from: startToday, to: END },
    ayer: { from: startToday - DAY, to: startToday },
    d7: { from: startToday - 6 * DAY, to: END },
    d30: { from: startToday - 29 * DAY, to: END },
  };
  const cell = (from: number, to: number): IncidentMatrixCell => {
    const cohorte = created.filter((r) => { const t = Date.parse(r.created_at); return t >= from && t < to; });
    const nuevas = cohorte.length;
    const resCohorte = cohorte.filter((r) => r.status === "resuelta").length;
    const ids = new Set<number>();
    let monto = 0;
    for (const r of resolved) {
      const t = Date.parse(r.created_at);
      if (t < from || t >= to || ids.has(r.incident_id)) continue;
      ids.add(r.incident_id);
      monto += Number(one(r.incidents)?.cod_amount ?? 0);
    }
    const despachados = dispatchedAt.filter((t) => t >= from && t < to).length;
    return { nuevas, resueltas: ids.size, tasa: nuevas ? (resCohorte / nuevas) * 100 : 0, monto, despachados };
  };
  const matriz: Record<IncidentMatrixKey, IncidentMatrixCell> = {
    hoy: cell(ranges.hoy.from, ranges.hoy.to),
    ayer: cell(ranges.ayer.from, ranges.ayer.to),
    d7: cell(ranges.d7.from, ranges.d7.to),
    d30: cell(ranges.d30.from, ranges.d30.to),
  };

  // ----- Estado actual (snapshot): abiertas, >48h, edad media, mas antigua.
  const H48 = 48 * 3_600_000;
  let edadSum = 0;
  let abiertas48 = 0;
  let oldest: OpenRow | null = null;
  for (const o of open) {
    const t = Date.parse(o.created_at);
    const age = nowMs - t;
    edadSum += age;
    if (age > H48) abiertas48 += 1;
    if (!oldest || t < Date.parse(oldest.created_at)) oldest = o;
  }
  // Primera gestion: creacion -> primer llamado, por incidencia.
  const firstCall = new Map<number, number>();
  const createdAtOf = new Map<number, number>();
  for (const c of calls) {
    const t = Date.parse(c.created_at);
    const prev = firstCall.get(c.incident_id);
    if (prev === undefined || t < prev) firstCall.set(c.incident_id, t);
    const inc = one(c.incidents);
    if (inc?.created_at) createdAtOf.set(c.incident_id, Date.parse(inc.created_at));
  }
  const firstMgmt: Array<{ createdMs: number; diffMs: number }> = [];
  for (const [id, callMs] of Array.from(firstCall.entries())) {
    const createdMs = createdAtOf.get(id);
    if (createdMs === undefined) continue;
    const diff = callMs - createdMs;
    if (diff >= 0) firstMgmt.push({ createdMs, diffMs: diff });
  }
  // Promedio de 1a gestion (horas) para incidencias creadas en [from,to); null si ninguna.
  const avgPrimeraGestion = (from: number, to: number): number | null => {
    let sum = 0;
    let n = 0;
    for (const m of firstMgmt) { if (m.createdMs >= from && m.createdMs < to) { sum += m.diffMs; n += 1; } }
    return n ? sum / n / 3_600_000 : null;
  };
  const estado: IncidentEstadoActual = {
    abiertas: open.length,
    abiertas_48h: abiertas48,
    edad_promedio_dias: open.length ? edadSum / open.length / DAY : 0,
    mas_antigua: oldest
      ? { dias: Math.floor((nowMs - Date.parse(oldest.created_at)) / DAY), order_name: oldest.order_name, guide_number: oldest.guide_number }
      : null,
    primera_gestion_horas: avgPrimeraGestion(startToday - 29 * DAY, END),
  };

  // ----- Causas (ultimos 30d) + recuperacion por motivo. created puede traer mas
  // de 30d (para los totales de mes), asi que se acota aqui a la ventana de 30d.
  const start30 = startToday - 29 * DAY;
  const created30 = created.filter((r) => Date.parse(r.created_at) >= start30);
  const causasMap = new Map<IncidentCategory, { total: number; resueltas: number }>();
  for (const r of created30) {
    const e = causasMap.get(r.category) ?? { total: 0, resueltas: 0 };
    e.total += 1;
    if (r.status === "resuelta") e.resueltas += 1;
    causasMap.set(r.category, e);
  }
  const total30 = created30.length;
  const causas: IncidentCausaStat[] = Array.from(causasMap.entries())
    .map(([category, v]) => ({
      category,
      total: v.total,
      resueltas: v.resueltas,
      pct: total30 ? (v.total / total30) * 100 : 0,
      recuperacion: v.total ? (v.resueltas / v.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ----- Tendencia diaria (generadas / resueltas / reprogramadas / 1a gestion) + totales.
  // Cohorte: de las creadas ESE dia, cuantas ya estan resueltas hoy. Es la
  // unica cifra que se puede dividir por `generadas` para sacar un porcentaje,
  // porque mide la misma poblacion. `resByDay` de abajo cuenta EVENTOS de
  // resolucion ocurridos ese dia sobre incidencias de cualquier fecha: dividir
  // eso por las nuevas del dia daba cosas como 775%.
  // La serie la arma el modulo puro, que esta probado aparte
  // (tests/incidents-trend.test.ts). Aca solo se le pasan las filas ya leidas.
  const serie = buildTrend({
    created,
    resolved,
    reprogramadas: reprog,
    firstMgmt,
    nowMs,
    days: 30,
  });
  const trend: IncidentTrendPoint[] = serie;
  let genTot = 0;
  let resTot = 0;
  for (const d of serie) {
    genTot += d.generadas;
    resTot += d.resueltas;
  }

  // Totales por periodo: nuevas (creadas), resueltas y reprogramadas (por evento)
  // y promedio de 1a gestion.
  const countIn = (rows: Array<{ created_at: string }>, from: number, to: number): number => {
    let n = 0;
    for (const r of rows) { const t = Date.parse(r.created_at); if (t >= from && t < to) n += 1; }
    return n;
  };
  const periodTotal = (from: number, to: number): IncidentPeriodTotal => ({
    nuevas: countIn(created, from, to),
    resueltas: countIn(resolved, from, to),
    reprogramadas: countIn(reprog, from, to),
    primera_gestion_horas: avgPrimeraGestion(from, to),
    // Misma cohorte que `nuevas`, no eventos del periodo (ver arriba).
    resueltas_de_las_nuevas: countIn(
      created.filter((r) => r.status === "resuelta"),
      from,
      to
    ),
  });

  return {
    matriz,
    estado,
    trend,
    trend_totales: { generadas: genTot, resueltas: resTot, balance: resTot - genTot },
    totales: {
      d7: periodTotal(startToday - 6 * DAY, END),
      d30: periodTotal(startToday - 29 * DAY, END),
      mesActual: periodTotal(startOfMonth, END),
      mesPasado: periodTotal(startOfPrevMonth, startOfMonth),
    },
    causas,
  };
}

// Conjunto de claves existentes, para que la deteccion automatica descarte
// entregas ya confirmadas sin consultar fila por fila.
/**
 * Todas las novedades de la tienda, indexadas por su clave de envio.
 *
 * REEMPLAZA A `listIncidentKeys`, que tenia DOS problemas:
 *
 * 1. Pedia `.limit(10000)` pero PostgREST corta las respuestas en 1.000 filas
 *    sin avisar. Con 2.302 novedades en Costa Rica, el conjunto de claves veia
 *    el 43%. La deteccion usa esas claves para decidir si un envio ya entregado
 *    o devuelto corresponde a una novedad abierta que hay que CERRAR; una clave
 *    que no estaba en la lista truncada se descartaba con `continue`, asi que la
 *    novedad se quedaba abierta para siempre. Medido: 26 novedades cuyo paquete
 *    el courier ya entrego y 42 ya devueltos seguian figurando como trabajo
 *    pendiente (68 de 197 abiertas, el 35%).
 *
 * 2. Traia solo la clave, asi que el upsert tenia que ir a buscar la fila
 *    entera de a una — un viaje por candidata.
 *
 * Devolviendo la fila completa se resuelven las dos cosas con una sola lectura
 * paginada.
 */
export async function listIncidentsByKey(storeId: number): Promise<Map<string, Incident>> {
  const pageSize = 1000;
  const byKey = new Map<string, Incident>();
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await getDB()
      .from("incidents")
      .select("*")
      .eq("store_id", storeId)
      // Orden estable: sin el, dos paginas pueden repetir u omitir filas.
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`listIncidentsByKey: ${error.message}`);
    const page = (data ?? []) as Incident[];
    for (const row of page) if (row.incident_key) byKey.set(row.incident_key, row);
    if (page.length < pageSize) break;
  }
  return byKey;
}

// Novedades de Moovin/Forza con nombre o telefono vacio (y que no son gestion
// manual), para que el cron las re-enriquezca desde el pedido de Shopify
// matcheado por guia.
export async function listIncidentsMissingContact(storeId: number): Promise<Incident[]> {
  const { data, error } = await getDB()
    .from("incidents")
    .select("*")
    .eq("store_id", storeId)
    .eq("manual_override", false)
    .neq("guide_number", "")
    .or("customer_name.is.null,customer_name.eq.,customer_phone.is.null,customer_phone.eq.")
    .limit(2000);
  if (error) throw new Error(`listIncidentsMissingContact: ${error.message}`);
  return (data ?? []) as Incident[];
}

// Rellena nombre/telefono vacios SIN marcar manual_override (lo hace el cron de
// deteccion, no el operador): asi la novedad sigue abierta a futuras
// actualizaciones automaticas.
export async function backfillIncidentContact(
  id: number,
  patch: { customer_name?: string; customer_phone?: string }
): Promise<void> {
  if (!patch.customer_name && !patch.customer_phone) return;
  const { error } = await getDB()
    .from("incidents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`backfillIncidentContact: ${error.message}`);
}

// Watermark incremental por fuente de tracking ("moovin" global; "forza:<id>"
// por tienda): el cron procesa solo el tracking con checked_at posterior al
// guardado, en vez de reescanear todo el historico en cada corrida.
export async function getIncidentWatermark(sourceKey: string): Promise<string | null> {
  const { data, error } = await getDB()
    .from("incident_sync_state")
    .select("watermark")
    .eq("source_key", sourceKey)
    .maybeSingle();
  if (error) throw new Error(`getIncidentWatermark: ${error.message}`);
  return (data?.watermark as string | null) ?? null;
}

export async function setIncidentWatermark(sourceKey: string, watermark: string): Promise<void> {
  const { error } = await getDB()
    .from("incident_sync_state")
    .upsert(
      { source_key: sourceKey, watermark, updated_at: new Date().toISOString() },
      { onConflict: "source_key" }
    );
  if (error) throw new Error(`setIncidentWatermark: ${error.message}`);
}

// Marca de tiempo de la ultima corrida de deteccion (cron incremental o boton
// "Detectar novedades"), para mostrar en la UI cuando se actualizaron las
// novedades por ultima vez. Reusa incident_sync_state con una clave dedicada.
const INCIDENT_LAST_RUN_KEY = "cron:last_run";

export async function recordIncidentRun(): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getDB()
    .from("incident_sync_state")
    .upsert(
      { source_key: INCIDENT_LAST_RUN_KEY, watermark: now, updated_at: now },
      { onConflict: "source_key" }
    );
  if (error) throw new Error(`recordIncidentRun: ${error.message}`);
}

export async function getIncidentLastRun(): Promise<string | null> {
  const { data, error } = await getDB()
    .from("incident_sync_state")
    .select("updated_at")
    .eq("source_key", INCIDENT_LAST_RUN_KEY)
    .maybeSingle();
  if (error) throw new Error(`getIncidentLastRun: ${error.message}`);
  return (data?.updated_at as string | null) ?? null;
}

// Ultima sincronizacion del courier (max checked_at del tracking): Moovin es
// global; Forza es por tienda. La deteccion de novedades depende de que el
// tracking este fresco, asi que la UI lo muestra para avisar si quedo viejo.
export async function getCourierLastSync(
  provider: "moovin" | "forza",
  storeId: number
): Promise<string | null> {
  const db = getDB();
  if (provider === "forza") {
    const { data, error } = await db
      .from("forza_tracking")
      .select("checked_at")
      .eq("store_id", storeId)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`getCourierLastSync(forza): ${error.message}`);
    return (data?.checked_at as string | null) ?? null;
  }
  const { data, error } = await db
    .from("moovin_tracking")
    .select("checked_at")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getCourierLastSync(moovin): ${error.message}`);
  return (data?.checked_at as string | null) ?? null;
}

// Producto(s) del pedido de la novedad, para el detalle. Busca el pedido de
// Shopify por shopify_order_id (si lo tiene) o por la guia (tracking_number) y
// arma "Nx Titulo, ...". Best-effort: devuelve "" si no hay match.
export async function getIncidentOrderProducts(
  storeId: number,
  shopifyOrderId: string,
  guide: string
): Promise<string> {
  if (!shopifyOrderId && !guide) return "";
  const base = getDB().from("shopify_orders").select("line_items, raw_order").eq("store_id", storeId);
  const { data, error } = shopifyOrderId
    ? await base.eq("shopify_order_id", shopifyOrderId).limit(1).maybeSingle()
    : await base.eq("tracking_number", guide).limit(1).maybeSingle();
  if (error || !data) return "";
  const row = data as { line_items?: unknown; raw_order?: { line_items?: unknown } | null };
  const rawItems = row.raw_order && Array.isArray(row.raw_order.line_items) ? row.raw_order.line_items : [];
  const items = (Array.isArray(row.line_items) && row.line_items.length ? row.line_items : rawItems) as Array<{
    title?: unknown;
    quantity?: unknown;
  }>;
  return items
    .map((i) => `${Number(i.quantity ?? 0)}x ${String(i.title ?? "").trim()}`)
    .filter((s) => !s.startsWith("0x ") && s.length > 3)
    .join(", ");
}

export async function getIncident(id: number, storeId?: number): Promise<Incident | null> {
  let query = getDB().from("incidents").select("*").eq("id", id);
  if (storeId) query = query.eq("store_id", storeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`getIncident: ${error.message}`);
  return (data as Incident | null) ?? null;
}

export async function listIncidentEvents(incidentId: number): Promise<IncidentEvent[]> {
  const { data, error } = await getDB()
    .from("incident_events")
    .select("*")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listIncidentEvents: ${error.message}`);
  return (data ?? []) as IncidentEvent[];
}

export async function recordIncidentEvent(
  incidentId: number,
  event: IncidentEventInput
): Promise<void> {
  const { error } = await getDB().from("incident_events").insert({
    incident_id: incidentId,
    kind: event.kind,
    from_status: event.from_status ?? "",
    to_status: event.to_status ?? "",
    message: event.message ?? "",
    result: event.result ?? "ok",
    metadata: event.metadata ?? {},
  });
  if (error) throw new Error(`recordIncidentEvent: ${error.message}`);
}

// Edita el texto de una nota del historial. Restringido a kind "nota": el resto
// de eventos (deteccion, llamadas, cambios de estado) es bitacora inmutable.
export async function updateIncidentNote(eventId: number, message: string): Promise<void> {
  const { error } = await getDB()
    .from("incident_events")
    .update({ message })
    .eq("id", eventId)
    .eq("kind", "nota");
  if (error) throw new Error(`updateIncidentNote: ${error.message}`);
}

// Alta manual de una novedad. Deriva la clave del envio; si no hay guia ni
// pedido usa una clave con timestamp para no colisionar con otras manuales.
export async function createIncident(input: Partial<Incident>): Promise<Incident> {
  const key =
    (input.incident_key && input.incident_key.trim()) ||
    buildIncidentKey(input.guide_number ?? "", input.order_name ?? "") ||
    `manual:ts:${Date.now()}`;
  const status = (input.status ?? "pendiente") as IncidentStatus;
  const payload = {
    store_id: input.store_id ?? DEFAULT_FINANCE_STORE_ID,
    incident_key: key,
    source: (input.source ?? "manual") as IncidentSource,
    order_name: input.order_name ?? "",
    guide_number: input.guide_number ?? "",
    shopify_order_id: input.shopify_order_id ?? "",
    customer_name: input.customer_name ?? "",
    customer_phone: input.customer_phone ?? "",
    courier: input.courier ?? "",
    cod_amount: Number(input.cod_amount ?? 0),
    category: (input.category ?? "otro") as IncidentCategory,
    status,
    detail: input.detail ?? "",
    notes: input.notes ?? "",
    manual_override: true,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getDB().from("incidents").insert(payload).select().single();
  if (error) throw new Error(`createIncident: ${error.message}`);
  const incident = data as Incident;
  await recordIncidentEvent(incident.id, {
    kind: "detectada",
    to_status: status,
    message: "Novedad creada manualmente",
    result: "info",
  });
  return incident;
}

// Actualiza campos de una novedad y registra el evento que corresponda. Marca
// manual_override para que la deteccion automatica no la pise.
export async function patchIncident(
  id: number,
  patch: Partial<Incident>,
  event?: IncidentEventInput
): Promise<Incident> {
  const payload = { ...patch, manual_override: true, updated_at: new Date().toISOString() };
  const { data, error } = await getDB()
    .from("incidents")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`patchIncident: ${error.message}`);
  if (event) await recordIncidentEvent(id, event);
  return data as Incident;
}

// Endpoint PATCH: cambia estado/categoria/notas/telefono y registra el historial.
export async function updateIncident(
  id: number,
  updates: Partial<
    Pick<Incident, "status" | "category" | "notes" | "customer_phone" | "detail" | "reprogramada_para">
  >,
  storeId?: number
): Promise<Incident> {
  const current = await getIncident(id, storeId);
  if (!current) throw new Error("updateIncident: novedad no encontrada");

  const updated = await patchIncident(id, updates);

  if (updates.status && updates.status !== current.status) {
    await recordIncidentEvent(id, {
      kind: "estado_cambiado",
      from_status: current.status,
      to_status: updates.status,
      message: "Estado actualizado manualmente",
    });
  }
  if (updates.category && updates.category !== current.category) {
    await recordIncidentEvent(id, {
      kind: "categoria_cambiada",
      message: `Causa: ${current.category} -> ${updates.category}`,
    });
  }
  return updated;
}

// Deteccion automatica idempotente: busca por incident_key y decide insertar,
// actualizar o ignorar via applyDetection (respeta gestion manual y terminales).
export async function upsertDetectedIncident(
  candidate: DetectedIncident,
  /**
   * La fila existente, si el llamador ya la tiene cargada (null = ya comprobo
   * que no hay). Se pasa para evitar un SELECT por candidata: ese era el otro
   * lado del pico del 03/09 — 1.066 lecturas y 1.057 escrituras en cinco
   * minutos, una por novedad, que dejaron a PostgREST devolviendo 503 a todo el
   * resto de la aplicacion. Sin el argumento se sigue comportando como antes.
   */
  preloaded?: { existing: Incident | null }
): Promise<{ incident: Incident | null; outcome: "created" | "updated" | "skipped" }> {
  if (!candidate.incident_key) return { incident: null, outcome: "skipped" };
  const db = getDB();
  let existing: Incident | null;
  if (preloaded) {
    existing = preloaded.existing;
  } else {
    const { data: existingRow, error: findError } = await db
      .from("incidents")
      .select("*")
      .eq("store_id", candidate.store_id)
      .eq("incident_key", candidate.incident_key)
      .maybeSingle();
    if (findError) throw new Error(`upsertDetectedIncident: ${findError.message}`);
    existing = (existingRow as Incident | null) ?? null;
  }

  const decision = applyDetection(existing, candidate);
  if (decision.action === "skip") return { incident: existing, outcome: "skipped" };

  const payload = { ...decision.patch, updated_at: new Date().toISOString() };

  if (decision.action === "insert") {
    const { data, error } = await db.from("incidents").insert(payload).select().single();
    if (error) throw new Error(`upsertDetectedIncident: ${error.message}`);
    const incident = data as Incident;
    if (decision.event) await recordIncidentEvent(incident.id, decision.event);
    return { incident, outcome: "created" };
  }

  // update
  const { data, error } = await db
    .from("incidents")
    .update(payload)
    .eq("id", existing!.id)
    .select()
    .single();
  if (error) throw new Error(`upsertDetectedIncident: ${error.message}`);
  if (decision.event) await recordIncidentEvent(existing!.id, decision.event);
  return { incident: data as Incident, outcome: "updated" };
}
