import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  computeOpMetricsFromTrackableRows,
  getKpiWindows,
  type KpiRange,
  type TrackableOrderRow,
} from "@/lib/finance-orders";
import { readMarketingProductCatalog } from "@/lib/marketing-product-groups-db";
import { buildVariantIndex } from "@/lib/marketing-variant-keys";
import { readShipHeroInventory } from "@/lib/shiphero-connection";
import { buildStockAlerts, buildTopProducts, type StockAlerts, type TopProducts } from "@/lib/panel-productos";
import { PANEL_SERIES_MAX_DAYS, spanDays } from "@/lib/panel-serie";
import { getOrdersDataset, isOrdersDatasetUnavailableError } from "../../_shared/orders-dataset";

// Productos del Panel (inicio, app/page.tsx): los mas pedidos del periodo y
// las alertas de stock del inventario guardado (ShipHero). Solo lectura. Mismo
// dataset, ventanas y regla de conteo que /api/finance/kpis/daily.

export const runtime = "nodejs";
export const maxDuration = 60;

const RANGES: KpiRange[] = ["today", "yesterday", "7d", "30d", "month", "custom"];
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TTL_MS = 30_000;
/** El catalogo solo afina el cruce por variante: si tarda, se cruza por SKU. */
const CATALOG_TIMEOUT_MS = 8_000;

function parseDateKey(value: string | null): string {
  const trimmed = (value || "").trim();
  return DATE_KEY_RE.test(trimmed) ? trimmed : "";
}

export type PanelStock =
  | { status: "ready"; snapshotDate: string | null; uploadedAt: string | null; alerts: StockAlerts }
  | { status: "sin_inventario"; message: string };

type Payload = { range: KpiRange; top: TopProducts; stock: PanelStock };
const cache = new Map<string, { at: number; data: Payload }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

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
  const now = new Date();
  const win = getKpiWindows(range, now, { start, end }, store.timezone);
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

    const [{ rows, settlementTraceByKey }, inventory, catalog] = await Promise.all([
      getOrdersDataset(store, ["rows", "settlementTraceByKey"]),
      withTimeout(readShipHeroInventory(store.id), CATALOG_TIMEOUT_MS),
      withTimeout(readMarketingProductCatalog(store.id), CATALOG_TIMEOUT_MS),
    ]);
    const trackable = rows as TrackableOrderRow[];
    const metrics = new Map<TrackableOrderRow, { generated: number; annulled: number }>();
    const metricsOf = (row: TrackableOrderRow) => {
      let m = metrics.get(row);
      if (!m) {
        const op = computeOpMetricsFromTrackableRows([row], settlementTraceByKey);
        m = { generated: op.generated, annulled: op.annulled };
        metrics.set(row, m);
      }
      return m;
    };

    const top = buildTopProducts(trackable, win, metricsOf);
    const stock: PanelStock =
      inventory?.status === "ready" && inventory.data
        ? {
            status: "ready",
            snapshotDate: inventory.data.snapshotDate ?? null,
            uploadedAt: inventory.data.uploadedAt ?? null,
            alerts: buildStockAlerts({
              rows: trackable,
              stock: inventory.data.stock,
              metricsOf,
              index: catalog?.length ? buildVariantIndex(catalog) : null,
              now,
              timeZone: store.timezone,
            }),
          }
        : {
            status: "sin_inventario",
            message:
              inventory?.status === "pending" && inventory.message
                ? inventory.message
                : "Esta tienda no tiene inventario conectado en Kairo.",
          };

    const data: Payload = { range, top, stock };
    if (cache.size > 50) {
      const t = Date.now();
      for (const [key, entry] of Array.from(cache.entries())) if (t - entry.at >= TTL_MS) cache.delete(key);
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
    const message = toFriendlyErrorMessage(err, "Error al calcular los productos");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
