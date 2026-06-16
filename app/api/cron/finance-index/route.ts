import { NextResponse } from "next/server";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;
// El handler no usa la request ni APIs dinamicas, asi que Next lo prerenderizaria
// como estatico y el cron serviria una respuesta cacheada sin reconstruir nada.
// force-dynamic garantiza que cada invocacion ejecute refreshFinanceDatasetCache.
export const dynamic = "force-dynamic";

// Cron de Palanca 1: reconstruye la cache durable del dataset de finanzas por
// tienda (tabla finance_dataset_cache) en background, para que el "cold build"
// no caiga en el path del request del dashboard. Se ejecuta cada ~10 min (ver
// vercel.json) y las mutaciones tambien refrescan tras cada cambio.
async function run() {
  const results: Array<{ store: string; row_count: number; error?: string }> = [];

  for (const publicStore of FINANCE_STORES) {
    const store = getStoreConfig(publicStore.code);
    try {
      const rowCount = await refreshFinanceDatasetCache(store);
      results.push({ store: store.code, row_count: rowCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      results.push({ store: store.code, row_count: 0, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET() {
  return run();
}
