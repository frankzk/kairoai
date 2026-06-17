// Modulo compartido (puro, sin React) con la logica de ensamblado, estados y
// KPIs de pedidos del dashboard de finanzas. La logica esta copiada VERBATIM
// desde app/admin/finance/page.tsx (Carril 2 incremento 1) para que las rutas
// server-side la usen sin que el navegador tenga que cargar todos los pedidos.
// El de-duplicado contra page.tsx es un paso posterior.

import { FINANCE_STORES, type FinanceStorePublic } from "@/lib/store-config";
import type {
  BusinessExpense,
  ForzaTrackingRow,
  LogisticsRow,
  MoovinTrackingRow,
  ProductCost,
  ProductCostVersion,
  SettlementImport,
  SettlementOrderItem,
  SettlementRow,
} from "@/lib/finance-types";
import {
  buildShopifyMatchIndex,
  extractExternalOrderCodesFromText,
  findShopifyOrderForRow,
  getOrderMatchKeys,
  getShopifyNoteText,
  getShopifyOrderMatchKeys,
  normalizeMatchKey,
  normalizeSearchText,
  type OrderMatchKeySource,
} from "@/lib/order-matching";
import {
  getForzaTrackingFromMap,
  getStoreCarriers,
  normalizeGuideForStore,
  normalizeOperationalCourier,
  normalizeShopifyCourier,
  rowMatchesCarrier,
} from "@/lib/carriers";

// Re-export: app/api/finance/_shared/orders-dataset.ts importa buildForzaTrackingMap
// desde este modulo. La implementacion vive ahora en lib/carriers.ts.
export { buildForzaTrackingMap } from "@/lib/carriers";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ProductLineItem = { sku?: string; title: string; quantity: number; price: number };

export interface SettlementTrace {
  file_name: string;
  amount_to_liquidate: number;
  settlement_status: string;
  internal_status: string;
}

// Anomalia de doble liquidacion: una misma orden/guia aparece en >=2 archivos de
// liquidacion. Movido VERBATIM desde page.tsx (Carril 2 — tab Liquidaciones) para
// que la ruta settlements-view/ la calcule server-side.
export interface DoubleSettlementAnomaly {
  key: string;
  kind: "order" | "guide";
  traces: SettlementTrace[];
}

export interface ShopifyOrderSummary {
  id: string;
  order_number: number;
  name: string;
  customer_name: string;
  last_name?: string;
  phone: string | null;
  products: string;
  total: string;
  total_price: number;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  note?: string;
  note_attributes?: Array<{ name?: string | null; value?: string | null }>;
  tracking_number?: string;
  tracking_company?: string;
  created_at: string;
  line_items: ProductLineItem[];
}

export interface TrackableOrderRow {
  id?: number;
  row_key: string;
  source: "boxful" | "shopify" | "liquidacion";
  guide_number: string;
  courier?: string;
  moovin_group?: string;
  moovin_incidents?: number;
  forza_group?: string;
  forza_incidents?: number;
  order_name: string;
  customer_name: string;
  last_name?: string;
  boxful_status: string;
  internal_status: string;
  match_status: string;
  cod_amount: number;
  shopify_order_name: string;
  shopify_order_number: number | null;
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  shopify_cancelled_at: string | null;
  shopify_note?: string;
  shopify_created_at: string | null;
  created_on?: string | null;
  created_at?: string | null;
  finalized_on?: string | null;
  package_items: ProductLineItem[];
}

export interface OpMetrics {
  generated: number;
  dispatched: number;
  delivered: number;
  notDelivered: number;
  annulled: number;
  enRoute: number;
  enRouteRetry: number;
  resolved: number;
  deliveryRate: number;
  returnRate: number;
  dispatchRate: number;
  annulRate: number;
  leadAvg: number | null;
  leadSamples: number;
  ticket: number;
}

// Tipo de evento de tracking de Moovin (copiado VERBATIM de page.tsx ~2356).
// Usado por la clasificacion de incidencias.
export interface MoovinTrackingEvent {
  code: string;
  group: "delivered" | "failed" | "returned" | "in_progress";
  title: string;
  description: string;
  date: string | null;
  note: string;
}

// Estados de tracking (filtro). El score de consolidacion lo usa via
// getTrackingFilterFromStatus. Copiado VERBATIM de page.tsx ~71.
type OrderTrackingFilter =
  | "all"
  | "pending"
  | "en_route"
  | "en_route_retry"
  | "incident"
  | "annulled"
  | "delivered"
  | "not_delivered";

// isShopifyCancelled acepta en page.tsx una union de Pick<TrackableOrderRow, ...>
// y Pick<OrderProfitabilityRow, ...>; ambas resuelven estructuralmente a estos
// dos campos. Se define aqui el mismo shape para no arrastrar
// OrderProfitabilityRow (que no se usa en este modulo).
type ShopifyCancelledSource = {
  shopify_cancelled_at: string | null;
  shopify_financial_status: string;
};

// ---------------------------------------------------------------------------
// Courier / guia
// ---------------------------------------------------------------------------
// La logica de transportadoras (resolucion por fila, normalizacion de guia,
// helpers de courier) vive ahora en lib/carriers.ts como fuente unica,
// compartida con page.tsx y forza.ts. Ver imports al inicio del archivo.

// ---------------------------------------------------------------------------
// KPIs (page.tsx ~7145-7272, util sum ~7562)
// ---------------------------------------------------------------------------

// Rango y ventana de KPIs. Copiados VERBATIM de page.tsx (~7032-7143) para que
// la ruta kpis/ calcule current+previous con la misma logica que la UI.
export type KpiRange = "today" | "7d" | "30d" | "month" | "all";

export interface KpiWindow {
  curStart: number;
  curEnd: number;
  prevStart: number | null;
  prevEnd: number | null;
  rangeLabel: string;
  compareLabel: string;
  maturing: boolean;
}

