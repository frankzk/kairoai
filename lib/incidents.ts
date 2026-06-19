import { getDB } from "@/lib/db";
import { DEFAULT_FINANCE_STORE_ID } from "@/lib/store-config";
import { applyDetection, buildIncidentKey } from "@/lib/incidents-detect";

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

export async function listIncidents(filters: IncidentFilters = {}): Promise<Incident[]> {
  let query = getDB().from("incidents").select("*").order("updated_at", { ascending: false });
  if (filters.storeId) query = query.eq("store_id", filters.storeId);
  if (filters.soloReintento) query = query.eq("status", "sin_contestar");
  else if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.source) query = query.eq("source", filters.source);
  const q = escapeOr(filters.search ?? "");
  if (q) {
    query = query.or(
      `order_name.ilike.%${q}%,guide_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`
    );
  }
  const { data, error } = await query.limit(2000);
  if (error) throw new Error(`listIncidents: ${error.message}`);
  return (data ?? []) as Incident[];
}

// Conteo de novedades por estado para TODA la tienda, SIN los filtros de la
// bandeja. Alimenta los chips-resumen, que deben reflejar el panorama global y
// no la lista filtrada que se muestra en la tabla. Usa count exacto por estado
// (head: true, sin traer filas).
export async function countIncidentsByStatus(storeId: number): Promise<Record<string, number>> {
  const statuses: IncidentStatus[] = [
    "pendiente", "reprogramada", "sin_contestar", "no_llamar", "resuelta", "perdida", "descartada",
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

  const db = getDB();
  const [nuevasRes, resueltasRes] = await Promise.all([
    db.from("incidents").select("id, created_at")
      .eq("store_id", storeId).gte("created_at", sinceIso).limit(5000),
    db.from("incident_events").select("incident_id, created_at, incidents!inner(store_id)")
      .eq("incidents.store_id", storeId).eq("to_status", "resuelta").gte("created_at", sinceIso).limit(5000),
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
export async function incidentExecutiveStats(storeId: number): Promise<IncidentExecutiveStats> {
  const DAY = 86_400_000;
  const TZ_OFFSET = 6 * 60 * 60 * 1000; // UTC-6 (Costa Rica / Honduras)
  const nowMs = Date.now();
  const startToday = Math.floor((nowMs - TZ_OFFSET) / DAY) * DAY + TZ_OFFSET;
  const END = nowMs + DAY;
  const since30 = new Date(startToday - 29 * DAY).toISOString();
  const caDayKey = (ms: number) => new Date(ms - TZ_OFFSET).toISOString().slice(0, 10);

  const db = getDB();
  const [createdRes, resolvedRes, openRes, callRes, dispatchedRes] = await Promise.all([
    db.from("incidents").select("id, created_at, status, category, cod_amount")
      .eq("store_id", storeId).gte("created_at", since30).limit(8000),
    db.from("incident_events").select("incident_id, created_at, incidents!inner(store_id, cod_amount)")
      .eq("incidents.store_id", storeId).eq("to_status", "resuelta").gte("created_at", since30).limit(8000),
    db.from("incidents").select("order_name, guide_number, created_at")
      .eq("store_id", storeId).not("status", "in", "(resuelta,perdida,descartada)").limit(8000),
    db.from("incident_events").select("incident_id, created_at, incidents!inner(store_id, created_at)")
      .eq("incidents.store_id", storeId).eq("kind", "llamada").gte("created_at", since30).limit(8000),
    // Pedidos despachados (con guia) por fecha de pedido, para la tasa Inc./Despachados.
    db.from("shopify_orders").select("shopify_created_at")
      .eq("store_id", storeId).neq("tracking_number", "").gte("shopify_created_at", since30).limit(50000),
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
  // Primera gestion (ultimos 30d): creacion -> primer llamado.
  const firstCall = new Map<number, number>();
  const createdAtOf = new Map<number, number>();
  for (const c of calls) {
    const t = Date.parse(c.created_at);
    const prev = firstCall.get(c.incident_id);
    if (prev === undefined || t < prev) firstCall.set(c.incident_id, t);
    const inc = one(c.incidents);
    if (inc?.created_at) createdAtOf.set(c.incident_id, Date.parse(inc.created_at));
  }
  let pgSum = 0;
  let pgN = 0;
  for (const [id, callMs] of Array.from(firstCall.entries())) {
    const createdMs = createdAtOf.get(id);
    if (createdMs === undefined) continue;
    const diff = callMs - createdMs;
    if (diff >= 0) { pgSum += diff; pgN += 1; }
  }
  const estado: IncidentEstadoActual = {
    abiertas: open.length,
    abiertas_48h: abiertas48,
    edad_promedio_dias: open.length ? edadSum / open.length / DAY : 0,
    mas_antigua: oldest
      ? { dias: Math.floor((nowMs - Date.parse(oldest.created_at)) / DAY), order_name: oldest.order_name, guide_number: oldest.guide_number }
      : null,
    primera_gestion_horas: pgN ? pgSum / pgN / 3_600_000 : null,
  };

  // ----- Causas (ultimos 30d) + recuperacion por motivo.
  const causasMap = new Map<IncidentCategory, { total: number; resueltas: number }>();
  for (const r of created) {
    const e = causasMap.get(r.category) ?? { total: 0, resueltas: 0 };
    e.total += 1;
    if (r.status === "resuelta") e.resueltas += 1;
    causasMap.set(r.category, e);
  }
  const total30 = created.length;
  const causas: IncidentCausaStat[] = Array.from(causasMap.entries())
    .map(([category, v]) => ({
      category,
      total: v.total,
      resueltas: v.resueltas,
      pct: total30 ? (v.total / total30) * 100 : 0,
      recuperacion: v.total ? (v.resueltas / v.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ----- Tendencia (ultimos 30 dias) + totales / balance.
  const genByDay = new Map<string, number>();
  for (const r of created) { const k = caDayKey(Date.parse(r.created_at)); genByDay.set(k, (genByDay.get(k) ?? 0) + 1); }
  const resByDay = new Map<string, number>();
  for (const r of resolved) { const k = caDayKey(Date.parse(r.created_at)); resByDay.set(k, (resByDay.get(k) ?? 0) + 1); }
  const trend: IncidentTrendPoint[] = [];
  let genTot = 0;
  let resTot = 0;
  for (let i = 29; i >= 0; i--) {
    const k = caDayKey(startToday - i * DAY);
    const g = genByDay.get(k) ?? 0;
    const rr = resByDay.get(k) ?? 0;
    genTot += g;
    resTot += rr;
    trend.push({ date: k, generadas: g, resueltas: rr });
  }

  return {
    matriz,
    estado,
    trend,
    trend_totales: { generadas: genTot, resueltas: resTot, balance: resTot - genTot },
    causas,
  };
}

// Conjunto de claves existentes, para que la deteccion automatica descarte
// entregas ya confirmadas sin consultar fila por fila.
export async function listIncidentKeys(storeId: number): Promise<Set<string>> {
  const { data, error } = await getDB()
    .from("incidents")
    .select("incident_key")
    .eq("store_id", storeId)
    .limit(10000);
  if (error) throw new Error(`listIncidentKeys: ${error.message}`);
  const keys = new Set<string>();
  for (const row of (data ?? []) as Array<{ incident_key: string }>) keys.add(row.incident_key);
  return keys;
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
  candidate: DetectedIncident
): Promise<{ incident: Incident | null; outcome: "created" | "updated" | "skipped" }> {
  if (!candidate.incident_key) return { incident: null, outcome: "skipped" };
  const db = getDB();
  const { data: existingRow, error: findError } = await db
    .from("incidents")
    .select("*")
    .eq("store_id", candidate.store_id)
    .eq("incident_key", candidate.incident_key)
    .maybeSingle();
  if (findError) throw new Error(`upsertDetectedIncident: ${findError.message}`);
  const existing = (existingRow as Incident | null) ?? null;

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
