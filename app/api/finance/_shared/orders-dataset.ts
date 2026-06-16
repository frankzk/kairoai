// Helper compartido por las rutas server-side de finanzas (Carril 2 inc. 1).
// Carga los datos crudos de una tienda, los ensambla a filas trackeables y
// cachea el dataset por tienda con un TTL corto, para que kpis/ y orders/
// reusen el mismo trabajo sin recargar 11k pedidos en cada request.
//
// Las carpetas con prefijo "_" son privadas en el App Router (no generan ruta).

import { gzipSync, gunzipSync } from "node:zlib";
import { getDB } from "@/lib/db";
import {
  listForzaTracking,
  listLogisticsRows,
  listMoovinTracking,
  listPersistedShopifyOrders,
  listSettlementImports,
  listSettlementRows,
} from "@/lib/finance";
import {
  buildForzaTrackingMap,
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

export interface OrdersDataset {
  rows: TrackableOrderRow[];
  settlementTraceByKey: Map<string, SettlementTrace[]>;
  // Expuestos para las rutas product-analysis/, monthly-close/ y notes/ (Carril 2
  // inc.2): buildFinanceControlCenter necesita las liquidaciones enriquecidas y
  // los imports; notes/ usa los pedidos Shopify. Ya se calculan en buildDataset,
  // asi que no hay carga extra.
  shopifyOrders: ShopifyOrderSummary[];
  matchedSettlementRows: SettlementRow[];
  imports: SettlementImport[];
  // Expuesto para settlements-view/ (Carril 2 — tab Liquidaciones):
  // getDeliveredWithoutSettlement necesita las filas crudas de logistica. Ya se
  // cargan en buildDataset (listLogisticsRows), asi que no hay carga extra.
  logisticsRows: LogisticsRow[];
  // Pre-calculados para settlements-view/ con la MISMA semantica que page.tsx
  // (Carril 2 — tab Liquidaciones), para que los numeros sean identicos a prod:
  //  - liquidationAlertRows: getDeliveredWithoutSettlement(logisticsRows, RAW
  //    settlementRows) — usa las filas de liquidacion crudas, igual que el useMemo
  //    del cliente (que opera sobre el estado `rows`, no las enriquecidas).
  //  - doubleSettlementAnomalies: getDoubleSettlementAnomalies(settlementTraceByKey)
  //    donde el trace map ya se arma sobre las filas ENRIQUECIDAS + imports.
  liquidationAlertRows: LogisticsRow[];
  doubleSettlementAnomalies: DoubleSettlementAnomaly[];
}

interface CacheEntry {
  at: number;
  data: OrdersDataset;
}

// L1: cache en memoria por instancia. TTL corto para que dentro de una misma
// instancia varios requests seguidos reusen el dataset sin ni siquiera tocar L2.
const CACHE_TTL_MS = 60_000;
const datasetCache = new Map<string, CacheEntry>();

// L2: cache durable y compartida en Postgres (tabla finance_dataset_cache,
// migracion 0013). Frescura de 10 min: si la fila es mas vieja, se reconstruye
// on-read. El cron (cada ~10 min) y las mutaciones llaman refreshFinanceDatasetCache
// para mantenerla fresca, asi el "cold build" no cae en el path del request.
const DATASET_CACHE_TTL_MS = 10 * 60_000;
const DATASET_CACHE_TABLE = "finance_dataset_cache";

// El unico campo de OrdersDataset que no es JSON nativo es settlementTraceByKey
// (un Map). JSON no representa Maps, asi que se serializa como arreglo de
// entradas (Array.from(map.entries())) y se reconstruye con new Map(entries) al
// leer. El resto de campos (rows, shopifyOrders, matchedSettlementRows, imports,
// logisticsRows, liquidationAlertRows, doubleSettlementAnomalies) ya son datos
// planos (strings/numbers/null/arreglos de objetos) y las fechas son strings ISO,
// asi que viajan por JSONB sin perdida.
type SettlementTraceEntries = Array<[string, SettlementTrace[]]>;

interface SerializedDataset extends Omit<OrdersDataset, "settlementTraceByKey"> {
  settlementTraceByKey: SettlementTraceEntries;
}

function serializeDataset(data: OrdersDataset): SerializedDataset {
  return {
    ...data,
    settlementTraceByKey: Array.from(data.settlementTraceByKey.entries()),
  };
}

function deserializeDataset(payload: SerializedDataset): OrdersDataset {
  return {
    ...payload,
    settlementTraceByKey: new Map<string, SettlementTrace[]>(
      payload.settlementTraceByKey ?? []
    ),
  };
}

interface DatasetCacheRow {
  payload: { gz?: string } | SerializedDataset;
  row_count: number;
  refreshed_at: string;
}

// El payload se guarda comprimido como { gz: base64(gzip(json)) }. Se descomprime
// aca; tolera tambien un payload plano por compatibilidad.
function decodeCachePayload(payload: { gz?: string } | SerializedDataset): SerializedDataset {
  const gz = (payload as { gz?: string } | null)?.gz;
  if (typeof gz === "string") {
    return JSON.parse(gunzipSync(Buffer.from(gz, "base64")).toString("utf8")) as SerializedDataset;
  }
  return payload as SerializedDataset;
}

// Lee la fila de cache L2 de una tienda. Devuelve null si no existe, si la
// frescura expiro, o si el acceso falla (p. ej. la migracion 0013 aun no se
// aplico): el llamador entonces reconstruye en memoria. Nunca lanza.
async function readDatasetCache(store: FinanceStorePublic): Promise<OrdersDataset | null> {
  try {
    const { data, error } = await getDB()
      .from(DATASET_CACHE_TABLE)
      .select("payload, row_count, refreshed_at")
      .eq("store_id", store.id)
      .maybeSingle();
    if (error) {
      console.warn(`[orders-dataset L2 read] ${store.code}: ${error.message}`);
      return null;
    }
    const row = data as DatasetCacheRow | null;
    if (!row) return null;
    const refreshedAt = new Date(row.refreshed_at).getTime();
    if (!Number.isFinite(refreshedAt) || Date.now() - refreshedAt >= DATASET_CACHE_TTL_MS) {
      return null;
    }
    return deserializeDataset(decodeCachePayload(row.payload));
  } catch (err) {
    console.warn(`[orders-dataset L2 read] ${store.code}:`, err);
    return null;
  }
}

// Escribe (upsert) el dataset en la cache L2. El payload ensamblado es enorme
// (decenas de MB: rows + shopifyOrders + logistica), asi que se comprime con gzip
// y se guarda como { gz: base64 } dentro del JSONB (sin migracion). Devuelve el
// mensaje de error si la escritura falla, o null si fue ok (el cron lo reporta).
async function writeDatasetCache(store: FinanceStorePublic, data: OrdersDataset): Promise<string | null> {
  try {
    const gz = gzipSync(Buffer.from(JSON.stringify(serializeDataset(data)))).toString("base64");
    const { error } = await getDB()
      .from(DATASET_CACHE_TABLE)
      .upsert(
        {
          store_id: store.id,
          payload: { gz },
          row_count: data.rows.length,
          refreshed_at: new Date().toISOString(),
        },
        { onConflict: "store_id" }
      );
    if (error) {
      console.warn(`[orders-dataset L2 write] ${store.code}: ${error.message}`);
      return error.message;
    }
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[orders-dataset L2 write] ${store.code}:`, err);
    return message;
  }
}

// Ensambla el dataset crudo->filas trackeables. Mismo orden de operaciones que
// page.tsx: persistidos->summary, mapas de tracking por guia, traces de
// liquidacion, y buildVisibleOrderRows.
async function buildDataset(store: FinanceStorePublic): Promise<OrdersDataset> {
  const [persisted, logisticsRows, moovin, forza, settlementRows, imports] = await Promise.all([
    listPersistedShopifyOrders(20000, 0, store.id),
    listLogisticsRows(undefined, store.id),
    listMoovinTracking(),
    listForzaTracking(store.id),
    listSettlementRows(undefined, store.id),
    listSettlementImports(store.id),
  ]);

  const shopifyOrders = persisted.map((order) =>
    persistedOrderToSummary(order as unknown as Record<string, unknown>)
  );
  const moovinByPackage = new Map(moovin.map((row) => [row.id_package, row]));
  const forzaByGuide = buildForzaTrackingMap(forza);
  // El trace map se arma sobre filas de liquidacion ENRIQUECIDAS con Shopify
  // (igual que page.tsx: settlementTraceByKey usa matchedSettlementRows), para
  // que las llaves (shopify_order_name resuelto) coincidan con la UI.
  const enrichedSettlementRows = enrichSettlementRowsWithShopify(settlementRows, shopifyOrders);
  const settlementTraceByKey = buildSettlementTraceMap(enrichedSettlementRows, imports);

  const rows = buildVisibleOrderRows(logisticsRows, shopifyOrders, store, moovinByPackage, forzaByGuide);

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
//   L2 (Postgres, ~10min): si L1 esta vencido, lee la fila compartida; si esta
//      fresca, deserializa, repuebla L1 y la devuelve.
//   Miss en ambos: arma el dataset (cold build), escribe L2 + L1 y lo devuelve.
// El valor devuelto es identico al de buildDataset (caso L1/build directos) o a
// uno reconstruido byte a byte desde JSONB (caso L2). Esto es solo cache: si L2
// falla o la tabla no existe, cae a armar en memoria — el dashboard no se rompe.
export async function getOrdersDataset(store: FinanceStorePublic): Promise<OrdersDataset> {
  const cached = datasetCache.get(store.code);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }

  const fromL2 = await readDatasetCache(store);
  if (fromL2) {
    datasetCache.set(store.code, { at: Date.now(), data: fromL2 });
    return fromL2;
  }

  const data = await buildDataset(store);
  datasetCache.set(store.code, { at: Date.now(), data });
  await writeDatasetCache(store, data);
  return data;
}

// Reconstruye el dataset de una tienda y refresca ambas caches (L2 upsert + L1).
// Es lo que llaman el cron (app/api/cron/finance-index) y las mutaciones para
// mantener la cache fresca FUERA del path del request. Devuelve el numero de
// filas ensambladas. Defensivo: si la escritura L2 falla, igual deja L1 al dia y
// devuelve el conteo (no lanza por culpa de la cache).
export async function refreshFinanceDatasetCache(store: FinanceStorePublic): Promise<number> {
  const data = await buildDataset(store);
  datasetCache.set(store.code, { at: Date.now(), data });
  const writeError = await writeDatasetCache(store, data);
  if (writeError) {
    // El cron (y el precalentado manual) reportan este error en vez de fallar en
    // silencio; las mutaciones que llaman a esto lo hacen con .catch (defensivas).
    throw new Error(`cache L2 write: ${writeError}`);
  }
  return data.rows.length;
}
