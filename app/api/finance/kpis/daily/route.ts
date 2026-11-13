import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  computeOpMetricsFromTrackableRows,
  getKpiWindows,
  type KpiRange,
  type TrackableOrderRow,
} from "@/lib/finance-orders";
import { buildPanelSeries, PANEL_SERIES_MAX_DAYS, spanDays, type PanelSeries } from "@/lib/panel-serie";
import { getOrdersDataset, isOrdersDatasetUnavailableError } from "../../_shared/orders-dataset";

// Serie diaria del Panel (inicio, app/page.tsx): pedidos por dia de creacion
// con su estado de hoy, y el valor de los pedidos del periodo y del anterior.
// Solo lectura. Mismo dataset, mismas ventanas (getKpiWindows en la hora de la
// tienda) y misma regla de conteo que /api/finance/kpis, asi que la suma de
// los dias coincide con "Pedidos generados" de Gestion. Sin consultas nuevas.

export const runtime = "nodejs";
export const maxDuration = 60;

const RANGES: KpiRange[] = ["today", "yesterday", "7d", "30d", "month", "custom"];
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateKey(value: string | null): string {
  const trimmed = (value || "").trim();
  return DATE_KEY_RE.test(trimmed) ? trimmed : "";
}

const TTL_MS = 30_000;
type Payload = PanelSeries & { range: KpiRange; timeZone: string; window: { curStart: number; curEnd: number; prevStart: number | null; prevEnd: number | null } };
const cache = new Map<string, { at: number; data: Payload }>();

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const range = params.get("period") as KpiRange | null;
  if (!range || !RANGES.includes(range)) {
    return NextResponse.json(
      { error: "period requerido: today, yesterday, 7d, 30d, month o custom" },
      { status: 400 }
    );
  }
  const start = parseDateKey(params.get("start"));
  const end = parseDateKey(params.get("end"));
  if (range === "custom" && (!start || !end || start > end)) {
    return NextResponse.json(
      { error: "period=custom requiere start y end (YYYY-MM-DD, start <= end)" },
      { status: 400 }
    );
  }
  const win = getKpiWindows(range, new Date(), { start, end }, store.timezone);
  if (win.curStart <= 0 || spanDays(win.curStart, win.curEnd) > PANEL_SERIES_MAX_DAYS) {
    return NextResponse.json(
      { error: `El rango puede tener hasta ${PANEL_SERIES_MAX_DAYS} días.` },
      { status: 400 }
    );
  }
  const cacheKey = range === "custom" ? `${store.code}|custom|${start}|${end}` : `${store.code}|${range}`;

  try {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.data);

    const { rows, settlementTraceByKey } = await getOrdersDataset(store, ["rows", "settlementTraceByKey"]);
    const series = buildPanelSeries(rows as TrackableOrderRow[], win, store.timezone, (row) =>
      computeOpMetricsFromTrackableRows([row], settlementTraceByKey)
    );
    const data: Payload = {
      ...series,
      range,
      timeZone: store.timezone,
      window: { curStart: win.curStart, curEnd: win.curEnd, prevStart: win.prevStart, prevEnd: win.prevEnd },
    };
    if (cache.size > 50) {
      const now = Date.now();
      for (const [key, entry] of Array.from(cache.entries())) if (now - entry.at >= TTL_MS) cache.delete(key);
    }
    cache.set(cacheKey, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    if (isOrdersDatasetUnavailableError(err)) {
      return NextResponse.json(
        { error: "Datos operativos temporalmente no disponibles. Reintenta en unos segundos.", retryable: true },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    const message = toFriendlyErrorMessage(err, "Error al calcular la serie diaria");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
