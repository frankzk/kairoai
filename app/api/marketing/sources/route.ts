import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { MARKETING_STORE } from "@/lib/marketing";
import { periodFromParams } from "@/lib/marketing-dates";
import { getMarketingSources } from "@/lib/marketing-sources";
import { leerCuentasTiktok } from "@/lib/tiktok-diario";
import { rememberOriginCatalog } from "@/lib/marketing-origin-catalog";

import { readInventorySnapshots } from "@/lib/marketing-inventory-db";
import { pickInventory } from "@/lib/marketing-inventory-pick";
import { readShipHeroInventory } from "@/lib/shiphero-connection";
import type {
  MarketingInventory,
  MarketingSource,
} from "@/lib/marketing-source-types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store || store.code !== MARKETING_STORE) {
    return NextResponse.json(
      { error: "store=mireva-cr requerido y autorizado." },
      { status: 400 },
    );
  }
  const period = periodFromParams(req.nextUrl.searchParams);
  if (!period)
    return NextResponse.json(
      { error: "Indica un rango válido de hasta 93 días." },
      { status: 400 },
    );
  const scope = req.nextUrl.searchParams.get("scope") || "";
  const actions = scope === "actions";
  const sources = await getMarketingSources(period, process.env, fetch, {
    details: !["overview", "basic", "report"].includes(scope),
    daily: scope === "report" || actions || undefined,
    overview: scope === "overview",
    hourly: scope === "report",
    actions,
    // Sin acceso a la API de TikTok, el gasto que manda Make (lib/tiktok-diario.ts).
    tiktokDesdeMake: (from, to) =>
      leerCuentasTiktok(store.id, from, to, { lifetime: actions }),
    // Foto guardada por la conexión de ShipHero (cron); nunca llama a ShipHero.
    shipheroGuardado: () => readShipHeroInventory(store.id),
  });
  // The CSV covers a missing ShipHero, and wins when it is strictly newer.
  sources.shiphero = pickInventory(
    sources.shiphero,
    await csvInventory(store.id, sources.shiphero),
  );
  // A cache write must not hide a successfully read advertising report.
  await rememberOriginCatalog(store.id, sources).catch(() => {});
  return NextResponse.json(sources, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(".", "");

/** The latest uploaded product_table; without one (or on a failed read) the fallback source. */
async function csvInventory(
  storeId: number,
  fallback: MarketingSource<MarketingInventory>,
): Promise<MarketingSource<MarketingInventory>> {
  try {
    const { latest, previous } = await readInventorySnapshots(storeId);
    if (!latest) return fallback;
    return {
      status: "ready",
      checkedAt: latest.uploadedAt,
      message: `Inventario del archivo product_table del ${shortDate(latest.snapshotDate)}.`,
      data: {
        stock: latest.stock,
        origin: "csv",
        snapshotDate: latest.snapshotDate,
        uploadedAt: latest.uploadedAt,
        uploadedBy: latest.uploadedBy,
        previous: previous
          ? { snapshotDate: previous.snapshotDate, stock: previous.stock }
          : null,
        columns: {
          backorder: Boolean(latest.backorderColumn),
          incoming: Boolean(latest.incomingColumn),
        },
      },
    };
  } catch {
    return fallback;
  }
}
