import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { listExpenses, listProductCosts, listProductCostVersions } from "@/lib/finance";
import {
  buildFinanceControlCenter,
  buildMonthlyCloseRows,
  type FinanceControlCenter,
  type MonthlyCloseRow,
} from "@/lib/finance-orders";
import { getOrdersDataset } from "../_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 30;

// Cache simple por tienda (TTL ~30s) del cierre mensual + centro de control. El
// dataset ya cachea su ensamblado; este evita recomputar en rafagas.
const MONTHLY_CLOSE_TTL_MS = 30_000;
type MonthlyClosePayload = { rows: MonthlyCloseRow[]; control: FinanceControlCenter };
const monthlyCloseCache = new Map<string, { at: number; data: MonthlyClosePayload }>();

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
    const cached = monthlyCloseCache.get(store.code);
    if (cached && Date.now() - cached.at < MONTHLY_CLOSE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    // Mismas dependencias que el useMemo financeControl + monthlyCloseRows de
    // page.tsx: filas visibles + liquidaciones + imports del dataset; gastos,
    // costos y versiones son consultas directas.
    const [{ rows, matchedSettlementRows, imports, settlementTraceByKey }, expenses, costs, costVersions] =
      await Promise.all([
        getOrdersDataset(store),
        listExpenses(undefined, store.id),
        listProductCosts(store.id),
        listProductCostVersions(undefined, store.id),
      ]);

    const control = buildFinanceControlCenter(
      rows,
      matchedSettlementRows,
      imports,
      costs,
      costVersions,
      settlementTraceByKey
    );

    const data: MonthlyClosePayload = {
      rows: buildMonthlyCloseRows(control.orders, expenses),
      control,
    };
    monthlyCloseCache.set(store.code, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al calcular el cierre mensual");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
