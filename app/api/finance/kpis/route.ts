import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { computeOpMetricsFromTrackableRows, type OpMetrics } from "@/lib/finance-orders";
import { getOrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 30;

// Cache simple a nivel de modulo de los KPIs ya calculados por tienda (TTL
// ~30s). El dataset ensamblado tiene su propio cache en getOrdersDataset; este
// evita recomputar las metricas en rafagas de requests.
const KPIS_TTL_MS = 30_000;
const kpisCache = new Map<string, { at: number; data: OpMetrics }>();

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }

  try {
    const cached = kpisCache.get(store.code);
    if (cached && Date.now() - cached.at < KPIS_TTL_MS) {
      return NextResponse.json({ kpis: cached.data });
    }

    const { rows, settlementTraceByKey } = await getOrdersDataset(store);
    const kpis = computeOpMetricsFromTrackableRows(rows, settlementTraceByKey);

    kpisCache.set(store.code, { at: Date.now(), data: kpis });
    return NextResponse.json({ kpis });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al calcular KPIs de pedidos");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
