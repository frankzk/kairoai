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
import { mergeDispatchIntoTracking } from "@/lib/dispatch";
import {
  getOrdersDataset,
  isOrdersDatasetUnavailableError,
  type OrdersDataset,
} from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  | "despacho_solicitado"
  | "recolectado"
  | "en_route"
  | "en_route_retry"
  | "incident_solvable"
  | "incident_unsolvable"
  | "annulled"
  | "delivered"
  | "not_delivered";
type SettlementFilter = "all" | "settled" | "unsettled" | "to_claim" | "duplicate";
type PeriodMode = "all" | "month" | "range" | "today" | "7d" | "30d";

const TRACKING_FILTERS: TrackingFilter[] = [
  "all",
  "pending",
  "despacho_solicitado",
  "recolectado",
  "en_route",
  "en_route_retry",
  "incident_solvable",
  "incident_unsolvable",
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
type ResolvedRow = { row: TrackableOrderRow; traces: SettlementTrace[]; status: string };

function resolveRows(
  rows: TrackableOrderRow[],
  settlementTraceByKey: OrdersDataset["settlementTraceByKey"]
): ResolvedRow[] {
  return rows.map((row) => {
    const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
    const status = mergeDispatchIntoTracking(
      getEffectiveTrackingStatus(row, traces),
      row.dispatch_view ?? null,
      row
    );
    return { row, traces, status };
  });
}

function countTracking(rows: ResolvedRow[]): Record<TrackingFilter, number> {
  const counts: Record<TrackingFilter, number> = {
    all: rows.length,
    pending: 0,
    despacho_solicitado: 0,
    recolectado: 0,
    en_route: 0,
    en_route_retry: 0,
    incident_solvable: 0,
    incident_unsolvable: 0,
    annulled: 0,
    delivered: 0,
    not_delivered: 0,
  };
  for (const item of rows) {
    counts[getTrackingFilterFromStatus(item.status, item.row)] += 1;
  }
  return counts;
}

function countSettlements(rows: ResolvedRow[]): Record<SettlementFilter, number> {
  const counts: Record<SettlementFilter, number> = {
    all: rows.length,
    settled: 0,
    unsettled: 0,
    to_claim: 0,
    duplicate: 0,
  };
  for (const item of rows) {
    if (item.traces.length === 1) counts.settled += 1;
    if (item.traces.length === 0) counts.unsettled += 1;
    if (item.traces.length === 0 && item.status === "delivered") counts.to_claim += 1;
    if (item.traces.length > 1) counts.duplicate += 1;
  }
  return counts;
}

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
  const period = parsePeriod(params.get("period"));
  const month = (params.get("month") || "").trim();
  const startDate = (params.get("start") || "").trim();
  const endDate = (params.get("end") || "").trim();
  const exportAll = params.get("all") === "1";
  // ?guides=1 se conserva para clientes antiguos. La carga inicial nueva usa
  // metadata=1 y obtiene tabla, conteos y guias en una sola lectura del dataset.
  const includeGuides = params.get("guides") === "1";
  // La primera carga del tab puede pedir conteos y guias globales en la misma
  // respuesta. Asi evitamos tres lecturas concurrentes del dataset completo.
  const includeMetadata = params.get("metadata") === "1";

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
    const withMeta = resolveRows(searchedRows, settlementTraceByKey);

    // Conteos por estado (sobre searchedRows), igual que trackingCounts en la UI.
    const trackingCounts = countTracking(withMeta);

    // 3) Filtro de estado -> sobre este conjunto se miden los settlementCounts.
    const trackingFiltered =
      trackingFilter === "all"
        ? withMeta
        : withMeta.filter((item) => getTrackingFilterFromStatus(item.status, item.row) === trackingFilter);

    const settlementCounts = countSettlements(trackingFiltered);

    // 4) Filtro de liquidacion -> conjunto final mostrado.
    const finalFiltered = trackingFiltered.filter((item) =>
      matchesSettlement(settlementFilter, item.traces, item.status)
    );

    const total = finalFiltered.length;
    const attachTraces = (item: { row: TrackableOrderRow; traces: SettlementTrace[] }): RowWithTraces => ({
      ...item.row,
      traces: item.traces,
    });

    if (exportAll) {
      // Export: todas las filas filtradas (con trazas para reconstruir las
      // columnas de liquidacion), con tope de seguridad.
      const allRows = finalFiltered.slice(0, MAX_EXPORT_ROWS).map(attachTraces);
      return NextResponse.json({ rows: allRows, total, trackingCounts, settlementCounts });
    }

    const startIdx = (page - 1) * pageSize;
    const pageRows = finalFiltered.slice(startIdx, startIdx + pageSize).map(attachTraces);

    // Guias no terminales para clientes antiguos que todavia usan ?guides=1.
    // La UI actual las recibe dentro de operationalMetadata en su primera carga.
    const enRouteGuides = includeGuides
      ? buildEnRouteGuides(rows, settlementTraceByKey, store)
      : undefined;

    const operationalMetadata = includeMetadata
      ? (() => {
          const allRows = resolveRows(rows, settlementTraceByKey);
          return {
            trackingCounts: countTracking(allRows),
            settlementCounts: countSettlements(allRows),
            enRouteGuides: buildEnRouteGuides(rows, settlementTraceByKey, store),
          };
        })()
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
      ...(enRouteGuides ? { enRouteGuides } : {}),
      ...(operationalMetadata ? { operationalMetadata } : {}),
    });
  } catch (err) {
    if (isOrdersDatasetUnavailableError(err)) {
      return NextResponse.json(
        {
          error: "Datos operativos temporalmente no disponibles. Reintenta en unos segundos.",
          retryable: true,
        },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    const message = toFriendlyErrorMessage(err, "Error al cargar pedidos");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
