import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  buildEnRouteGuides,
  getEffectiveTrackingStatus,
  getSettlementTracesForLogisticsRow,
  getTrackingFilterFromStatus,
  matchesOrderSearch,
  type SettlementTrace,
  type TrackableOrderRow,
} from "@/lib/finance-orders";
import { getOrdersDataset, type OrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
// Tope duro al exportar/all=1 para no devolver una respuesta gigante.
const MAX_EXPORT_ROWS = 25000;

// Filtros del tab Pedidos (mismos valores que page.tsx). El periodo replica
// matchesOrderPeriod (all/month/range); se mantienen tambien today/7d/30d por si
// alguien consume el endpoint con el rango de los KPIs.
type TrackingFilter =
  | "all"
  | "pending"
  | "en_route"
  | "en_route_retry"
  | "incident"
  | "annulled"
  | "delivered"
  | "not_delivered";
type SettlementFilter = "all" | "settled" | "unsettled" | "to_claim" | "duplicate";
type PeriodMode = "all" | "month" | "range" | "today" | "7d" | "30d";

const TRACKING_FILTERS: TrackingFilter[] = [
  "all",
  "pending",
  "en_route",
  "en_route_retry",
  "incident",
  "annulled",
  "delivered",
  "not_delivered",
];
const SETTLEMENT_FILTERS: SettlementFilter[] = ["all", "settled", "unsettled", "to_claim", "duplicate"];
const PERIOD_MODES: PeriodMode[] = ["all", "month", "range", "today", "7d", "30d"];

function parsePeriod(value: string | null): PeriodMode {
  return PERIOD_MODES.includes(value as PeriodMode) ? (value as PeriodMode) : "all";
}

function parseTrackingFilter(value: string | null): TrackingFilter {
  return TRACKING_FILTERS.includes(value as TrackingFilter) ? (value as TrackingFilter) : "all";
}

function parseSettlementFilter(value: string | null): SettlementFilter {
  return SETTLEMENT_FILTERS.includes(value as SettlementFilter) ? (value as SettlementFilter) : "all";
}

// Filtro del semáforo cliente (nivel de comportamiento), independiente del estado.
type BehaviorFilter = "all" | "problem" | "risk" | "good";
const BEHAVIOR_FILTERS: BehaviorFilter[] = ["all", "problem", "risk", "good"];
function parseBehaviorFilter(value: string | null): BehaviorFilter {
  return BEHAVIOR_FILTERS.includes(value as BehaviorFilter) ? (value as BehaviorFilter) : "all";
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

// Clave de fecha (YYYY-MM-DD) del pedido, igual que getOrderDateKey en page.tsx.
function getOrderDateKey(row: TrackableOrderRow): string {
  return row.shopify_created_at ? row.shopify_created_at.slice(0, 10) : "";
}

// Replica matchesOrderPeriod (page.tsx ~9406) para los modos del tab Pedidos, y
// resuelve today/7d/30d como ventanas relativas sobre shopify_created_at.
function matchesPeriod(
  row: TrackableOrderRow,
  mode: PeriodMode,
  month: string,
  startDate: string,
  endDate: string,
  now: Date
): boolean {
  if (mode === "all") return true;
  const orderDate = getOrderDateKey(row);
  if (!orderDate) return false;

  if (mode === "month") {
    if (!month) return true;
    return orderDate.slice(0, 7) === month;
  }

  if (mode === "range") {
    if (startDate && orderDate < startDate) return false;
    if (endDate && orderDate > endDate) return false;
    return true;
  }

  // today / 7d / 30d: ventana relativa por dia, limite superior inclusivo.
  const DAY = 24 * 60 * 60 * 1000;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ts = new Date(row.shopify_created_at as string).getTime();
  if (Number.isNaN(ts)) return false;
  if (mode === "today") return ts >= dayStart;
  const days = mode === "7d" ? 7 : 30;
  return ts >= dayStart - (days - 1) * DAY;
}

type RowWithTraces = TrackableOrderRow & { traces: SettlementTrace[] };

// Aplica el filtro de liquidacion sobre las trazas ya resueltas. Misma logica
// que el useMemo filteredRows de OrdersTab (page.tsx ~1761).
function matchesSettlement(
  filter: SettlementFilter,
  traces: SettlementTrace[],
  effectiveStatus: string
): boolean {
  if (filter === "all") return true;
  if (filter === "settled") return traces.length === 1;
  if (filter === "unsettled") return traces.length === 0;
  if (filter === "to_claim") return traces.length === 0 && effectiveStatus === "delivered";
  return traces.length > 1; // duplicate
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }

  const page = parsePositiveInt(params.get("page"), 1);
  const pageSize = Math.min(parsePositiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const q = (params.get("q") || "").trim();
  const trackingFilter = parseTrackingFilter(params.get("status"));
  const settlementFilter = parseSettlementFilter(params.get("settlement"));
  const behaviorFilter = parseBehaviorFilter(params.get("behavior"));
  const period = parsePeriod(params.get("period"));
  const month = (params.get("month") || "").trim();
  const startDate = (params.get("start") || "").trim();
  const endDate = (params.get("end") || "").trim();
  const exportAll = params.get("all") === "1";
  // enRouteGuides (lista grande, ~cientos) solo se calcula/envia cuando se pide
  // con ?guides=1. El fetch paginado de la tabla NO la pide, asi que cada cambio
  // de pagina/filtro viaja liviano; el cliente la trae una sola vez por tienda.
  const includeGuides = params.get("guides") === "1";

  try {
    const { rows, settlementTraceByKey }: OrdersDataset = await getOrdersDataset(store);
    const now = new Date();

    // 1) Periodo (Vista actual). Se cuenta aparte para la etiqueta "Vista actual".
    const periodRows = rows.filter((row) =>
      matchesPeriod(row, period, month, startDate, endDate, now)
    );

    // 2) Busqueda. trackingCounts se mide sobre este conjunto (= searchedRows).
    const searchedRows = q
      ? periodRows.filter((row) => matchesOrderSearch(row, q))
      : periodRows;

    // Resolvemos trazas + estado una sola vez por fila.
    const withMeta: Array<{ row: TrackableOrderRow; traces: SettlementTrace[]; status: string }> =
      searchedRows.map((row) => {
        const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
        return { row, traces, status: getEffectiveTrackingStatus(row, traces) };
      });

    // Conteos por estado (sobre searchedRows), igual que trackingCounts en la UI.
    const trackingCounts: Record<TrackingFilter, number> = {
      all: withMeta.length,
      pending: 0,
      en_route: 0,
      en_route_retry: 0,
      incident: 0,
      annulled: 0,
      delivered: 0,
      not_delivered: 0,
    };
    for (const item of withMeta) {
      trackingCounts[getTrackingFilterFromStatus(item.status)] += 1;
    }

    // Conteos del semáforo cliente (sobre searchedRows, como trackingCounts).
    // Solo cuentan las filas de clientes recurrentes (las que traen nivel).
    const behaviorCounts: Record<BehaviorFilter, number> = {
      all: withMeta.length,
      problem: 0,
      risk: 0,
      good: 0,
    };
    for (const item of withMeta) {
      const level = item.row.customer_behavior?.level;
      if (level) behaviorCounts[level] += 1;
    }

    // 3) Filtro de estado + semáforo cliente -> sobre este conjunto se miden los
    //    settlementCounts.
    const trackingFiltered =
      trackingFilter === "all"
        ? withMeta
        : withMeta.filter((item) => getTrackingFilterFromStatus(item.status) === trackingFilter);
    const behaviorFiltered =
      behaviorFilter === "all"
        ? trackingFiltered
        : trackingFiltered.filter((item) => item.row.customer_behavior?.level === behaviorFilter);

    const settlementCounts: Record<SettlementFilter, number> = {
      all: behaviorFiltered.length,
      settled: 0,
      unsettled: 0,
      to_claim: 0,
      duplicate: 0,
    };
    for (const item of behaviorFiltered) {
      if (item.traces.length === 1) settlementCounts.settled += 1;
      if (item.traces.length === 0) settlementCounts.unsettled += 1;
      if (item.traces.length === 0 && item.status === "delivered") settlementCounts.to_claim += 1;
      if (item.traces.length > 1) settlementCounts.duplicate += 1;
    }

    // 4) Filtro de liquidacion -> conjunto final mostrado.
    const finalFiltered = behaviorFiltered.filter((item) =>
      matchesSettlement(settlementFilter, item.traces, item.status)
    );

    const total = finalFiltered.length;
    // Las filas NO envían teléfono/email del cliente al navegador (PII + peso):
    // esos campos solo se usan server-side para agrupar el semáforo. Se quitan aquí.
    const attachTraces = (item: { row: TrackableOrderRow; traces: SettlementTrace[] }): RowWithTraces => {
      const row: RowWithTraces = { ...item.row, traces: item.traces };
      delete row.customer_phone;
      delete row.customer_email;
      return row;
    };

    if (exportAll) {
      // Export: todas las filas filtradas (con trazas para reconstruir las
      // columnas de liquidacion), con tope de seguridad.
      const allRows = finalFiltered.slice(0, MAX_EXPORT_ROWS).map(attachTraces);
      return NextResponse.json({ rows: allRows, total, trackingCounts, settlementCounts, behaviorCounts });
    }

    const startIdx = (page - 1) * pageSize;
    const pageRows = finalFiltered.slice(startIdx, startIdx + pageSize).map(attachTraces);

    // Guias no terminales para los botones "Actualizar Moovin/Forza": sobre el
    // dataset completo (no dependen de la paginacion ni de los filtros). Solo se
    // calculan/envian con ?guides=1 para no inflar cada fetch de pagina.
    const enRouteGuides = includeGuides
      ? buildEnRouteGuides(rows, settlementTraceByKey, store)
      : undefined;

    return NextResponse.json({
      rows: pageRows,
      total,
      page,
      pageSize,
      periodCount: periodRows.length,
      searchedCount: searchedRows.length,
      trackingCounts,
      settlementCounts,
      behaviorCounts,
      ...(enRouteGuides ? { enRouteGuides } : {}),
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al cargar pedidos");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
