import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { MARKETING_STORE } from "@/lib/marketing";
import { periodFromParams } from "@/lib/marketing-dates";
import { getMarketingData } from "@/lib/marketing-data";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { isOrdersDatasetUnavailableError } from "../../finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          Object.assign(
            new Error(
              "La base operativa tardó demasiado. Vuelve a actualizar en unos segundos.",
            ),
            { name: "MarketingTimeoutError" },
          ),
        ),
      45_000,
    );
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
    return NextResponse.json(
      {
        error:
          "Marketing está disponible para Mireva Costa Rica: store=mireva-cr.",
      },
      { status: 400 },
    );
  }
  const month = params.get("month") || "";
  const period = periodFromParams(params);
  if (!period) {
    return NextResponse.json(
      {
        error:
          "Indica from y to válidos (máximo 93 días) o month con formato YYYY-MM.",
      },
      { status: 400 },
    );
  }
  try {
    // Only aggregate data leaves this route; no customer or order identifiers.
    return NextResponse.json(
      await bounded(getMarketingData(store, period, month)),
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: toFriendlyErrorMessage(
          error,
          "No se pudo cargar el panel de marketing.",
        ),
      },
      {
        status:
          isOrdersDatasetUnavailableError(error) ||
          (error instanceof Error && error.name === "MarketingTimeoutError")
            ? 503
            : 500,
      },
    );
  }
}
