// Helper compartido por las rutas server-side de finanzas (Carril 2 inc. 1).
// Carga los datos crudos de una tienda, los ensambla a filas trackeables y
// cachea el dataset por tienda con un TTL corto, para que kpis/ y orders/
// reusen el mismo trabajo sin recargar 11k pedidos en cada request.
//
// Las carpetas con prefijo "_" son privadas en el App Router (no generan ruta).

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

const CACHE_TTL_MS = 30_000;
const datasetCache = new Map<string, CacheEntry>();

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

// Devuelve el dataset ensamblado de una tienda, sirviendo desde cache si esta
// fresco (TTL ~30s). Las rutas paginan/filtran sobre el resultado.
export async function getOrdersDataset(store: FinanceStorePublic): Promise<OrdersDataset> {
  const cached = datasetCache.get(store.code);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await buildDataset(store);
  datasetCache.set(store.code, { at: Date.now(), data });
  return data;
}
