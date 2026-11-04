import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { MARKETING_STORE } from "@/lib/marketing";
import { periodFromParams } from "@/lib/marketing-dates";
import { getMarketingData, getMarketingInputs } from "@/lib/marketing-data";
import { readCharlieConfig } from "@/lib/marketing-charlie-settings";
import { buildCharlieRevenue } from "@/lib/marketing-charlie-revenue";
import { listMarketingOrigins } from "@/lib/marketing-attribution-db";
import { buildMarketingAttribution } from "@/lib/marketing-attribution";
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

// Origin coverage is optional: a slow reader must not hold the operational summary hostage.
async function optionalOrigins(storeId: number, from: string, to: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      listMarketingOrigins(storeId, from, to).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 4000);
      }),
    ]);
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
    const load = async () => {
      if (
        params.get("include_charlie") !== "1" &&
        params.get("include_attribution") !== "1"
      )
        return getMarketingData(store, period, month);
      // One operational snapshot feeds both reports. Raw orders and phones stay on the server.
      const includeAttribution = params.get("include_attribution") === "1";
      const [input, config, origins] = await Promise.all([
        getMarketingInputs(store, period, month),
        readCharlieConfig(store.id).catch(() => null),
        includeAttribution
          ? optionalOrigins(
              store.id,
              new Date(period.start).toISOString(),
              new Date(period.end).toISOString(),
            )
          : Promise.resolve(null),
      ]);
      return {
        ...input.summary,
        ...(includeAttribution
          ? {
              attribution: origins
                ? buildMarketingAttribution(input.orders, origins, period)
                : null,
              ...(origins
                ? {}
                : {
                    attributionError:
                      "No se pudo consultar el origen UTM. Los pedidos se conservan sin asignarles un canal.",
                  }),
            }
          : {}),
        charlieBusiness: config
          ? buildCharlieRevenue(
              input.orders,
              input.phones,
              period,
              config.hero_product_keys,
            )
          : null,
        ...(config
          ? {}
          : {
              charlieError:
                "No se pudo cargar la configuración de ingresos potenciales. Vuelve a actualizar.",
            }),
      };
    };
    return NextResponse.json(await bounded(load()), {
      headers: { "Cache-Control": "private, no-store" },
    });
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
