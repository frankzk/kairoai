import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { listProductCosts, listProductCostVersions } from "@/lib/finance";
import {
  buildFinanceControlCenter,
  buildProductAnalysisRows,
  type ProductAnalysisRow,
} from "@/lib/finance-orders";
import { getOrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cache simple a nivel de modulo del analisis de productos por tienda (TTL ~30s),
// igual que kpis/. El dataset ensamblado ya tiene su propio cache; este evita
// recomputar buildFinanceControlCenter + buildProductAnalysisRows en rafagas.
const PRODUCT_ANALYSIS_TTL_MS = 30_000;
type ProductAnalysisPayload = { rows: ProductAnalysisRow[] };
const productAnalysisCache = new Map<string, { at: number; data: ProductAnalysisPayload }>();

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }

  try {
    const cached = productAnalysisCache.get(store.code);
    if (cached && Date.now() - cached.at < PRODUCT_ANALYSIS_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    // Mismas dependencias que el useMemo financeControl + productAnalysisRows de
    // page.tsx: filas visibles + liquidaciones enriquecidas + imports vienen del
    // dataset; costos y versiones son consultas pequenas directas.
    const [{ rows, matchedSettlementRows, imports, settlementTraceByKey }, costs, costVersions] =
      await Promise.all([
        getOrdersDataset(store),
        listProductCosts(store.id),
        listProductCostVersions(undefined, store.id),
      ]);

    const financeControl = buildFinanceControlCenter(
      rows,
      matchedSettlementRows,
      imports,
      costs,
      costVersions,
      settlementTraceByKey
    );

    const data: ProductAnalysisPayload = { rows: buildProductAnalysisRows(financeControl.orders) };
    productAnalysisCache.set(store.code, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al analizar productos");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
