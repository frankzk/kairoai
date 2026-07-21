// Helper compartido por las rutas server-side de finanzas (Carril 2 inc. 1).
// Carga los datos crudos de una tienda, los ensambla a filas trackeables y
// cachea el dataset por tienda POR SECCION, para que cada ruta descargue solo
// lo que usa (orders/ lee rows+traces ~1.6MB gzip en vez del payload completo
// de ~8MB gzip que habia con ~15k pedidos).
//
// Las carpetas con prefijo "_" son privadas en el App Router (no generan ruta).

import { gzipSync, gunzipSync } from "node:zlib";
import { getDB } from "@/lib/db";
import {
  listForzaTracking,
  listIcomflyOrders,
  listLogisticsRows,
  listMoovinTracking,
  listPersistedShopifyOrders,
  listSettlementImports,
  listSettlementRows,
  listWynTracking,
} from "@/lib/finance";
import { resolveDispatchState } from "@/lib/dispatch";
import { normalizeMatchKey } from "@/lib/order-matching";
import type { IcomflyOrderRecord } from "@/lib/finance-types";
import {
  buildForzaTrackingMap,
  buildWynTrackingMap,
  buildSettlementTraceMap,
  buildVisibleOrderRows,
  enrichSettlementRowsWithShopify,
  getDeliveredWithoutSettlement,
  getDoubleSettlementAnomalies,
  persistedOrderToSummary,
  type DoubleSettlementAnomaly,
  type SettlementTrace,
  type ShopifyOrderSummary,
  type TrackableOrderRow,
} from "@/lib/finance-orders";
import type { LogisticsRow, SettlementImport, SettlementRow } from "@/lib/finance-types";
import type { FinanceStorePublic } from "@/lib/store-config";
import {
  decideDatasetLoad,
  type DatasetCacheReadStatus,
} from "./orders-dataset-policy";
import {
  DATASET_SECTIONS,
  LEGACY_FULL_SECTION,
  deserializeFullDataset,
  deserializeSection,
  serializeFullDataset,
  serializeSection,
  type DatasetSection,
  type OrdersDataset,
  type SerializedFullDataset,
} from "./orders-dataset-sections";

export type { OrdersDataset, DatasetSection } from "./orders-dataset-sections";

// Notas sobre las secciones compartidas (Carril 2 inc.2):
//  - shopifyOrders / matchedSettlementRows / imports: los usan product-analysis/,
//    monthly-close/ y notes/ (buildFinanceControlCenter necesita las liquidaciones
//    enriquecidas y los imports; notes/ usa los pedidos Shopify).
//  - logisticsRows / liquidationAlertRows / doubleSettlementAnomalies: los usa
//    settlements-view/ (tab Liquidaciones), pre-calculados con la MISMA semantica
//    que page.tsx para que los numeros sean identicos a prod.

interface CacheEntry {
  at: number;
  data: OrdersDataset[DatasetSection];
}

// L1: cache en memoria por instancia, POR SECCION (clave store:section). TTL
// corto para que dentro de una misma instancia varios requests seguidos reusen
// las secciones sin ni siquiera tocar L2.
const CACHE_TTL_MS = 60_000;
const datasetCache = new Map<string, CacheEntry>();

function l1Key(store: FinanceStorePublic, section: DatasetSection): string {
  return `${store.code}:${section}`;
}

// Devuelve la entrada L1 de una seccion si existe y esta fresca.
function getFreshL1(store: FinanceStorePublic, section: DatasetSection): CacheEntry | null {
  const entry = datasetCache.get(l1Key(store, section));
  if (!entry || Date.now() - entry.at >= CACHE_TTL_MS) return null;
  return entry;
}

function setL1(
  store: FinanceStorePublic,
  section: DatasetSection,
  data: OrdersDataset[DatasetSection]
): void {
  datasetCache.set(l1Key(store, section), { at: Date.now(), data });
}

function setL1All(store: FinanceStorePublic, data: OrdersDataset): void {
  for (const section of DATASET_SECTIONS) setL1(store, section, data[section]);
}

