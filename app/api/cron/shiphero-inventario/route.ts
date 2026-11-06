import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-runs";
import { marketingCatalogLoader } from "@/lib/marketing-catalog-loader";
import {
  SHIPHERO_SYNC_BUDGET_MS,
  syncShipHeroInventory,
} from "@/lib/shiphero-connection";
import { getStoreConfig } from "@/lib/stores";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron: foto del inventario de ShipHero (Mireva CR), 4 veces al día.
// Idempotente por día: reemplaza solo la foto ShipHero de hoy. Sin conexión
// (o sin la migración) no hace nada y responde ok.
async function handle() {
  try {
    const store = getStoreConfig("mireva-cr");
    const result = await syncShipHeroInventory(store.id, {
      by: "cron",
      deadline: Date.now() + SHIPHERO_SYNC_BUDGET_MS,
      catalog: marketingCatalogLoader(store),
    });
    return NextResponse.json(
      { ...result, ok: result.ok },
      { status: result.ok ? 200 : 502 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Error en el cron de ShipHero." },
      { status: 500 },
    );
  }
}

export const GET = withCronRun("shiphero-inventario", handle);
