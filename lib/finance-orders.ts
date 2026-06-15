// Modulo compartido (puro, sin React) con la logica de ensamblado, estados y
// KPIs de pedidos del dashboard de finanzas. La logica esta copiada VERBATIM
// desde app/admin/finance/page.tsx (Carril 2 incremento 1) para que las rutas
// server-side la usen sin que el navegador tenga que cargar todos los pedidos.
// El de-duplicado contra page.tsx es un paso posterior.

import type { FinanceStorePublic } from "@/lib/store-config";
import type {
  ForzaTrackingRow,
  LogisticsRow,
  MoovinTrackingRow,
  SettlementRow,
} from "@/lib/finance-types";
import {
  buildShopifyMatchIndex,
  findShopifyOrderForRow,
  getOrderMatchKeys,
  getShopifyOrderMatchKeys,
  normalizeMatchKey,
  normalizeSearchText,
  type OrderMatchKeySource,
} from "@/lib/order-matching";

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
// Courier / guia (page.tsx ~2270-2354)
// ---------------------------------------------------------------------------

function isMoovinCourier(courier: string | undefined, store?: FinanceStorePublic): boolean {
  if (store?.logisticsProvider === "forza") return false;
  return String(courier ?? "").toLowerCase().includes("moovin");
}

function isForzaCourier(courier: string | undefined, store?: FinanceStorePublic): boolean {
  if (store?.logisticsProvider === "forza") return Boolean(String(courier ?? "").trim());
  return String(courier ?? "").toLowerCase().includes("forza");
}

// EasySell/Shopify a veces rotula el fulfillment con un valor generico
// ("Transportadora", "Other", etc.) en vez del courier real. La transportadora
// por defecto depende de la tienda: Costa Rica usa Moovin, Honduras usa Forza.
const GENERIC_COURIER_LABELS = new Set([
  "",
  "transportadora",
  "transportista",
  "other",
  "otra",
  "custom",
  "manual",
  "n/a",
  "na",
  "none",
  "easysell",
]);

function getDefaultCourierForStore(store: FinanceStorePublic): string {
  return store.logisticsProvider === "forza" ? "Forza" : "Moovin";
}

function normalizeShopifyCourier(rawCompany: string | undefined, store: FinanceStorePublic): string {
  const company = String(rawCompany ?? "").trim();
  const lower = company.toLowerCase();
  if (GENERIC_COURIER_LABELS.has(lower)) return getDefaultCourierForStore(store);
  if (store.logisticsProvider === "forza") {
    if (lower.includes("forza") || lower.includes("moovin")) return "Forza";
  }
  if (store.logisticsProvider === "moovin" && lower.includes("moovin")) return "Moovin";
  return company;
}

function normalizeOperationalCourier(
  rawCompany: string | undefined,
  store: FinanceStorePublic,
  guide?: string
): string {
  const company = String(rawCompany ?? "").trim();
  if (company) return normalizeShopifyCourier(company, store);
  return guide ? getDefaultCourierForStore(store) : "";
}

function normalizeForzaGuide(guide: string): string {
  const trimmed = String(guide ?? "").trim().toUpperCase();
  if (!trimmed) return "";
  return trimmed.startsWith("FD") ? trimmed : `FD${trimmed.replace(/^FD/i, "")}`;
}

function normalizeGuideForStore(guide: string | undefined, store: FinanceStorePublic): string {
  const trimmed = String(guide ?? "").trim();
  if (!trimmed) return "";
  return store.logisticsProvider === "forza" ? normalizeForzaGuide(trimmed) : trimmed;
}

export function buildForzaTrackingMap(rows: ForzaTrackingRow[]): Map<string, ForzaTrackingRow> {
  const map = new Map<string, ForzaTrackingRow>();
  for (const row of rows) {
    const normalized = normalizeForzaGuide(row.guide_number || row.tracking_number);
    if (!normalized) continue;
    map.set(normalized, row);
    map.set(normalized.replace(/^FD/i, ""), row);
    if (row.guide_number) map.set(String(row.guide_number).trim().toUpperCase(), row);
    if (row.tracking_number) map.set(String(row.tracking_number).trim().toUpperCase(), row);
  }
  return map;
}

function getForzaTrackingFromMap(
  map: Map<string, ForzaTrackingRow>,
  guide: string | undefined
): ForzaTrackingRow | undefined {
  const normalized = normalizeForzaGuide(String(guide ?? ""));
  if (!normalized) return undefined;
  return map.get(normalized) ?? map.get(normalized.replace(/^FD/i, "")) ?? map.get(String(guide).trim().toUpperCase());
}

// ---------------------------------------------------------------------------
// KPIs (page.tsx ~7145-7272, util sum ~7562)
// ---------------------------------------------------------------------------

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
    const moovinHit = isMoovinCourier(courier, selectedStore) && guideNumber ? moovinByPackage.get(guideNumber) : undefined;
    const forzaHit = isForzaCourier(courier, selectedStore) && guideNumber ? getForzaTrackingFromMap(forzaByGuide, guideNumber) : undefined;
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
    const moovinHit = isMoovinCourier(baseCourier, selectedStore) && shopifyGuide ? moovinByPackage.get(shopifyGuide) : undefined;
    const forzaHit = isForzaCourier(baseCourier, selectedStore) && shopifyGuide
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
