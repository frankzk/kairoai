import { NextResponse } from "next/server";
import { getFinanceStoreById } from "@/lib/store-config";
import { getStoreConfig } from "@/lib/stores";
import { EN_COLA, refreshFinanceDatasetCache, tiendasConDatasetPendiente } from "@/app/api/finance/_shared/orders-dataset";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Reconstruye el dataset de Gestion de las tiendas que quedaron pendientes
// porque otra reconstruccion corria cuando se pidio (turno de
// app/api/finance/_shared/orders-dataset.ts). Una vez por tienda, una tras
// otra. Si no hay pendientes, es una sola consulta chica.
async function run() {
  const pendientes = await tiendasConDatasetPendiente();
  const results: Record<string, string> = {};
  for (const storeId of pendientes) {
    const publica = getFinanceStoreById(storeId);
    if (!publica) continue;
    results[publica.code] = await refreshFinanceDatasetCache(getStoreConfig(publica.code))
      .then((filas) => (filas === EN_COLA ? "en cola" : `${filas} filas`))
      .catch((err) => `error: ${err instanceof Error ? err.message : err}`);
  }
  return NextResponse.json({ ok: true, pendientes: pendientes.length, results });
}

export const GET = withCronRun("finance-pendientes", run);
