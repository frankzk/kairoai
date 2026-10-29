import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { listExpenses, listProductCosts, listProductCostVersions } from "@/lib/finance";
import { buildFinanceControlCenter } from "@/lib/finance-orders";
import { buildMarketingSummary, marketingMonth, MARKETING_STORE } from "@/lib/marketing";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getOrdersDataset, isOrdersDatasetUnavailableError } from "../../finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("La base operativa tardó demasiado. Vuelve a actualizar en unos segundos."), { name: "MarketingTimeoutError" })), 45_000);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store || store.code !== MARKETING_STORE) {
    return NextResponse.json({ error: "Marketing está disponible para Mireva Costa Rica: store=mireva-cr." }, { status: 400 });
  }
  const month = params.get("month") || "";
  if (!marketingMonth(month)) {
    return NextResponse.json({ error: "month requerido con formato YYYY-MM válido." }, { status: 400 });
  }
  try {
    const [dataset, expenses, costs, costVersions] = await bounded(Promise.all([
      getOrdersDataset(store, ["rows", "matchedSettlementRows", "imports", "settlementTraceByKey"]),
      listExpenses("ads", store.id),
      listProductCosts(store.id),
      listProductCostVersions(undefined, store.id),
    ]));
    const control = buildFinanceControlCenter(
      dataset.rows, dataset.matchedSettlementRows, dataset.imports,
      costs.filter(cost => cost.currency?.toUpperCase() === "CRC"),
      costVersions.filter(cost => cost.currency?.toUpperCase() === "CRC"),
      dataset.settlementTraceByKey,
    );
    // Only aggregate data leaves this route; no customer or order identifiers.
    return NextResponse.json(buildMarketingSummary({ orders: control.orders, expenses, month }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: toFriendlyErrorMessage(error, "No se pudo cargar el panel de marketing."),
    }, { status: isOrdersDatasetUnavailableError(error) || (error instanceof Error && error.name === "MarketingTimeoutError") ? 503 : 500 });
  }
}