// L2: cache durable y compartida en Postgres (tabla finance_dataset_cache,
// migracion 0013). Frescura de 60 min: el payload es grande y Postgres puede
// cancelar escrituras durante incidentes de Supabase. Las lecturas de usuario
// deben servir la ultima cache buena; los refrescos pesados quedan para crons o
// mutaciones controladas.
const DATASET_CACHE_TTL_MS = 60 * 60_000;
const DATASET_CACHE_TABLE = "finance_dataset_cache";
// Lectura del payload L2 (decenas de MB gzip en JSONB): 4s resulto irreal para
// el tamano actual del dataset (14-15k pedidos) — instancias frias abortaban la
// descarga y el modulo caia en 503 permanentes. 20s sigue siendo acotado frente
// al maxDuration de 60s de las rutas de lectura, pero permite que una descarga
// lenta complete. Si Supabase realmente esta caido, el timeout se alcanza igual
// y se mantiene la proteccion (stale L1 o 503 con backoff).
const L2_READ_TIMEOUT_MS = 20_000;
const L2_WRITE_TIMEOUT_MS = 8_000;
const DATASET_BUILD_TIMEOUT_MS = 45_000;
const L2_FAILURE_BACKOFF_MS = 15_000;

export class OrdersDatasetUnavailableError extends Error {
  readonly code = "ORDERS_DATASET_UNAVAILABLE";

  constructor(message = "La base operativa no esta disponible temporalmente") {
    super(message);
    this.name = "OrdersDatasetUnavailableError";
  }
}

export function isOrdersDatasetUnavailableError(
  error: unknown
): error is OrdersDatasetUnavailableError {
  return (
    error instanceof OrdersDatasetUnavailableError ||
    (error instanceof Error && error.name === "OrdersDatasetUnavailableError")
  );
}

