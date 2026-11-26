// Pedidos reales por día (creados − anulados), UTM por campaña/anuncio,
// pedidos sin UTM por producto, canal de venta (Landing / WhatsApp) con sus
// productos y unidades, y el ritmo de hoy en tramos de 15 minutos.
// Solo agregados: ningún pedido, cliente ni teléfono sale de esta ruta.
import { NextRequest } from "next/server";
import { getOrdersDataset } from "@/app/api/finance/_shared/orders-dataset";
import { buildFinanceControlCenter } from "@/lib/finance-orders";
import { listMarketingOrigins } from "@/lib/marketing-attribution-db";
import type { MarketingOriginRow } from "@/lib/marketing-attribution";
import {
  marketingDate,
  marketingPeriod,
  periodFromParams,
  shiftDate,
} from "@/lib/marketing-dates";
import { marketingAccess, marketingReply } from "@/lib/marketing-access";
import {
  attachChannelMix,
  matchChannelsToOrders,
} from "@/lib/marketing-channel-orders";
import {
  buildPaceSlots,
  buildRealOrderDays,
  matchOriginsToOrders,
  type MarketingControl,
} from "@/lib/marketing-real-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORIGINS_TIMEOUT_MS = 20_000;
const DATASET_TIMEOUT_MS = 45_000;

async function origins(
  storeId: number,
  from: string,
  to: string,
): Promise<{
  rows: MarketingOriginRow[] | null;
  status: MarketingControl["origins"];
}> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      listMarketingOrigins(storeId, from, to).then(
        (rows) => ({ rows, status: "ok" as const }),
        () => ({ rows: null, status: "error" as const }),
      ),
      new Promise<{ rows: null; status: "timeout" }>((resolve) => {
        timer = setTimeout(
          () => resolve({ rows: null, status: "timeout" }),
          ORIGINS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!allowed)
    return marketingReply(
      { error: "Se requiere Marketing y acceso a la tienda elegida." },
      403,
    );
  const now = new Date();
  const today = marketingDate(now);
  const params = req.nextUrl.searchParams;
  const period =
    params.has("from") || params.has("to")
      ? periodFromParams(params)
      : marketingPeriod(shiftDate(today, -13), today);
  if (!period || period.to > today)
    return marketingReply(
      { error: "Indica un rango válido de hasta 93 días, sin fechas futuras." },
      400,
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const [dataset, origin] = await Promise.race([
      Promise.all([
        getOrdersDataset(allowed.store, [
          "rows",
          "matchedSettlementRows",
          "imports",
          "settlementTraceByKey",
        ]),
        origins(
          allowed.store.id,
          new Date(period.start).toISOString(),
          new Date(period.end).toISOString(),
        ),
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Control timeout")),
          DATASET_TIMEOUT_MS,
        );
      }),
    ]);
    const orders = buildFinanceControlCenter(
      dataset.rows,
      dataset.matchedSettlementRows,
      dataset.imports,
      [],
      [],
      dataset.settlementTraceByKey,
    ).orders;
    const cohort = orders.filter((o) => {
      const t = Date.parse(o.created_at || "");
      return t >= period.start && t < period.end;
    });
    const matched = origin.rows
      ? matchOriginsToOrders(cohort, origin.rows)
      : null;
    // Without iComfly rows every order stays "sin canal" (never guessed).
    const channels = origin.rows
      ? matchChannelsToOrders(cohort, origin.rows)
      : null;
    const body: MarketingControl = {
      from: period.from,
      to: period.to,
      today,
      generatedAt: now.toISOString(),
      origins: origin.status,
      days: attachChannelMix(
        buildRealOrderDays(orders, matched, period, now),
        orders,
        channels,
        period,
        now,
      ),
      pace: period.to === today ? buildPaceSlots(orders, today, now) : null,
    };
    return marketingReply(body);
  } catch {
    return marketingReply(
      {
        error:
          "No se pudieron calcular los pedidos reales. Vuelve a actualizar en unos segundos.",
      },
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}
