import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { periodFromParams } from "@/lib/marketing-dates";
import { getMarketingInputs } from "@/lib/marketing-data";
import { readCharlieConfig } from "@/lib/marketing-charlie-settings";
import { buildCharlieRevenue } from "@/lib/marketing-charlie-revenue";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams),
    period = periodFromParams(req.nextUrl.searchParams);
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" },
    });
  if (store?.code !== "mireva-cr" || !period)
    return respond(
      { error: "Tienda de Costa Rica y período válido requeridos." },
      400,
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timeout")), 45000);
    });
    const [input, config] = await Promise.race([
      Promise.all([
        getMarketingInputs(store, period),
        readCharlieConfig(store.id),
      ]),
      deadline,
    ]);
    return respond(
      buildCharlieRevenue(
        input.orders,
        input.phones,
        period,
        config.hero_product_keys,
      ),
    );
  } catch {
    return respond(
      {
        error:
          "No se pudieron verificar los ingresos potenciales y la recompra. Vuelve a actualizar.",
      },
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}
