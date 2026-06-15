import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  getEffectiveTrackingStatus,
  getSettlementTracesForLogisticsRow,
  getTrackingFilterFromStatus,
  matchesOrderSearch,
  type TrackableOrderRow,
} from "@/lib/finance-orders";
import { getOrdersDataset, type OrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

type PeriodMode = "all" | "today" | "7d" | "30d" | "month";
const PERIOD_MODES: PeriodMode[] = ["all", "today", "7d", "30d", "month"];

function parsePeriod(value: string | null): PeriodMode {
  return PERIOD_MODES.includes(value as PeriodMode) ? (value as PeriodMode) : "all";
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

// Ventana [start, end) por periodo, en ms. Equivalente server-side al rango
// que getKpiWindows usa en page.tsx (mismas cuentas de today/7d/30d/month);
// no es copia verbatim porque alli devuelve labels de comparativo que aqui no
// hacen falta. Se compara contra shopify_created_at.
function getPeriodStart(mode: PeriodMode, now: Date): number | null {
  if (mode === "all") return null;
  const DAY = 24 * 60 * 60 * 1000;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (mode === "today") return dayStart;
  if (mode === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const days = mode === "7d" ? 7 : 30;
  return dayStart - (days - 1) * DAY;
}

function inPeriod(row: TrackableOrderRow, start: number | null, end: number): boolean {
  if (start === null) return true;
  if (!row.shopify_created_at) return false;
  const ts = new Date(row.shopify_created_at).getTime();
  if (Number.isNaN(ts)) return false;
  return ts >= start && ts <= end;
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
  const statusFilter = (params.get("status") || "all").trim();
  const period = parsePeriod(params.get("period"));

  try {
    const { rows, settlementTraceByKey }: OrdersDataset = await getOrdersDataset(store);

    const now = new Date();
    const periodStart = getPeriodStart(period, now);
    const periodEnd = now.getTime();

    const filtered = rows.filter((row) => {
      if (!inPeriod(row, periodStart, periodEnd)) return false;
      if (q && !matchesOrderSearch(row, q)) return false;
      if (statusFilter && statusFilter !== "all") {
        const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
        const effective = getEffectiveTrackingStatus(row, traces);
        if (getTrackingFilterFromStatus(effective) !== statusFilter) return false;
      }
      return true;
    });

    const total = filtered.length;
    const startIdx = (page - 1) * pageSize;
    const pageRows = filtered.slice(startIdx, startIdx + pageSize);

    return NextResponse.json({ rows: pageRows, total, page, pageSize });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al cargar pedidos");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