function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} supero ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([Promise.resolve(operation), deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

// El unico campo de OrdersDataset que no es JSON nativo es settlementTraceByKey
// (un Map). JSON no representa Maps, asi que se serializa como arreglo de
// entradas (Array.from(map.entries())) y se reconstruye con new Map(entries) al
// leer. El resto de campos (rows, shopifyOrders, matchedSettlementRows, imports,
// logisticsRows, liquidationAlertRows, doubleSettlementAnomalies) ya son datos
// planos (strings/numbers/null/arreglos de objetos) y las fechas son strings ISO,
// asi que viajan por JSONB sin perdida.
// El payload se guarda comprimido como { gz: base64(gzip(json)) }. Se descomprime
// aca; tolera tambien un payload plano por compatibilidad.
function encodeCachePayload(value: unknown): { gz: string } {
  return { gz: gzipSync(Buffer.from(JSON.stringify(value))).toString("base64") };
}

function decodeCachePayload<T>(payload: { gz?: string } | T): T {
  const gz = (payload as { gz?: string } | null)?.gz;
  if (typeof gz === "string") {
    return JSON.parse(gunzipSync(Buffer.from(gz, "base64")).toString("utf8")) as T;
  }
  return payload as T;
}

interface DatasetCacheRow {
  section?: string;
  payload: unknown;
  refreshed_at: string;
}

type L2ReadResult =
  | { status: "hit"; rows: DatasetCacheRow[] }
  | { status: "miss" }
  | { status: "error"; error: string };

function toL2Result(data: DatasetCacheRow[] | null, error: { message: string } | null, label: string): L2ReadResult {
  if (error) {
    console.warn(`${label}: ${error.message}`);
    return { status: "error", error: error.message };
  }
  if (!data || data.length === 0) return { status: "miss" };
  return { status: "hit", rows: data };
}

// Lee las filas L2 de las secciones pedidas (una sola query con IN). Si la
// migracion 0021 aun no se aplica, la columna section no existe y la query
// falla: el llamador cae al fallback legacy (fila 'full'), que es exactamente
// el comportamiento pre-secciones.
async function readL2Sections(
  store: FinanceStorePublic,
  sections: readonly DatasetSection[]
): Promise<L2ReadResult> {
  try {
    const { data, error } = await withTimeout(
      getDB()
        .from(DATASET_CACHE_TABLE)
        .select("section, payload, refreshed_at")
        .eq("store_id", store.id)
        .in("section", sections as string[]),
      L2_READ_TIMEOUT_MS,
      `orders-dataset L2 read sections ${store.code}`
    );
    return toL2Result(data as DatasetCacheRow[] | null, error, `[orders-dataset L2 read sections] ${store.code}`);
  } catch (err) {
    console.warn(`[orders-dataset L2 read sections] ${store.code}:`, err);
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

// Lee la fila legacy 'full' (dataset completo en una pieza). Post-0021 filtra
// por section='full'; pre-0021 (columna inexistente) lee la unica fila de la
// tienda sin filtro.
async function readL2LegacyFull(store: FinanceStorePublic): Promise<L2ReadResult> {
  const label = `orders-dataset L2 read legacy ${store.code}`;
  try {
    const { data, error } = await withTimeout(
      getDB()
        .from(DATASET_CACHE_TABLE)
        .select("payload, refreshed_at")
        .eq("store_id", store.id)
        .eq("section", LEGACY_FULL_SECTION)
        .maybeSingle(),
      L2_READ_TIMEOUT_MS,
      label
    );
    if (!error) return toL2Result(data ? [data as DatasetCacheRow] : null, null, `[${label}]`);
    // Pre-migracion 0021: la columna section no existe -> reintenta sin filtro.
    const legacy = await withTimeout(
      getDB()
        .from(DATASET_CACHE_TABLE)
        .select("payload, refreshed_at")
        .eq("store_id", store.id)
        .maybeSingle(),
      L2_READ_TIMEOUT_MS,
      `${label} (sin columna section)`
    );
    return toL2Result(legacy.data ? [legacy.data as DatasetCacheRow] : null, legacy.error, `[${label}]`);
  } catch (err) {
    console.warn(`[${label}]:`, err);
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

function isStaleRow(row: DatasetCacheRow): boolean {
  const refreshedAt = new Date(row.refreshed_at).getTime();
  return !Number.isFinite(refreshedAt) || Date.now() - refreshedAt >= DATASET_CACHE_TTL_MS;
}

// Escribe la fila legacy 'full' (una pieza). Es el formato pre-0021: sigue
// funcionando con y sin la migracion (la columna section tiene default 'full').
async function writeL2LegacyFull(store: FinanceStorePublic, data: OrdersDataset): Promise<string | null> {
  try {
    const { error } = await withTimeout(
      getDB()
        .from(DATASET_CACHE_TABLE)
        .upsert(
          {
            store_id: store.id,
            section: LEGACY_FULL_SECTION,
            payload: encodeCachePayload(serializeFullDataset(data)),
            row_count: data.rows.length,
            refreshed_at: new Date().toISOString(),
          },
          // La PK post-0021 es (store_id, section). Usar onConflict: "store_id"
          // no matchea ninguna constraint unica y Postgres respondia
          // "there is no unique or exclusion constraint matching the ON CONFLICT
          // specification", dejando la escritura de respaldo inutilizable: cuando
          // el upsert por secciones fallaba (timeout), este fallback tambien fallaba
          // y no se persistia NADA. Conflictar por (store_id, section) apunta a la PK.
          { onConflict: "store_id,section" }
        ),
      L2_WRITE_TIMEOUT_MS,
      `orders-dataset L2 write legacy ${store.code}`
    );
    if (error) {
      console.warn(`[orders-dataset L2 write legacy] ${store.code}: ${error.message}`);
      return error.message;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[orders-dataset L2 write legacy] ${store.code}:`, err);
    return message;
  }
}

// Escribe (upsert) una fila por seccion en la cache L2. Cada payload va
// comprimido con gzip como { gz: base64 } dentro del JSONB. Si la escritura
// por secciones falla (p. ej. migracion 0021 aun no aplicada), cae a escribir
// la fila legacy 'full' para no perder la cache. Devuelve el mensaje de error
// si AMBAS escrituras fallan, o null si alguna fue ok.
async function writeDatasetCache(store: FinanceStorePublic, data: OrdersDataset): Promise<string | null> {
  try {
    const refreshedAt = new Date().toISOString();
    const rows = DATASET_SECTIONS.map((section) => ({
      store_id: store.id,
      section,
      payload: encodeCachePayload(serializeSection(section, data[section])),
      row_count: Array.isArray(data[section]) ? (data[section] as unknown[]).length : 0,
      refreshed_at: refreshedAt,
    }));
    const { error } = await withTimeout(
      getDB()
        .from(DATASET_CACHE_TABLE)
        .upsert(rows, { onConflict: "store_id,section" }),
      L2_WRITE_TIMEOUT_MS,
      `orders-dataset L2 write sections ${store.code}`
    );
    if (error) throw new Error(error.message);
    return null;
  } catch (err) {
    console.warn(
      `[orders-dataset L2 write sections] ${store.code}:`,
      err instanceof Error ? err.message : err,
      "— fallback a fila legacy"
    );
    return writeL2LegacyFull(store, data);
  }
}

// Ensambla el dataset crudo->filas trackeables. Mismo orden de operaciones que
// page.tsx: persistidos->summary, mapas de tracking por guia, traces de
// liquidacion, y buildVisibleOrderRows.
async function buildDataset(store: FinanceStorePublic): Promise<OrdersDataset> {
  const [persisted, logisticsRows, moovin, forza, wyn, settlementRows, imports, icomflyOrders] = await Promise.all([
    listPersistedShopifyOrders(20000, 0, store.id),
    listLogisticsRows(undefined, store.id),
    listMoovinTracking(),
    listForzaTracking(store.id),
    listWynTracking(store.id),
    listSettlementRows(undefined, store.id),
    listSettlementImports(store.id),
    listIcomflyOrders({ storeId: store.id }),
  ]);

  const shopifyOrders = persisted.map((order) =>
    persistedOrderToSummary(order as unknown as Record<string, unknown>)
  );
  const moovinByPackage = new Map(moovin.map((row) => [row.id_package, row]));
  const forzaByGuide = buildForzaTrackingMap(forza);
  const wynByGuide = buildWynTrackingMap(wyn);
  // El trace map se arma sobre filas de liquidacion ENRIQUECIDAS con Shopify
  // (igual que page.tsx: settlementTraceByKey usa matchedSettlementRows), para
  // que las llaves (shopify_order_name resuelto) coincidan con la UI.
  const enrichedSettlementRows = enrichSettlementRowsWithShopify(settlementRows, shopifyOrders);
  const settlementTraceByKey = buildSettlementTraceMap(enrichedSettlementRows, imports);

  const rows = buildVisibleOrderRows(
    logisticsRows,
    shopifyOrders,
    store,
    moovinByPackage,
    forzaByGuide,
    wynByGuide
  );

  // Hito de despacho por fila (iComfly + recoleccion de Moovin), precalculado
  // aqui para que orders/ lo funda en el "Estado de seguimiento" y que conteos/
  // filtro/paginacion sean consistentes. iComfly va keyed por #MCRC
  // (shopify_display_number); fuera de esa tienda el mapa no matchea -> null.
  const dispatchByKey = new Map<string, IcomflyOrderRecord>();
  for (const o of icomflyOrders) {
    const key = normalizeMatchKey(o.shopify_display_number || "");
    if (key && !dispatchByKey.has(key)) dispatchByKey.set(key, o);
  }
  for (const row of rows) {
    const rec = dispatchByKey.get(normalizeMatchKey(row.shopify_order_name || row.order_name || ""));
    row.dispatch_view = resolveDispatchState(
      rec,
      row.guide_number ? moovinByPackage.get(row.guide_number) : undefined,
      row.guide_number
    );
    if (rec) {
      row.dispatch_requested_by = rec.requested_by_name || "";
      row.dispatch_confirmed_by = rec.confirmed_by_name || "";
    }
  }

  // Alertas del tab Liquidaciones (mismas operaciones que los useMemo de page.tsx):
  //  - "por reclamar": entregados sin liquidar, sobre las filas de liquidacion
  //    CRUDAS (settlementRows), igual que el cliente.
  //  - doble liquidacion: claves con >=2 trazas, sobre el trace map ya enriquecido.
  const liquidationAlertRows = getDeliveredWithoutSettlement(logisticsRows, settlementRows);
  const doubleSettlementAnomalies = getDoubleSettlementAnomalies(settlementTraceByKey);

  return {
    rows,
    settlementTraceByKey,
    shopifyOrders,
    matchedSettlementRows: enrichedSettlementRows,
    imports,
    logisticsRows,
    liquidationAlertRows,
    doubleSettlementAnomalies,
  };
}

// Devuelve el dataset ensamblado de una tienda con cache de dos niveles:
//   L1 (memoria, ~60s): hit fresco -> se devuelve sin tocar Postgres.
//   L2 (Postgres, ~60min): si L1 esta vencido, lee la fila compartida; si esta
//      fresca, deserializa, repuebla L1 y la devuelve.
//   Miss confirmado en L2: arma el dataset, escribe L2 + L1 y lo devuelve.
// El valor devuelto es identico al de buildDataset (caso L1/build directos) o a
// uno reconstruido byte a byte desde JSONB (caso L2). Un error de L2 nunca se
// interpreta como miss: se sirve L1 vencido o se responde temporalmente no
// disponible para evitar reconstrucciones masivas durante una caida de Supabase.
//
// Single-flight por tienda: al abrir el dashboard, varias rutas (orders/, kpis/,
// summary/, settlements-view/, ...) piden el dataset a la vez. En una instancia
// fria (L1 vacia) cada una repetia la parte cara — descargar el payload L2 de
// decenas de MB, gunzip y JSON.parse — en paralelo sobre el mismo proceso, y esa
// competencia de CPU empujaba a la ruta de pedidos por encima de su maxDuration
// (FUNCTION_INVOCATION_TIMEOUT en cada cold start). Con una unica promesa en
// vuelo por tienda, el primer request hace el trabajo y el resto espera el mismo
// resultado.
const inFlightLoads = new Map<string, Promise<void>>();
const l2FailureUntilByStore = new Map<string, number>();

function assembleFromL1<S extends DatasetSection>(
  store: FinanceStorePublic,
  sections: readonly S[]
): Pick<OrdersDataset, S> {
  const out = {} as Pick<OrdersDataset, S>;
  for (const section of sections) {
    out[section] = datasetCache.get(l1Key(store, section))!.data as OrdersDataset[S];
  }
  return out;
}

// Cold build: solo lo inicia un miss confirmado (sin filas de seccion NI fila
// legacy). Repuebla L1 completo y escribe L2 best-effort: el usuario recibe el
// dataset aunque Supabase falle al guardarlo. Los errores del build SI se
// propagan (el caller responde 500 con mensaje amigable, como antes).
async function coldBuild(store: FinanceStorePublic): Promise<void> {
  const data = await withTimeout(
    buildDataset(store),
    DATASET_BUILD_TIMEOUT_MS,
    `orders-dataset build ${store.code}`
  );
  setL1All(store, data);
  const writeError = await writeDatasetCache(store, data);
  if (writeError) {
    console.warn(`[orders-dataset cold build] ${store.code}: cache write failed: ${writeError}`);
  }
}

// Carga en L1 las secciones pedidas. Orden de fuentes: filas por seccion ->
// fila legacy 'full' -> cold build. Nunca lanza por problemas de cache: ante
// error registra el backoff por tienda y deja L1 como esta (el llamador sirve
// stale L1 si tiene, o responde 503 protegido).
async function loadMissingSections(
  store: FinanceStorePublic,
  sections: readonly DatasetSection[]
): Promise<void> {
  // 1) Filas por seccion (el formato vigente post-0021).
  const fromSections = await readL2Sections(store, sections);
  if (fromSections.status === "hit") {
    const bySection = new Map(fromSections.rows.map((row) => [row.section, row]));
    if (sections.every((s) => bySection.has(s))) {
      l2FailureUntilByStore.delete(store.code);
      let anyStale = false;
      for (const s of sections) {
        const row = bySection.get(s)!;
        if (isStaleRow(row)) anyStale = true;
        setL1(store, s, deserializeSection(s, decodeCachePayload<unknown>(row.payload)) as OrdersDataset[DatasetSection]);
      }
      // Serve-stale: aunque la fila este vencida, la servimos igual. No lanzamos
      // refresh pesado desde requests de usuario; en serverless eso multiplica
      // rebuilds por instancia y puede saturar Supabase durante degradaciones.
      if (anyStale) {
        console.warn(`[orders-dataset L2 stale] ${store.code}: serving stale cache`);
      }
      return;
    }
    // Faltan filas de seccion (p. ej. el primer build post-0021 aun no corre):
    // sigue el fallback legacy / cold build.
  }

  // 2) Fila legacy 'full' (transicion y compatibilidad pre-0021).
  const legacy = await readL2LegacyFull(store);
  const status: DatasetCacheReadStatus =
    legacy.status === "hit" ? "hit" : legacy.status === "miss" ? "miss" : "error";
  const hasL1 = sections.every((s) => datasetCache.has(l1Key(store, s)));
  const decision = decideDatasetLoad(status, hasL1);

  if (decision === "use-l2" && legacy.status === "hit") {
    l2FailureUntilByStore.delete(store.code);
    const full = deserializeFullDataset(
      decodeCachePayload<SerializedFullDataset>(
        legacy.rows[0].payload as { gz?: string } | SerializedFullDataset
      )
    );
    setL1All(store, full);
    if (isStaleRow(legacy.rows[0])) {
      console.warn(`[orders-dataset L2 stale] ${store.code}: serving legacy stale cache`);
    }
    return;
  }

  if (decision === "use-stale-l1") {
    l2FailureUntilByStore.set(store.code, Date.now() + L2_FAILURE_BACKOFF_MS);
    console.warn(`[orders-dataset L1 stale] ${store.code}: serving after L2 failure`);
    return;
  }

  if (decision === "unavailable") {
    l2FailureUntilByStore.set(store.code, Date.now() + L2_FAILURE_BACKOFF_MS);
    return;
  }

  // 3) Miss confirmado -> cold build.
  await coldBuild(store);
}

// Devuelve las secciones pedidas del dataset, con cache de dos niveles POR
// SECCION:
//   L1 (memoria, ~60s, clave store:section): hit fresco -> sin tocar Postgres.
//   L2 (Postgres, ~60min): una fila por (store_id, section); se leen solo las
//      secciones pedidas en una sola query (orders/ baja ~1.6MB gzip en vez de
//      los ~8MB del payload completo).
//   Fallback: fila legacy 'full' (pre-0021) -> cold build solo tras miss real.
// Single-flight por tienda: al abrir el dashboard varias rutas piden secciones
// a la vez; con una unica carga en vuelo por tienda, la primera trabaja y el
// resto espera el mismo resultado (ver comentario mas arriba).
export async function getOrdersDataset<S extends DatasetSection>(
  store: FinanceStorePublic,
  sections: readonly S[]
): Promise<Pick<OrdersDataset, S>> {
  const missingFresh = () => sections.filter((s) => !getFreshL1(store, s));

  if (missingFresh().length === 0) {
    return assembleFromL1(store, sections);
  }

  // Fail-fast durante una caida de Supabase: solo si alguna seccion no tiene
  // NADA en L1 (ni vencido) que servir.
  const failureUntil = l2FailureUntilByStore.get(store.code) ?? 0;
  const withoutAnyL1 = () => sections.filter((s) => !datasetCache.has(l1Key(store, s)));
  if (failureUntil > Date.now() && withoutAnyL1().length > 0) {
    throw new OrdersDatasetUnavailableError();
  }

  for (let attempt = 0; attempt < 2 && missingFresh().length > 0; attempt++) {
    const inFlight = inFlightLoads.get(store.code);
    if (inFlight) {
      // Otra carga en vuelo (p. ej. de una ruta hermana): se espera y se
      // re-evalua L1; si aun faltan secciones, el siguiente intento carga.
      await inFlight.catch(() => undefined);
      continue;
    }
    const load = loadMissingSections(store, missingFresh());
    inFlightLoads.set(store.code, load);
    try {
      await load;
    } finally {
      // Se limpia siempre (exito o error) para que un fallo no deje pegada una
      // promesa rechazada: el siguiente request reintenta desde cero.
      inFlightLoads.delete(store.code);
    }
  }

  // Tras la carga: si alguna seccion sigue sin NADA en L1, la cache fallo ->
  // 503 protegido (mismo contrato que antes).
  if (withoutAnyL1().length > 0) {
    throw new OrdersDatasetUnavailableError();
  }
  return assembleFromL1(store, sections);
}

// Reconstruye el dataset de una tienda y refresca ambas caches (L2 upsert por
// seccion + L1). Es lo que llaman el cron (app/api/cron/finance-index) y las
// mutaciones para mantener la cache fresca FUERA del path del request.
// Devuelve el numero de filas ensambladas. Defensivo: si la escritura L2 falla,
// igual deja L1 al dia y devuelve el conteo (no lanza por culpa de la cache).
export async function refreshFinanceDatasetCache(store: FinanceStorePublic): Promise<number> {
  const data = await withTimeout(
    buildDataset(store),
    DATASET_BUILD_TIMEOUT_MS,
    `orders-dataset refresh ${store.code}`
  );
  setL1All(store, data);
  const writeError = await writeDatasetCache(store, data);
  if (writeError) {
    // El cron (y el precalentado manual) reportan este error en vez de fallar en
    // silencio; las mutaciones que llaman a esto lo hacen con .catch (defensivas).
    throw new Error(`cache L2 write: ${writeError}`);
  }
  return data.rows.length;
}