function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Ventana actual + ventana previa "like-for-like" (mismo largo, inmediatamente
// anterior). "Mes" compara MTD contra el mismo tramo del mes anterior, no contra
// el mes completo. `maturing` marca rangos donde la tasa de entrega aun no madura
// por el lag logistico del COD (un pedido de hoy no se entrega hoy).
export function getKpiWindows(range: KpiRange, now: Date): KpiWindow {
  const end = now.getTime();
  const dayStart = startOfDayMs(now);
  const DAY = 24 * 60 * 60 * 1000;
  if (range === "all") {
    return {
      curStart: 0,
      curEnd: end,
      prevStart: null,
      prevEnd: null,
      rangeLabel: "Todo el histórico",
      compareLabel: "sin comparativo",
      maturing: false,
    };
  }
  if (range === "today") {
    return {
      curStart: dayStart,
      curEnd: end,
      prevStart: dayStart - DAY,
      prevEnd: dayStart,
      rangeLabel: "Hoy",
      compareLabel: "vs. ayer",
      maturing: true,
    };
  }
  if (range === "month") {
    const curStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const elapsed = end - curStart;
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    return {
      curStart,
      curEnd: end,
      prevStart,
      prevEnd: prevStart + elapsed,
      rangeLabel: "Mes actual",
      compareLabel: "vs. mes anterior (mismo tramo)",
      maturing: true,
    };
  }
  const days = range === "7d" ? 7 : 30;
  const curStart = dayStart - (days - 1) * DAY;
  const span = end - curStart;
  return {
    curStart,
    curEnd: end,
    prevStart: curStart - span,
    prevEnd: curStart,
    rangeLabel: `Últimos ${days} días`,
    compareLabel: `vs. ${days} días previos`,
    maturing: range === "7d",
  };
}

function isDispatchedStatus(status: string): boolean {
  return (
    status === "en_route" ||
    status === "en_route_retry" ||
    status === "incident" ||
    status === "delivered" ||
    status === "not_delivered" ||
    status === "returned"
  );
}

function diffDaysMs(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return -1;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

export function computeOpMetricsFromTrackableRows(
  rows: TrackableOrderRow[],
  settlementTraceByKey: Map<string, SettlementTrace[]>
): OpMetrics {
  let generated = 0;
  let dispatched = 0;
  let delivered = 0;
  let notDelivered = 0;
  let annulled = 0;
  let enRoute = 0;
  let enRouteRetry = 0;
  let revenue = 0;
  let valueOrders = 0;
  const leadDays: number[] = [];

  for (const row of rows) {
    generated += 1;
    const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
    const status = getEffectiveTrackingStatus(row, traces);
    if (Boolean(row.guide_number) || isDispatchedStatus(status)) dispatched += 1;
    if (status === "delivered") delivered += 1;
    else if (status === "not_delivered" || status === "returned") notDelivered += 1;
    else if (status === "annulled") annulled += 1;
    else if (status === "en_route") enRoute += 1;
    else if (status === "en_route_retry") enRouteRetry += 1;

    const itemValue = sum((row.package_items ?? []).map((item) => Number(item.price || 0) * Number(item.quantity || 0)));
    const value = Number(itemValue || row.cod_amount || 0);
    if (value > 0) {
      revenue += value;
      valueOrders += 1;
    }

    const deliveredOn = row.finalized_on ?? null;
    if (status === "delivered" && row.shopify_created_at && deliveredOn) {
      const lead = diffDaysMs(row.shopify_created_at, deliveredOn);
      if (lead >= 0 && lead <= 120) leadDays.push(lead);
    }
  }

  const resolved = delivered + notDelivered;
  return {
    generated,
    dispatched,
    delivered,
    notDelivered,
    annulled,
    enRoute,
    enRouteRetry,
    resolved,
    deliveryRate: dispatched ? (delivered / dispatched) * 100 : 0,
    returnRate: dispatched ? (notDelivered / dispatched) * 100 : 0,
    dispatchRate: generated ? (dispatched / generated) * 100 : 0,
    annulRate: generated ? (annulled / generated) * 100 : 0,
    leadAvg: leadDays.length ? leadDays.reduce((acc, value) => acc + value, 0) / leadDays.length : null,
    leadSamples: leadDays.length,
    ticket: valueOrders ? revenue / valueOrders : 0,
  };
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

// ---------------------------------------------------------------------------
// Ensamblado (page.tsx ~8138-8360)
// ---------------------------------------------------------------------------

export function buildVisibleOrderRows(
  logisticsRows: LogisticsRow[],
  shopifyOrders: ShopifyOrderSummary[],
  selectedStore: FinanceStorePublic,
  moovinByPackage: Map<string, MoovinTrackingRow>,
  forzaByGuide: Map<string, ForzaTrackingRow>
): TrackableOrderRow[] {
  const shopifyByMatchKey = buildShopifyMatchIndex(shopifyOrders);
  const logisticsDisplayRows = logisticsRows.map((row): TrackableOrderRow => {
    const shopify = findShopifyOrderForRow(row, shopifyByMatchKey);
    const guideNumber = normalizeGuideForStore(row.guide_number, selectedStore);
    const courier = normalizeOperationalCourier(row.courier, selectedStore, guideNumber);
    const moovinHit =
      rowMatchesCarrier("moovin", { displayCourier: courier, rawCourier: row.courier, guide: guideNumber, store: selectedStore }) &&
      guideNumber
        ? moovinByPackage.get(guideNumber)
        : undefined;
    const forzaHit =
      rowMatchesCarrier("forza", { displayCourier: courier, rawCourier: row.courier, guide: guideNumber, store: selectedStore }) &&
      guideNumber
        ? getForzaTrackingFromMap(forzaByGuide, guideNumber)
        : undefined;
    const shopifyItems = shopify
      ? shopify.line_items.map((item) => ({
          sku: item.sku,
          title: `${item.quantity}x ${item.title}`,
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
        }))
      : [];

    return {
      ...row,
      row_key: `boxful-${row.id}`,
      source: "boxful" as const,
      guide_number: guideNumber,
      courier,
      moovin_group: deriveMoovinGroup(moovinHit),
      moovin_incidents: moovinHit ? countMoovinIncidents(moovinHit.events) : undefined,
      forza_group: deriveForzaGroup(forzaHit),
      forza_incidents: forzaHit ? countForzaIncidents(forzaHit.events) : undefined,
      customer_name: row.customer_name || shopify?.customer_name || "",
      last_name: row.last_name || shopify?.last_name || "",
      match_status: shopify ? "matched" : row.match_status,
      cod_amount: row.cod_amount || Number(shopify?.total_price || parseMoneyText(shopify?.total ?? "")),
      shopify_order_name: shopify?.name ?? row.shopify_order_name,
      shopify_order_number: shopify?.order_number ?? row.shopify_order_number,
      shopify_financial_status: shopify?.financial_status ?? row.shopify_financial_status,
      shopify_fulfillment_status: shopify?.fulfillment_status ?? row.shopify_fulfillment_status,
      shopify_cancelled_at: shopify?.cancelled_at ?? row.shopify_cancelled_at,
      shopify_note: shopify?.note ?? "",
      shopify_created_at: shopify?.created_at ?? row.shopify_created_at,
      // Shopify manda: las lineas del pedido definen el producto; los
      // "Paquete N" de Boxful quedan solo como respaldo sin match.
      package_items: shopifyItems.length ? shopifyItems : row.package_items ?? [],
    };
  });
  const consolidatedLogisticsRows = consolidateLogisticsRows(
    logisticsDisplayRows.filter(isShopifyBackedLogisticsRow)
  );

  const existingKeys = new Set<string>();
  for (const row of consolidatedLogisticsRows) {
    for (const key of getOrderMatchKeys(row)) existingKeys.add(key);
  }

  const shopifyOnlyRows = shopifyOrders
    .filter((order) => !getShopifyOrderMatchKeys(order).some((key) => existingKeys.has(key)))
    .map((order): TrackableOrderRow => {
    // Guia desde el fulfillment de Shopify: el pedido ya salio a reparto
    // aunque aun no este en un Excel logistico. La transportadora por defecto
    // se decide por tienda para evitar cruces Costa Rica/Honduras.
    const shopifyGuide = normalizeGuideForStore(order.tracking_number ?? "", selectedStore);
    const baseCourier = shopifyGuide ? normalizeShopifyCourier(order.tracking_company, selectedStore) : "";
    const moovinHit =
      rowMatchesCarrier("moovin", {
        displayCourier: baseCourier,
        rawCourier: order.tracking_company,
        guide: shopifyGuide,
        store: selectedStore,
      }) && shopifyGuide
        ? moovinByPackage.get(shopifyGuide)
        : undefined;
    const forzaHit =
      rowMatchesCarrier("forza", {
        displayCourier: baseCourier,
        rawCourier: order.tracking_company,
        guide: shopifyGuide,
        store: selectedStore,
      }) && shopifyGuide
        ? getForzaTrackingFromMap(forzaByGuide, shopifyGuide)
        : undefined;
    const shopifyCourier = shopifyGuide
      ? moovinHit
        ? "Moovin"
        : forzaHit
          ? "Forza"
          : baseCourier
      : "";
    return {
      row_key: `shopify-${order.id}`,
      source: "shopify",
      guide_number: shopifyGuide,
      courier: shopifyCourier,
      moovin_group: deriveMoovinGroup(moovinHit),
      moovin_incidents: moovinHit ? countMoovinIncidents(moovinHit.events) : undefined,
      forza_group: deriveForzaGroup(forzaHit),
      forza_incidents: forzaHit ? countForzaIncidents(forzaHit.events) : undefined,
      order_name: order.name,
      customer_name: order.customer_name,
      last_name: order.last_name || "",
      boxful_status: "",
      internal_status:
        order.cancelled_at || order.financial_status === "voided" ? "annulled" : "pending",
      match_status: "matched",
      cod_amount: Number(order.total_price || parseMoneyText(order.total)),
      shopify_order_name: order.name,
      shopify_order_number: order.order_number ?? null,
      shopify_financial_status: order.financial_status,
      shopify_fulfillment_status: order.fulfillment_status ?? "",
      shopify_cancelled_at: order.cancelled_at,
      shopify_note: order.note ?? "",
      shopify_created_at: order.created_at,
      package_items: (order.line_items ?? []).map((item) => ({
        sku: item.sku,
        title: `${item.quantity}x ${item.title}`,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
      })),
    };
  });

  return [...consolidatedLogisticsRows, ...shopifyOnlyRows].sort((a, b) =>
    String(b.shopify_created_at || "").localeCompare(String(a.shopify_created_at || ""))
  );
}

export function isShopifyBackedLogisticsRow(row: TrackableOrderRow): boolean {
  if (row.match_status !== "matched") return false;
  return Boolean(
    normalizeMatchKey(row.shopify_order_name) ||
      (row.shopify_order_number ? normalizeMatchKey(`#MCRC${row.shopify_order_number}`) : "")
  );
}

export function consolidateLogisticsRows(rows: TrackableOrderRow[]): TrackableOrderRow[] {
  const byOrder = new Map<string, TrackableOrderRow>();

  for (const row of rows) {
    const key = getLogisticsConsolidationKey(row);
    const current = byOrder.get(key);
    byOrder.set(key, current ? pickBestLogisticsRow(current, row) : row);
  }

  return Array.from(byOrder.values());
}

function getLogisticsConsolidationKey(row: TrackableOrderRow): string {
  return (
    normalizeMatchKey(row.shopify_order_name) ||
    (row.shopify_order_number ? normalizeMatchKey(`#MCRC${row.shopify_order_number}`) : "") ||
    normalizeMatchKey(row.order_name) ||
    normalizeMatchKey(row.guide_number) ||
    row.row_key
  );
}

function pickBestLogisticsRow(current: TrackableOrderRow, candidate: TrackableOrderRow): TrackableOrderRow {
  const currentScore = getLogisticsTrackingScore(current);
  const candidateScore = getLogisticsTrackingScore(candidate);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;

  const currentDate = getLogisticsStatusDate(current);
  const candidateDate = getLogisticsStatusDate(candidate);
  if (candidateDate !== currentDate) return candidateDate > currentDate ? candidate : current;

  const currentHasShopify = normalizeMatchKey(current.shopify_order_name) ? 1 : 0;
  const candidateHasShopify = normalizeMatchKey(candidate.shopify_order_name) ? 1 : 0;
  if (candidateHasShopify !== currentHasShopify) return candidateHasShopify > currentHasShopify ? candidate : current;

  return candidate.id && current.id && candidate.id > current.id ? candidate : current;
}

function getLogisticsTrackingScore(row: TrackableOrderRow): number {
  const inferredStatus = isFinalTrackingStatus(row.internal_status)
    ? row.internal_status
    : inferTrackingStatusFromText(row.boxful_status);
  const status = getTrackingFilterFromStatus(inferredStatus);
  if (status === "delivered" || status === "not_delivered") return 3;
  if (row.source === "boxful" && row.guide_number) return 2;
  return 1;
}

function getLogisticsStatusDate(row: TrackableOrderRow): string {
  return String(row.finalized_on || row.created_on || row.shopify_created_at || row.created_at || "");
}

export function parseMoneyText(value: string): number {
  return Number(String(value || "").replace(/,/g, "").replace(/[^0-9.-]/g, "")) || 0;
}

// uniqueKeys (page.tsx ~8351), usado por getSettlementTracesForLogisticsRow.
function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}

// ---------------------------------------------------------------------------
// Traces (page.tsx ~9275)
// ---------------------------------------------------------------------------

export function getSettlementTracesForLogisticsRow(
  row: OrderMatchKeySource & Pick<TrackableOrderRow, "guide_number">,
  settlementTraceByKey: Map<string, SettlementTrace[]>
): SettlementTrace[] {
  const seen = new Set<string>();
  const traces: SettlementTrace[] = [];
  const keys = [
    ...getOrderMatchKeys(row),
    normalizeMatchKey(row.guide_number),
  ];

  for (const key of uniqueKeys(keys)) {
    for (const trace of settlementTraceByKey.get(key) ?? []) {
      const traceKey = `${trace.file_name}|${trace.amount_to_liquidate}|${trace.settlement_status}`;
      if (seen.has(traceKey)) continue;
      seen.add(traceKey);
      traces.push(trace);
    }
  }

  return traces;
}

// ---------------------------------------------------------------------------
// Estados (page.tsx ~9434-9605)
// ---------------------------------------------------------------------------

export function getEffectiveTrackingStatus(
  row: Pick<TrackableOrderRow, "source" | "boxful_status" | "internal_status" | "shopify_cancelled_at" | "shopify_financial_status" | "moovin_group" | "moovin_incidents" | "forza_group" | "forza_incidents" | "guide_number">,
  traces: SettlementTrace[]
): string {
  // Moovin manda para sus envios: su ultimo evento define el estado en vivo.
  const moovinStatus = moovinGroupToStatus(row.moovin_group);
  if (moovinStatus) {
    if ((row.moovin_incidents ?? 0) >= 1 && !isFinalTrackingStatus(moovinStatus)) {
      // Hubo "Incidencia en la entrega": si el ultimo evento volvio a "En ruta
      // para entregar" (in_progress -> en_route) es un reintento; si el ultimo
      // evento sigue siendo la incidencia (FAILED -> incident) queda como
      // incidencia activa.
      return moovinStatus === "en_route" ? "en_route_retry" : "incident";
    }
    return moovinStatus;
  }

  const forzaStatus = forzaGroupToStatus(row.forza_group);
  if (forzaStatus) {
    if ((row.forza_incidents ?? 0) >= 1 && !isFinalTrackingStatus(forzaStatus)) {
      return forzaStatus === "en_route" ? "en_route_retry" : "incident";
    }
    return forzaStatus;
  }

  if (isFinalTrackingStatus(row.internal_status)) return row.internal_status;

  const boxfulStatus = inferTrackingStatusFromText(row.boxful_status);
  if (isFinalTrackingStatus(boxfulStatus)) return boxfulStatus;

  const settlementStatus = traces.find((trace) => isFinalTrackingStatus(trace.internal_status));
  if (settlementStatus) return settlementStatus.internal_status;

  // Tiene guia (Boxful, liquidacion o el fulfillment de Shopify) = despachado.
  const hasOperationalMovement = row.source !== "shopify" || traces.length > 0 || Boolean(row.guide_number);
  if (isShopifyCancelled(row) && !hasOperationalMovement) return "annulled";
  // Con guia/courier (movimiento logistico) y sin estado final = en reparto.
  if (hasOperationalMovement) return "en_route";

  return "pending";
}

// "Pendiente operativo" para agregaciones: incluye en ruta (despachado pero
// aun sin entregar) y pendiente (sin despachar).
export function isPendingLike(status: string): boolean {
  return (
    status === "pending" ||
    status === "en_route" ||
    status === "en_route_retry" ||
    status === "incident"
  );
}

export function inferTrackingStatusFromText(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes("no entregado") || lower.includes("devuelto")) return "not_delivered";
  if (lower.includes("entregado")) return "delivered";
  return "pending";
}

// getTrackingFilterFromStatus (page.tsx ~9491). Usado por el score de
// consolidacion de filas logisticas y por el filtro de estado de la ruta
// orders/.
export function getTrackingFilterFromStatus(status: string): Exclude<OrderTrackingFilter, "all"> {
  if (status === "annulled") return "annulled";
  if (status === "delivered") return "delivered";
  if (status === "not_delivered" || status === "returned") return "not_delivered";
  if (status === "en_route") return "en_route";
  if (status === "en_route_retry") return "en_route_retry";
  if (status === "incident") return "incident";
  return "pending";
}

export function isFinalTrackingStatus(status: string): boolean {
  return status === "delivered" || status === "not_delivered" || status === "returned";
}

// Mapea el ultimo grupo de Moovin al estado de seguimiento. Vacio si no hay
// dato de Moovin (cae a la logica de Boxful/sistema).
export function moovinGroupToStatus(group: string | undefined): string {
  switch (group) {
    case "delivered":
      return "delivered";
    case "returned":
      return "not_delivered";
    case "failed":
      return "incident";
    case "in_progress":
      return "en_route";
    default:
      return "";
  }
}

export function forzaGroupToStatus(group: string | undefined): string {
  switch (group) {
    case "delivered":
      return "delivered";
    case "returned":
      return "not_delivered";
    case "failed":
      return "incident";
    case "in_progress":
      return "en_route";
    default:
      return "";
  }
}

// Cuenta las incidencias de entrega ("Incidencia en la entrega", codigo FAILED)
// de Moovin. Con >=1 incidencia sin cierre final: queda como "Incidencia" si el
// ultimo evento sigue siendo la incidencia, o como "Reintento" si el ultimo
// evento volvio a "En ruta para entregar" (ver getEffectiveTrackingStatus).
export function countMoovinIncidents(events: MoovinTrackingRow["events"] | undefined): number {
  if (!events?.length) return 0;
  return events.filter(
    (event) =>
      String(event.code ?? "").toUpperCase() === "FAILED" ||
      String(event.title ?? "").toLowerCase().includes("incidencia en la entrega")
  ).length;
}

export function countForzaIncidents(events: ForzaTrackingRow["events"] | undefined): number {
  if (!events?.length) return 0;
  return events.filter((event) => {
    const text = `${event.code ?? ""} ${event.title ?? ""} ${event.description ?? ""}`.toLowerCase();
    return text.includes("fall") || text.includes("incid") || text.includes("no entreg");
  }).length;
}

// Reclasifica el ultimo estado de Moovin corrigiendo cache viejo: "Cancelado"
// (p.ej. supera intentos de entrega) quedaba como en ruta y debe ser No
// entregado. Los demas estados conservan su grupo ya calculado.
export function deriveMoovinGroup(row: MoovinTrackingRow | undefined): string {
  if (!row) return "";
  const code = String(row.latest_code ?? "").toUpperCase();
  const title = String(row.latest_status ?? "").toLowerCase();
  if (code.startsWith("CANCEL") || title.includes("cancelado")) return "returned";
  return row.latest_group ?? "";
}

export function deriveForzaGroup(row: ForzaTrackingRow | undefined): string {
  if (!row) return "";
  return row.latest_group ?? "";
}

export function isShopifyCancelled(row: ShopifyCancelledSource): boolean {
  return Boolean(row.shopify_cancelled_at || row.shopify_financial_status === "voided");
}

// Busqueda libre sobre una fila (order_name / guia / numero / cliente / nota /
// productos). Copiado VERBATIM de matchesOrderSearch (page.tsx ~9380).
export function matchesOrderSearch(row: TrackableOrderRow, query: string): boolean {
  const rawQuery = query.trim().toLowerCase();
  const compactQuery = normalizeSearchText(query);
  if (!rawQuery && !compactQuery) return true;

  const values = [
    row.order_name,
    row.shopify_order_name,
    row.shopify_order_number ? String(row.shopify_order_number) : "",
    row.shopify_order_number ? `#MCRC${row.shopify_order_number}` : "",
    row.guide_number,
    row.customer_name,
    row.shopify_note ?? "",
    ...(row.package_items ?? []).flatMap((item) => [item.sku ?? "", item.title]),
  ];

  return values.some((value) => {
    const text = String(value || "").toLowerCase();
    const compactText = normalizeSearchText(String(value || ""));
    return Boolean(
      (rawQuery && text.includes(rawQuery)) ||
      (compactQuery && compactText.includes(compactQuery))
    );
  });
}

// ---------------------------------------------------------------------------
// Helpers nuevos para uso server-side
// ---------------------------------------------------------------------------

export interface EnRouteGuides {
  moovin: Array<{ idPackage: string; lastName: string }>;
  forza: Array<{ guide: string }>;
}

// Guias no terminales (en ruta / incidencia / pendiente) que vale la pena
// refrescar contra el courier. Replica enRouteMoovinGuides / enRouteForzaGuides
// de OrdersTab (page.tsx ~1640-1667). Como `forza_group` ya viene de
// deriveForzaGroup(cached), no hace falta el mapa de Forza aqui. Se calcula sobre
// el dataset COMPLETO (los botones de sync no dependen de la paginacion).
export function buildEnRouteGuides(
  rows: TrackableOrderRow[],
  settlementTraceByKey: Map<string, SettlementTrace[]>,
  store: FinanceStorePublic
): EnRouteGuides {
  const isOpenStatus = (status: string) =>
    status === "en_route" || status === "en_route_retry" || status === "incident" || status === "pending";

  // Resolucion por fila: cada guia se enruta a su transportadora. En tiendas
  // mono-transportadora (todas las actuales) equivale al comportamiento anterior
  // (solo se considera la transportadora de la tienda); en tiendas con varias,
  // cada fila cae en el bucket que le corresponde.
  const carriers = getStoreCarriers(store);
  const usesMoovin = carriers.includes("moovin");
  const usesForza = carriers.includes("forza");
  const moovinByGuide = new Map<string, { idPackage: string; lastName: string }>();
  const forzaByGuide = new Map<string, { guide: string }>();

  for (const row of rows) {
    if (!row.guide_number) continue;
    const status = getEffectiveTrackingStatus(row, getSettlementTracesForLogisticsRow(row, settlementTraceByKey));
    if (!isOpenStatus(status)) continue;

    if (
      usesMoovin &&
      rowMatchesCarrier("moovin", { displayCourier: row.courier, rawCourier: row.courier, guide: row.guide_number, store })
    ) {
      if (!moovinByGuide.has(row.guide_number)) {
        moovinByGuide.set(row.guide_number, { idPackage: row.guide_number, lastName: row.last_name ?? "" });
      }
    }

    if (
      usesForza &&
      rowMatchesCarrier("forza", { displayCourier: row.courier, rawCourier: row.courier, guide: row.guide_number, store })
    ) {
      const guide = normalizeGuideForStore(row.guide_number, store);
      if (guide && row.forza_group !== "delivered" && row.forza_group !== "returned" && !forzaByGuide.has(guide)) {
        forzaByGuide.set(guide, { guide });
      }
    }
  }

  return { moovin: Array.from(moovinByGuide.values()), forza: Array.from(forzaByGuide.values()) };
}


// Mapea un pedido persistido (forma de listPersistedShopifyOrders / del endpoint)
// a ShopifyOrderSummary. Copiado VERBATIM de persistedOrderToSummary (page.tsx
// ~7840); el unico cambio es exportarlo desde el modulo compartido.
export function persistedOrderToSummary(order: Record<string, unknown>): ShopifyOrderSummary {
  // El endpoint ya resuelve lineas y notas; raw_order queda solo como
  // respaldo por si llega una respuesta vieja cacheada.
  const rawOrder = (order.raw_order as Record<string, unknown> | null) ?? {};
  const columnLineItems = (order.line_items as ShopifyOrderSummary["line_items"]) ?? [];
  const rawLineItems = ((rawOrder.line_items as Array<Record<string, unknown>>) ?? []).map((item) => ({
    sku: String(item.sku ?? ""),
    title: String(item.title ?? ""),
    quantity: Number(item.quantity ?? 0),
    price: Number(item.price ?? 0),
  }));
  const lineItems = columnLineItems.length ? columnLineItems : rawLineItems;
  const noteAttributes =
    (order.note_attributes as ShopifyOrderSummary["note_attributes"]) ??
    (rawOrder.note_attributes as ShopifyOrderSummary["note_attributes"]) ??
    [];
  return {
    id: String(order.shopify_order_id ?? order.id ?? ""),
    order_number: Number(order.order_number ?? 0),
    name: String(order.name ?? ""),
    customer_name: String(order.customer_name ?? "Sin nombre"),
    last_name: String(order.last_name ?? ""),
    phone: (order.phone as string | null) ?? null,
    products: lineItems.map((item) => `${item.quantity}x ${item.title}`).join(", "),
    total: `${order.total_price ?? 0} ${order.currency ?? "CRC"}`,
    total_price: Number(order.total_price ?? 0),
    currency: String(order.currency ?? "CRC"),
    financial_status: String(order.financial_status ?? ""),
    fulfillment_status: String(order.fulfillment_status ?? ""),
    cancelled_at: (order.cancelled_at as string | null) ?? null,
    tracking_number: String(order.tracking_number ?? ""),
    tracking_company: String(order.tracking_company ?? ""),
    note: String(order.note ?? rawOrder.note ?? ""),
    note_attributes: noteAttributes,
    created_at: String(order.shopify_created_at ?? ""),
    line_items: lineItems,
  };
}

// Enriquece las filas de liquidacion con el match de Shopify. Copiado VERBATIM
// de enrichSettlementRowsWithShopify (page.tsx ~8313). En la UI las llaves del
// trace map se construyen sobre las filas YA enriquecidas (shopify_order_name
// resuelto), por lo que las rutas server-side deben aplicar esta funcion antes
// de buildSettlementTraceMap para que las llaves coincidan exactamente.
export function enrichSettlementRowsWithShopify(
  rows: SettlementRow[],
  shopifyOrders: ShopifyOrderSummary[]
): SettlementRow[] {
  if (!rows.length || !shopifyOrders.length) return rows;

  const shopifyByMatchKey = buildShopifyMatchIndex(shopifyOrders);
  return rows.map((row) => {
    const shopify = findShopifyOrderForRow(
      {
        order_name: row.order_name,
        shopify_order_name: row.shopify_order_name,
      },
      shopifyByMatchKey
    );
    if (!shopify) return row;

    return {
      ...row,
      match_status: "matched",
      shopify_order_id: shopify.id,
      shopify_order_name: shopify.name,
      shopify_financial_status: shopify.financial_status,
      shopify_fulfillment_status: shopify.fulfillment_status ?? "",
      shopify_total: Number(shopify.total_price || parseMoneyText(shopify.total)),
      shopify_created_at: shopify.created_at,
      order_items: row.order_items?.length
        ? row.order_items
        : shopify.line_items.map((item): SettlementOrderItem => ({
            sku: String(item.sku ?? "").toLowerCase(),
            title: String(item.title ?? ""),
            quantity: Number(item.quantity || 0),
            price: Number(item.price || 0),
          })),
    };
  });
}

// Construye el indice clave -> trazas de liquidacion. Replica VERBATIM
// buildSettlementTraceByKey + addSettlementTrace (page.tsx ~9234-9273). La page
// arma `fileByImportId` desde los imports para el nombre de archivo; aqui los
// imports son opcionales (los KPIs/estados solo dependen de internal_status,
// amount_to_liquidate y settlement_status). Sin imports cae a "Import #<id>".
export function buildSettlementTraceMap(
  settlementRows: SettlementRow[],
  imports: Array<{ id: number; file_name: string }> = []
): Map<string, SettlementTrace[]> {
  const fileByImportId = new Map(imports.map((item) => [item.id, item.file_name]));
  const traceByKey = new Map<string, SettlementTrace[]>();

  for (const row of settlementRows) {
    const trace: SettlementTrace = {
      file_name: fileByImportId.get(row.import_id) || `Import #${row.import_id}`,
      amount_to_liquidate: row.amount_to_liquidate,
      settlement_status: row.settlement_status,
      internal_status: row.internal_status,
    };
    addSettlementTrace(traceByKey, normalizeMatchKey(row.order_name || row.shopify_order_name), trace);
    addSettlementTrace(traceByKey, normalizeMatchKey(row.guide_number), trace);
  }

  return traceByKey;
}

function addSettlementTrace(
  traceByKey: Map<string, SettlementTrace[]>,
  key: string,
  trace: SettlementTrace
) {
  if (!key) return;
  const existing = traceByKey.get(key) ?? [];
  if (
    existing.some(
      (item) =>
        item.file_name === trace.file_name &&
        item.amount_to_liquidate === trace.amount_to_liquidate &&
        item.settlement_status === trace.settlement_status
    )
  ) {
    return;
  }
  traceByKey.set(key, [...existing, trace]);
}

// ---------------------------------------------------------------------------
// Liquidaciones — alertas de cobro y anomalias (Carril 2 — tab Liquidaciones)
// Movido VERBATIM desde app/admin/finance/page.tsx para que la ruta
// settlements-view/ las calcule server-side y el navegador deje de cargar el
// snapshot (~11k pedidos + logistica completa).
// ---------------------------------------------------------------------------

// Entregados sin liquidar ("por reclamar"): filas de logistica con
// internal_status === "delivered" cuya orden/guia NO aparece en ninguna fila de
// liquidacion. Copiado VERBATIM de getDeliveredWithoutSettlement (page.tsx).
export function getDeliveredWithoutSettlement(
  logisticsRows: LogisticsRow[],
  settlementRows: SettlementRow[]
): LogisticsRow[] {
  const settledOrderKeys = new Set<string>();
  const settledGuideKeys = new Set<string>();

  for (const row of settlementRows) {
    const orderKey = normalizeMatchKey(row.order_name || row.shopify_order_name);
    const guideKey = normalizeMatchKey(row.guide_number);
    if (orderKey) settledOrderKeys.add(orderKey);
    if (guideKey) settledGuideKeys.add(guideKey);
  }

  return logisticsRows.filter((row) => {
    if (row.internal_status !== "delivered") return false;
    const orderKey = normalizeMatchKey(row.order_name || row.shopify_order_name);
    const guideKey = normalizeMatchKey(row.guide_number);
    return !((orderKey && settledOrderKeys.has(orderKey)) || (guideKey && settledGuideKeys.has(guideKey)));
  });
}

// Doble liquidacion: claves (orden/guia) con >=2 trazas distintas. Copiado
// VERBATIM de getDoubleSettlementAnomalies (page.tsx). El trace map debe venir de
// buildSettlementTraceMap sobre las filas YA enriquecidas con Shopify.
export function getDoubleSettlementAnomalies(
  settlementTraceByKey: Map<string, SettlementTrace[]>
): DoubleSettlementAnomaly[] {
  const anomalies: DoubleSettlementAnomaly[] = [];

  for (const [key, traces] of Array.from(settlementTraceByKey.entries())) {
    const uniqueTraces = uniqueSettlementTraces(traces);
    if (uniqueTraces.length < 2) continue;

    anomalies.push({
      key,
      kind: /^\d{6,}$/.test(key) ? "guide" : "order",
      traces: uniqueTraces,
    });
  }

  return anomalies
    .sort((a, b) => b.traces.length - a.traces.length || a.key.localeCompare(b.key))
    .slice(0, 250);
}

function uniqueSettlementTraces(traces: SettlementTrace[]): SettlementTrace[] {
  const seen = new Set<string>();
  const unique: SettlementTrace[] = [];
  for (const trace of traces) {
    const key = `${trace.file_name}|${trace.amount_to_liquidate}|${trace.settlement_status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trace);
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Centro de control / Rentabilidad / Cierre mensual / Notas (Carril 2 inc.2)
// Movido VERBATIM desde app/admin/finance/page.tsx para que las rutas
// product-analysis/, monthly-close/ y notes/ lo usen sin que el navegador
// cargue el snapshot completo (~11k pedidos). Las funciones-hoja compartidas
// (currency, money, roundMoney, daysSince, getMonthKey, cleanProductTitle,
// getProductTitleCostKey, getProductItemCostKey, getTrackingStatusLabel,
// UNKNOWN_PRODUCT_LABEL) se mantienen tambien en page.tsx para la UI; el
// de-duplicado es un paso posterior.
// ---------------------------------------------------------------------------

export type FinancialAnomalySeverity = "high" | "medium" | "low";

export interface OrderProfitabilityRow {
  order_key: string;
  order_name: string;
  guide_number: string;
  customer_name: string;
  source: "shopify" | "boxful" | "liquidacion";
  shopify_cancelled_at: string | null;
  shopify_financial_status: string;
  tracking_status: string;
  tracking_label: string;
  settlement_status: string;
  settlement_files: string[];
  settlement_count: number;
  settlement_charged_costs: number;
  settlement_cod_commission: number;
  settlement_card_commission: number;
  settlement_delivery_cost: number;
  settlement_pick_pack_cost: number;
  settlement_packaging_cost: number;
  amount_to_liquidate: number;
  expected_cod: number;
  order_value: number;
  product_cost: number;
  contribution_margin: number;
  missing_cost_skus: string[];
  items: ProductLineItem[];
  items_summary: string;
  cash_status: "cobrado" | "por_cobrar" | "sin_caja";
  issue_count: number;
  created_at: string | null;
  days_since_order: number | null;
  delivered_on: string | null;
}

export interface ProductAnalysisRow {
  key: string;
  product_name: string;
  sku: string;
  sample_orders: string[];
  orders: number;
  units: number;
  dispatched: number;
  dispatch_rate: number;
  delivery_effectiveness: number;
  delivered: number;
  not_delivered: number;
  annulled: number;
  pending: number;
}

export interface FinancialAnomaly {
  id: string;
  severity: FinancialAnomalySeverity;
  type: string;
  order_name: string;
  guide_number: string;
  amount: number;
  source_file: string;
  message: string;
  action: string;
}

export interface FinanceControlCenter {
  orders: OrderProfitabilityRow[];
  anomalies: FinancialAnomaly[];
  cash_received: number;
  cash_pending: number;
  contribution_margin: number;
  missing_cost_count: number;
}

export interface MonthlyCloseRow {
  month: string;
  orders: number;
  delivered: number;
  not_delivered: number;
  annulled: number;
  pending: number;
  settled: number;
  unsettled: number;
  to_claim: number;
  to_claim_fresh: number;
  to_claim_overdue: number;
  duplicate_settlements: number;
  boxful_costs: number;
  boxful_cod_commission: number;
  boxful_card_commission: number;
  boxful_delivery_cost: number;
  boxful_pick_pack_cost: number;
  boxful_packaging_cost: number;
  cash_received: number;
  cash_pending: number;
  product_costs: number;
  ads: number;
  payroll: number;
  misc: number;
  contribution_margin: number;
  net_profit: number;
  misc_software: number;
  misc_other: number;
}

export interface ShopifyNoteAliasRow {
  row_key: string;
  shopify_order_name: string;
  note_order_number: string;
  note: string;
  created_at: string;
}

const UNKNOWN_PRODUCT_LABEL = "Producto sin registrar";

function currency(value: number, store = FINANCE_STORES[0]): string {
  return new Intl.NumberFormat(store.locale, {
    style: "currency",
    currency: store.currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function money(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundMoney(value: number): number {
  return money(value);
}

function daysSince(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  const diff = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function getMonthKey(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 7);
}

function cleanProductTitle(title: string): string {
  return String(title || UNKNOWN_PRODUCT_LABEL)
    .replace(/^\s*\d+\s*x\s*/i, "")
    .trim() || UNKNOWN_PRODUCT_LABEL;
}

function looksLikeSkuOnly(value: string): boolean {
  const text = value.trim();
  return Boolean(text && !/\s/.test(text) && /^[a-z0-9._-]{3,}$/i.test(text));
}

function getProductTitleCostKey(title: string): string {
  const cleanTitle = cleanProductTitle(title);
  if (!cleanTitle || cleanTitle === UNKNOWN_PRODUCT_LABEL) return "";
  const slug = cleanTitle
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug ? `producto:${slug}` : "";
}

function getProductItemCostKey(item: Pick<ProductLineItem, "sku" | "title">): string {
  const sku = String(item.sku || "").trim().toLowerCase();
  if (sku) return sku;
  return getProductTitleCostKey(item.title);
}

function parseItemsSummary(summary: string): ProductLineItem[] {
  return String(summary || "")
    .split(/\s*,\s*/)
    .map((part): ProductLineItem | null => {
      const trimmed = part.trim();
      if (!trimmed) return null;

      const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*x\s+(.+)$/i);
      const quantity = match ? Math.max(1, Number(match[1] || 1)) : 1;
      const title = cleanProductTitle(match?.[2] ?? trimmed);
      if (!title || title === UNKNOWN_PRODUCT_LABEL) return null;

      return {
        sku: looksLikeSkuOnly(title) ? title.toLowerCase() : "",
        title,
        quantity,
        price: 0,
      };
    })
    .filter((item): item is ProductLineItem => Boolean(item));
}

function getProductAnalysisItems(order: OrderProfitabilityRow): ProductLineItem[] {
  if (order.items.length) return order.items;
  const parsedSummaryItems = parseItemsSummary(order.items_summary);
  if (parsedSummaryItems.length) return parsedSummaryItems;
  return [{ title: UNKNOWN_PRODUCT_LABEL, quantity: 1, price: 0 }];
}

function normalizeProductLineItem(item: ProductLineItem): { key: string; sku: string; title: string; quantity: number } {
  const sku = String(item.sku ?? "").trim();
  const title = cleanProductTitle(item.title || sku || UNKNOWN_PRODUCT_LABEL);
  const titleKey = getProductTitleCostKey(title);
  const key = titleKey || (sku ? `sku:${sku.toLowerCase()}` : `title:${title.toLowerCase()}`);
  return {
    key,
    sku,
    title,
    quantity: Math.max(1, Number(item.quantity || 1)),
  };
}

function hasBoxfulGuide(order: Pick<OrderProfitabilityRow, "guide_number">): boolean {
  const guide = String(order.guide_number || "").trim();
  return Boolean(guide && guide !== "-" && guide !== "0");
}

function isShopifyProductAnalysisOrder(
  order: Pick<
    OrderProfitabilityRow,
    "source" | "order_name" | "shopify_financial_status" | "shopify_cancelled_at" | "created_at"
  >
): boolean {
  if (order.source === "shopify") return true;
  if (order.shopify_financial_status || order.shopify_cancelled_at || order.created_at) return true;
  return /^#?MCRC/i.test(order.order_name);
}

function getProductOrderAnalysisStatus(
  row: Pick<OrderProfitabilityRow, "tracking_status" | "shopify_cancelled_at" | "shopify_financial_status">
): "pending" | "annulled" | "delivered" | "not_delivered" {
  if (isShopifyCancelled(row)) return "annulled";
  if (row.tracking_status === "delivered") return "delivered";
  if (row.tracking_status === "not_delivered" || row.tracking_status === "returned") return "not_delivered";
  return "pending";
}

function buildSettlementRowsByKey(settlementRows: SettlementRow[]): Map<string, SettlementRow[]> {
  const rowsByKey = new Map<string, SettlementRow[]>();
  for (const row of settlementRows) {
    for (const key of uniqueKeys([
      normalizeMatchKey(row.order_name),
      normalizeMatchKey(row.shopify_order_name),
      normalizeMatchKey(row.guide_number),
    ])) {
      rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
    }
  }
  return rowsByKey;
}

function getMatchedSettlementRowsForOrder(
  order: TrackableOrderRow,
  rowsByKey: Map<string, SettlementRow[]>
): SettlementRow[] {
  const seen = new Set<number>();
  const matches: SettlementRow[] = [];
  const keys = uniqueKeys([
    ...getOrderMatchKeys(order),
    normalizeMatchKey(order.guide_number),
  ]);

  for (const key of keys) {
    for (const row of rowsByKey.get(key) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      matches.push(row);
    }
  }

  return matches;
}

function getProfitabilityItems(
  order: TrackableOrderRow,
  settlementRows: SettlementRow[]
): Array<{ sku?: string; title: string; quantity: number; price: number }> {
  const settlementItems = settlementRows.flatMap((row) => row.order_items ?? []);
  if (settlementItems.length) return settlementItems;
  return order.package_items ?? [];
}

function buildCostVersionsBySku(
  costs: ProductCost[],
  versions: ProductCostVersion[]
): Map<string, ProductCostVersion[]> {
  const bySku = new Map<string, ProductCostVersion[]>();
  const allVersions: ProductCostVersion[] = [
    ...versions,
    ...costs
      .filter((cost) => cost.active)
      .map((cost) => ({
        id: -cost.id,
        store_id: cost.store_id,
        sku: cost.sku,
        product_name: cost.product_name,
        unit_cost: cost.unit_cost,
        packaging_cost: cost.packaging_cost,
        currency: cost.currency,
        effective_from: cost.effective_from || "1900-01-01",
        created_at: "",
      })),
  ];

  for (const version of allVersions) {
    const key = version.sku.toLowerCase();
    bySku.set(key, [...(bySku.get(key) ?? []), version]);

    const titleKey = getProductTitleCostKey(version.product_name);
    if (titleKey && titleKey !== key) bySku.set(titleKey, [...(bySku.get(titleKey) ?? []), version]);
  }

  for (const [sku, skuVersions] of Array.from(bySku.entries())) {
    bySku.set(
      sku,
      skuVersions.sort((a, b) =>
        b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at)
      )
    );
  }
  return bySku;
}

function pickCostVersion(versions: ProductCostVersion[], orderDate: string | null): ProductCostVersion | undefined {
  if (!versions.length) return undefined;
  const date = (orderDate || new Date().toISOString()).slice(0, 10);
  return versions.find((version) => version.effective_from <= date) ?? versions[versions.length - 1];
}

function calculateProductCost(
  items: Array<{ sku?: string; title: string; quantity: number; price: number }>,
  costVersionsBySku: Map<string, ProductCostVersion[]>,
  trackingStatus: string,
  orderDate: string | null
): { productCost: number; missingCostSkus: string[] } {
  if (trackingStatus !== "delivered") return { productCost: 0, missingCostSkus: [] };

  const missingCostSkus = new Set<string>();
  let productCost = 0;

  for (const item of items) {
    const costKey = getProductItemCostKey(item);
    if (!costKey) continue;
    const cost = pickCostVersion(costVersionsBySku.get(costKey) ?? [], orderDate);
    if (!cost) {
      missingCostSkus.add(costKey);
      continue;
    }
    productCost += (Number(cost.unit_cost || 0) + Number(cost.packaging_cost || 0)) * Number(item.quantity || 0);
  }

  return {
    productCost: roundMoney(productCost),
    missingCostSkus: Array.from(missingCostSkus),
  };
}

function shouldFlagNegativeMargin(contributionMargin: number, settlementCodAmount: number): boolean {
  if (contributionMargin >= 0) return false;
  return settlementCodAmount > 0;
}

function summarizeItems(items: Array<{ sku?: string; title: string; quantity: number }>): string {
  return items
    .slice(0, 2)
    .map((item) => `${item.quantity || 1}x ${item.sku || item.title}`)
    .join(", ");
}

function getTrackingStatusLabel(
  row: Pick<TrackableOrderRow, "internal_status" | "boxful_status" | "moovin_incidents" | "forza_incidents">,
  traces: SettlementTrace[],
  status: string
): string {
  if (status === "annulled") return "Anulado";
  if (isFinalTrackingStatus(row.internal_status)) {
    return status === "not_delivered" || status === "returned" ? "No entregado" : row.boxful_status || "Entregado";
  }

  const settlementTrace = traces.find((trace) => trace.internal_status === status);
  if (settlementTrace?.settlement_status) return settlementTrace.settlement_status;
  if (status === "delivered") return "Entregado";
  if (status === "not_delivered" || status === "returned") return "No entregado";
  if (status === "en_route") return row.boxful_status || "En ruta";
  if (status === "en_route_retry") {
    const retries = Math.max(row.moovin_incidents ?? 0, row.forza_incidents ?? 0, 1);
    return retries > 1 ? `Reintento (${retries})` : "Reintento";
  }
  if (status === "incident") return "Incidencia";
  return "Pendiente";
}

function buildOrderProfitabilityRow({
  order,
  settlementRows,
  fileByImportId,
  costVersionsBySku,
  trackingStatus,
  trackingLabel,
}: {
  order: TrackableOrderRow;
  settlementRows: SettlementRow[];
  fileByImportId: Map<number, string>;
  costVersionsBySku: Map<string, ProductCostVersion[]>;
  trackingStatus: string;
  trackingLabel: string;
}): OrderProfitabilityRow {
  const settlementFiles = uniqueKeys(
    settlementRows.map((row) => fileByImportId.get(row.import_id) || `Import #${row.import_id}`)
  );
  const settlementStatuses = uniqueKeys(settlementRows.map((row) => row.settlement_status || row.internal_status));
  const amountToLiquidate = sum(settlementRows.map((row) => row.amount_to_liquidate));
  const settlementCodCommission = sum(settlementRows.map((row) => Number(row.cod_commission || 0)));
  const settlementCardCommission = sum(settlementRows.map((row) => Number(row.card_commission || 0)));
  const settlementDeliveryCost = sum(settlementRows.map((row) => Number(row.delivery_cost || 0)));
  const settlementPickPackCost = sum(settlementRows.map((row) => Number(row.pick_pack_cost || 0)));
  const settlementPackagingCost = sum(settlementRows.map((row) => Number(row.packaging_cost || 0)));
  const settlementChargedCosts =
    settlementCodCommission +
    settlementCardCommission +
    settlementDeliveryCost +
    settlementPickPackCost +
    settlementPackagingCost;
  const settlementCodAmount = sum(settlementRows.map((row) => row.cod_amount));
  const expectedCod = order.cod_amount || sum(settlementRows.map((row) => row.cod_amount));
  const items = getProfitabilityItems(order, settlementRows);
  const orderValue =
    sum(items.map((item) => Number(item.price || 0) * Number(item.quantity || 0))) || expectedCod;
  const productCostResult = calculateProductCost(items, costVersionsBySku, trackingStatus, order.shopify_created_at);
  const hasSettlement = settlementRows.length > 0;
  const shopifyCancelledWithMovement = isShopifyCancelled(order) && (order.source !== "shopify" || hasSettlement);
  const cashStatus =
    hasSettlement ? "cobrado" : trackingStatus === "delivered" ? "por_cobrar" : "sin_caja";

  const issueCount =
    (trackingStatus === "delivered" && !hasSettlement ? 1 : 0) +
    (settlementRows.length > 1 ? 1 : 0) +
    (shopifyCancelledWithMovement ? 1 : 0) +
    (productCostResult.missingCostSkus.length ? 1 : 0) +
    (shouldFlagNegativeMargin(amountToLiquidate - productCostResult.productCost, settlementCodAmount) ? 1 : 0);

  return {
    order_key: order.row_key,
    order_name: order.order_name || order.shopify_order_name,
    guide_number: order.guide_number,
    customer_name: order.customer_name,
    source: order.source,
    shopify_cancelled_at: order.shopify_cancelled_at,
    shopify_financial_status: order.shopify_financial_status,
    tracking_status: trackingStatus,
    tracking_label: trackingLabel,
    settlement_status: settlementStatuses.join(", ") || "Sin liquidacion",
    settlement_files: settlementFiles,
    settlement_count: settlementRows.length,
    settlement_charged_costs: roundMoney(settlementChargedCosts),
    settlement_cod_commission: roundMoney(settlementCodCommission),
    settlement_card_commission: roundMoney(settlementCardCommission),
    settlement_delivery_cost: roundMoney(settlementDeliveryCost),
    settlement_pick_pack_cost: roundMoney(settlementPickPackCost),
    settlement_packaging_cost: roundMoney(settlementPackagingCost),
    amount_to_liquidate: roundMoney(amountToLiquidate),
    expected_cod: roundMoney(expectedCod),
    order_value: roundMoney(orderValue),
    product_cost: productCostResult.productCost,
    contribution_margin: roundMoney(amountToLiquidate - productCostResult.productCost),
    missing_cost_skus: productCostResult.missingCostSkus,
    items,
    items_summary: summarizeItems(items),
    cash_status: cashStatus,
    issue_count: issueCount,
    created_at: order.shopify_created_at,
    days_since_order: order.shopify_created_at ? daysSince(order.shopify_created_at) : null,
    delivered_on: order.finalized_on ?? null,
  };
}

function buildFinancialAnomalies(
  row: OrderProfitabilityRow,
  settlementRows: SettlementRow[]
): FinancialAnomaly[] {
  const anomalies: FinancialAnomaly[] = [];
  const hasSettlement = settlementRows.length > 0;
  const sourceFile = row.settlement_files[0] ?? "";

  if (row.tracking_status === "delivered" && !hasSettlement) {
    anomalies.push({
      id: `${row.order_key}-delivered-without-settlement`,
      severity: "high",
      type: "Entregado sin liquidacion",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.expected_cod,
      source_file: sourceFile,
      message: "Boxful/seguimiento indica entregado pero no aparece en liquidacion.",
      action: "Reclamar liquidacion a Boxful y revisar el corte faltante.",
    });
  }

  if (settlementRows.length > 1) {
    anomalies.push({
      id: `${row.order_key}-duplicate-settlement`,
      severity: "high",
      type: "Doble liquidacion",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: `El pedido aparece ${settlementRows.length} veces en liquidaciones.`,
      action: "Validar que no exista cobro duplicado o archivo repetido.",
    });
  }

  if (hasSettlement && row.tracking_status !== "delivered" && settlementRows.some((item) => item.internal_status === "delivered")) {
    anomalies.push({
      id: `${row.order_key}-settlement-without-delivery`,
      severity: "medium",
      type: "Liquidado sin entrega confirmada",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: "Liquidacion reporta entregado pero seguimiento no esta entregado.",
      action: "Comparar Boxful logistico contra liquidacion y corregir estado.",
    });
  }

  const shopifyCancelledWithMovement = isShopifyCancelled(row) && (row.source !== "shopify" || hasSettlement);
  if (shopifyCancelledWithMovement) {
    anomalies.push({
      id: `${row.order_key}-cancelled-with-movement`,
      severity: row.tracking_status === "delivered" ? "high" : "medium",
      type: "Anulado Shopify con movimiento",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: "Shopify indica anulado/cancelado, pero Boxful o liquidacion muestran movimiento operativo.",
      action: "No tratar como anulado puro; seguir estado Boxful. Si se entrego, contabilizar caja/margen; si no se entrego, reconocer costos logisticos.",
    });
  }

  if (row.missing_cost_skus.length) {
    anomalies.push({
      id: `${row.order_key}-missing-cost`,
      severity: "medium",
      type: "SKU sin costo",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: `Falta costo para ${row.missing_cost_skus.join(", ")}.`,
      action: "Completar costo unitario/empaque en Costos SKU para cerrar margen.",
    });
  }

  const settlementCodAmount = sum(settlementRows.map((item) => item.cod_amount));

  if (hasSettlement && shouldFlagNegativeMargin(row.contribution_margin, settlementCodAmount)) {
    anomalies.push({
      id: `${row.order_key}-negative-margin`,
      severity: "medium",
      type: "Margen negativo",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.contribution_margin,
      source_file: sourceFile,
      message: `El pedido queda con margen ${currency(row.contribution_margin)} antes de ads/planilla.`,
      action: "Revisar precio, costo SKU, cobros logisticos y promociones.",
    });
  }

  if (row.source === "shopify" && row.tracking_status === "pending" && Number(row.days_since_order ?? 0) >= 2) {
    anomalies.push({
      id: `${row.order_key}-shopify-without-boxful`,
      severity: "low",
      type: "Shopify sin Boxful",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.expected_cod,
      source_file: sourceFile,
      message: "Pedido Shopify sigue sin guia Boxful despues de 2 dias.",
      action: "Confirmar si se despacho, si falta importar el archivo logistico o si fue anulado manualmente.",
    });
  }

  return anomalies;
}

function buildOrphanSettlementAnomaly(
  row: SettlementRow,
  fileByImportId: Map<number, string>
): FinancialAnomaly {
  const sourceFile = fileByImportId.get(row.import_id) || `Import #${row.import_id}`;
  const orderName = row.shopify_order_name || row.order_name || "-";

  return {
    id: `settlement-${row.id}-without-shopify-order`,
    severity: "high",
    type: "Liquidacion sin pedido Shopify",
    order_name: orderName,
    guide_number: row.guide_number || "-",
    amount: row.amount_to_liquidate,
    source_file: sourceFile,
    message: "Esta fila de liquidacion no se asigno a ningun pedido base Shopify visible.",
    action: "Corregir el match por nota, guia, telefono o cliente. No se contabiliza como pedido hasta que apunte a Shopify.",
  };
}

function uniqueFinancialAnomalies(anomalies: FinancialAnomaly[]): FinancialAnomaly[] {
  const seen = new Set<string>();
  const unique: FinancialAnomaly[] = [];
  for (const anomaly of anomalies) {
    if (seen.has(anomaly.id)) continue;
    seen.add(anomaly.id);
    unique.push(anomaly);
  }
  return unique;
}

function sortAnomalies(a: FinancialAnomaly, b: FinancialAnomaly): number {
  const severityRank = { high: 3, medium: 2, low: 1 };
  return severityRank[b.severity] - severityRank[a.severity] || a.type.localeCompare(b.type);
}

export function buildFinanceControlCenter(
  visibleOrders: TrackableOrderRow[],
  settlementRows: SettlementRow[],
  imports: SettlementImport[],
  costs: ProductCost[],
  costVersions: ProductCostVersion[],
  settlementTraceByKey: Map<string, SettlementTrace[]>
): FinanceControlCenter {
  const fileByImportId = new Map(imports.map((item) => [item.id, item.file_name]));
  const settlementRowsByKey = buildSettlementRowsByKey(settlementRows);
  const costVersionsBySku = buildCostVersionsBySku(costs, costVersions);
  const consumedSettlementIds = new Set<number>();
  const orders: OrderProfitabilityRow[] = [];
  const anomalies: FinancialAnomaly[] = [];

  for (const order of visibleOrders) {
    const matchedSettlementRows = getMatchedSettlementRowsForOrder(order, settlementRowsByKey);
    matchedSettlementRows.forEach((row) => consumedSettlementIds.add(row.id));

    const traces = getSettlementTracesForLogisticsRow(order, settlementTraceByKey);
    const trackingStatus = getEffectiveTrackingStatus(order, traces);
    const trackingLabel = getTrackingStatusLabel(order, traces, trackingStatus);
    const financialRow = buildOrderProfitabilityRow({
      order,
      settlementRows: matchedSettlementRows,
      fileByImportId,
      costVersionsBySku,
      trackingStatus,
      trackingLabel,
    });

    orders.push(financialRow);
    anomalies.push(...buildFinancialAnomalies(financialRow, matchedSettlementRows));
  }

  for (const settlementRow of settlementRows.filter((row) => !consumedSettlementIds.has(row.id))) {
    anomalies.push(buildOrphanSettlementAnomaly(settlementRow, fileByImportId));
  }

  const uniqueAnomalies = uniqueFinancialAnomalies(anomalies).sort(sortAnomalies);
  const sortedOrders = orders.sort((a, b) => {
    if (b.issue_count !== a.issue_count) return b.issue_count - a.issue_count;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });

  return {
    orders: sortedOrders,
    anomalies: uniqueAnomalies,
    cash_received: roundMoney(sum(orders.filter((row) => row.cash_status === "cobrado").map((row) => row.amount_to_liquidate))),
    cash_pending: roundMoney(sum(orders.filter((row) => row.cash_status === "por_cobrar").map((row) => row.expected_cod))),
    contribution_margin: roundMoney(sum(orders.map((row) => row.contribution_margin))),
    missing_cost_count: orders.filter((row) => row.missing_cost_skus.length > 0).length,
  };
}

export function buildProductAnalysisRows(orders: OrderProfitabilityRow[]): ProductAnalysisRow[] {
  const byProduct = new Map<string, ProductAnalysisRow>();

  for (const order of orders) {
    if (!isShopifyProductAnalysisOrder(order)) continue;

    const itemsByProduct = new Map<string, { sku: string; title: string; quantity: number }>();
    const items = getProductAnalysisItems(order);

    for (const item of items) {
      const normalized = normalizeProductLineItem(item);
      const existing = itemsByProduct.get(normalized.key);
      if (existing) {
        existing.quantity += normalized.quantity;
        if (!existing.sku && normalized.sku) existing.sku = normalized.sku;
        continue;
      }
      itemsByProduct.set(normalized.key, {
        sku: normalized.sku,
        title: normalized.title,
        quantity: normalized.quantity,
      });
    }

    const status = getProductOrderAnalysisStatus(order);
    for (const [key, item] of Array.from(itemsByProduct.entries())) {
      const existing = byProduct.get(key) ?? {
        key,
        product_name: item.title,
        sku: item.sku,
        sample_orders: [],
        orders: 0,
        units: 0,
        dispatched: 0,
        dispatch_rate: 0,
        delivery_effectiveness: 0,
        delivered: 0,
        not_delivered: 0,
        annulled: 0,
        pending: 0,
      };

      existing.orders += 1;
      existing.units += item.quantity;
      if (!existing.sku && item.sku) existing.sku = item.sku;
      const sampleOrder = order.order_name || order.guide_number || order.customer_name;
      if (sampleOrder && existing.sample_orders.length < 5 && !existing.sample_orders.includes(sampleOrder)) {
        existing.sample_orders.push(sampleOrder);
      }
      existing[status] += 1;
      if (hasBoxfulGuide(order)) existing.dispatched += 1;
      existing.dispatch_rate = existing.orders ? (existing.dispatched / existing.orders) * 100 : 0;
      existing.delivery_effectiveness = existing.dispatched
        ? (existing.delivered / existing.dispatched) * 100
        : 0;
      byProduct.set(key, existing);
    }
  }

  return Array.from(byProduct.values()).sort(
    (a, b) =>
      b.orders - a.orders ||
      a.delivery_effectiveness - b.delivery_effectiveness ||
      a.product_name.localeCompare(b.product_name)
  );
}

export function buildMonthlyCloseRows(
  orders: OrderProfitabilityRow[],
  expenses: BusinessExpense[]
): MonthlyCloseRow[] {
  const byMonth = new Map<string, MonthlyCloseRow>();
  const ensureMonth = (month: string) => {
    const existing = byMonth.get(month);
    if (existing) return existing;
    const row: MonthlyCloseRow = {
      month,
      orders: 0,
      delivered: 0,
      not_delivered: 0,
      annulled: 0,
      pending: 0,
      settled: 0,
      unsettled: 0,
      to_claim: 0,
      to_claim_fresh: 0,
      to_claim_overdue: 0,
      duplicate_settlements: 0,
      boxful_costs: 0,
      boxful_cod_commission: 0,
      boxful_card_commission: 0,
      boxful_delivery_cost: 0,
      boxful_pick_pack_cost: 0,
      boxful_packaging_cost: 0,
      cash_received: 0,
      cash_pending: 0,
      product_costs: 0,
      ads: 0,
      payroll: 0,
      misc: 0,
      contribution_margin: 0,
      net_profit: 0,
      misc_software: 0,
      misc_other: 0,
    };
    byMonth.set(month, row);
    return row;
  };

  for (const order of orders) {
    const month = getMonthKey(order.created_at) || "sin-fecha";
    const row = ensureMonth(month);
    row.orders += 1;
    if (order.tracking_status === "delivered") row.delivered += 1;
    if (order.tracking_status === "not_delivered" || order.tracking_status === "returned") row.not_delivered += 1;
    if (order.tracking_status === "annulled") row.annulled += 1;
    if (isPendingLike(order.tracking_status)) row.pending += 1;
    if (order.settlement_count === 1) row.settled += 1;
    if (!order.settlement_count) row.unsettled += 1;
    if (order.tracking_status === "delivered" && !order.settlement_count) {
      row.to_claim += 1;
      // <=7 dias desde la entrega: pendiente normal del proximo corte de
      // Boxful; mas alla de eso ya es cobro por reclamar.
      const daysWaiting = daysSince(order.delivered_on ?? order.created_at ?? "");
      if (daysWaiting <= 7) row.to_claim_fresh += 1;
      else row.to_claim_overdue += 1;
    }
    if (order.settlement_count > 1) row.duplicate_settlements += 1;
    if (order.cash_status === "cobrado") row.cash_received += order.amount_to_liquidate;
    if (order.cash_status === "por_cobrar") row.cash_pending += order.expected_cod;
    row.boxful_costs += order.settlement_charged_costs;
    row.boxful_cod_commission += order.settlement_cod_commission;
    row.boxful_card_commission += order.settlement_card_commission;
    row.boxful_delivery_cost += order.settlement_delivery_cost;
    row.boxful_pick_pack_cost += order.settlement_pick_pack_cost;
    row.boxful_packaging_cost += order.settlement_packaging_cost;
    row.product_costs += order.product_cost;
    row.contribution_margin += order.contribution_margin;
  }

  for (const expense of expenses) {
    const month = expense.month || getMonthKey(expense.expense_date) || "sin-fecha";
    const row = ensureMonth(month);
    const amount = Number(expense.amount || 0);
    if (expense.type === "ads") row.ads += amount;
    if (expense.type === "payroll") row.payroll += amount;
    if (expense.type === "misc") {
      row.misc += amount;
      // El desglose Software vs Otros sale de la categoria/descripcion del gasto.
      const descriptor = `${expense.category} ${expense.description} ${expense.platform}`.toLowerCase();
      if (/software|saas|suscrip|app|herramienta/.test(descriptor)) row.misc_software += amount;
      else row.misc_other += amount;
    }
  }

  return Array.from(byMonth.values())
    .map((row) => ({
      ...row,
      cash_received: roundMoney(row.cash_received),
      cash_pending: roundMoney(row.cash_pending),
      boxful_costs: roundMoney(row.boxful_costs),
      boxful_cod_commission: roundMoney(row.boxful_cod_commission),
      boxful_card_commission: roundMoney(row.boxful_card_commission),
      boxful_delivery_cost: roundMoney(row.boxful_delivery_cost),
      boxful_pick_pack_cost: roundMoney(row.boxful_pick_pack_cost),
      boxful_packaging_cost: roundMoney(row.boxful_packaging_cost),
      product_costs: roundMoney(row.product_costs),
      ads: roundMoney(row.ads),
      payroll: roundMoney(row.payroll),
      misc: roundMoney(row.misc),
      contribution_margin: roundMoney(row.contribution_margin),
      net_profit: roundMoney(row.contribution_margin - row.ads - row.payroll - row.misc),
      misc_software: roundMoney(row.misc_software),
      misc_other: roundMoney(row.misc_other),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

export function buildShopifyNoteAliasRows(orders: ShopifyOrderSummary[]): ShopifyNoteAliasRow[] {
  return orders
    .flatMap((order) => {
      const note = getShopifyNoteText(order).trim();
      if (!note) return [];

      const externalCodes = extractExternalOrderCodesFromText(note);
      if (!externalCodes.length) {
        return [{
          row_key: `${order.id}-note`,
          shopify_order_name: order.name,
          note_order_number: "",
          note,
          created_at: order.created_at,
        }];
      }

      return externalCodes.map((code, index) => ({
        row_key: `${order.id}-${code}-${index}`,
        shopify_order_name: order.name,
        note_order_number: code,
        note,
        created_at: order.created_at,
      }));
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}
