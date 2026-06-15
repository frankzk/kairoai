import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  computeOpMetricsFromTrackableRows,
  getKpiWindows,
  type KpiRange,
  type OpMetrics,
  type TrackableOrderRow,
} from "@/lib/finance-orders";
import { getOrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 30;

const KPI_RANGES: KpiRange[] = ["today", "7d", "30d", "month", "all"];

function parsePeriod(value: string | null): KpiRange {
  return KPI_RANGES.includes(value as KpiRange) ? (value as KpiRange) : "all";
}

// Replica el filtro `inWindow` del useMemo operationalKpis de page.tsx (~1230):
// la cohorte se agrupa por fecha de creacion en Shopify, con limite superior
// EXCLUSIVO (>= start && < end).
function inWindow(value: string | null, start: number, end: number): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time >= start && time < end;
}

// Cache simple a nivel de modulo de los KPIs ya calculados por tienda+periodo
// (TTL ~30s). El dataset ensamblado tiene su propio cache en getOrdersDataset;
// este evita recomputar las metricas en rafagas de requests.
const KPIS_TTL_MS = 30_000;
type KpisPayload = { current: OpMetrics; previous: OpMetrics | null };
const kpisCache = new Map<string, { at: number; data: KpisPayload }>();

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }

  const period = parsePeriod(params.get("period"));
  const cacheKey = `${store.code}|${period}`;

  try {
    const cached = kpisCache.get(cacheKey);
    if (cached && Date.now() - cached.at < KPIS_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    const { rows, settlementTraceByKey } = await getOrdersDataset(store);

    // Misma logica que el useMemo operationalKpis de page.tsx: ventana actual y
    // ventana previa "like-for-like", filtrando por shopify_created_at antes de
    // computeOpMetricsFromTrackableRows.
    const win = getKpiWindows(period, new Date());
    const current = computeOpMetricsFromTrackableRows(
      rows.filter((row: TrackableOrderRow) => inWindow(row.shopify_created_at, win.curStart, win.curEnd)),
      settlementTraceByKey
    );
    const previous =
      win.prevStart != null && win.prevEnd != null
        ? computeOpMetricsFromTrackableRows(
            rows.filter((row: TrackableOrderRow) =>
              inWindow(row.shopify_created_at, win.prevStart as number, win.prevEnd as number)
            ),
            settlementTraceByKey
          )
        : null;

    const data: KpisPayload = { current, previous };
    kpisCache.set(cacheKey, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al calcular KPIs de pedidos");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
