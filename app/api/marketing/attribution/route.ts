import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { MARKETING_STORE } from "@/lib/marketing";
import { periodFromParams } from "@/lib/marketing-dates";
import { getOrdersDataset } from "@/app/api/finance/_shared/orders-dataset";
import { buildFinanceControlCenter } from "@/lib/finance-orders";
import { listMarketingOrigins } from "@/lib/marketing-attribution-db";
import { buildMarketingAttribution } from "@/lib/marketing-attribution";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store || store.code !== MARKETING_STORE)
    return NextResponse.json(
      { error: "Tienda de Marketing inválida." },
      { status: 400 },
    );
  const period = periodFromParams(req.nextUrl.searchParams);
  if (!period)
    return NextResponse.json(
      { error: "Período inválido (máximo 93 días)." },
      { status: 400 },
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [dataset, origins] = await Promise.race([
      Promise.all([
        getOrdersDataset(store, [
          "rows",
          "matchedSettlementRows",
          "imports",
          "settlementTraceByKey",
        ]),
        listMarketingOrigins(
          store.id,
          new Date(period.start).toISOString(),
          new Date(period.end).toISOString(),
        ),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Attribution timeout")),
          45_000,
        );
      }),
    ]);
    const control = buildFinanceControlCenter(
      dataset.rows,
      dataset.matchedSettlementRows,
      dataset.imports,
      [],
      [],
      dataset.settlementTraceByKey,
    );
    // Only aggregates, IDs of ads and UTM labels leave Marketing. No order/customer/click IDs.
    return NextResponse.json(
      { ...buildMarketingAttribution(control.orders, origins, period), period },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "No se pudo cruzar el origen publicitario de los pedidos. Vuelve a actualizar.",
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}
