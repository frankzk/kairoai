import { NextRequest, NextResponse } from "next/server";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
// Armar el dataset de una tienda en frio (Micro) puede tardar; con varias tiendas
// seguidas se pasaba de 60s. 300s (max de Vercel Pro) da margen. Para precalentar
// a mano sin timeout, se puede pasar ?store=mireva-cr y hacer una tienda por vez.
export const maxDuration = 300;
// El handler no usa la request ni APIs dinamicas, asi que Next lo prerenderizaria
// como estatico y el cron serviria una respuesta cacheada sin reconstruir nada.
// force-dynamic garantiza que cada invocacion ejecute refreshFinanceDatasetCache.
export const dynamic = "force-dynamic";

// Cron de Palanca 1: reconstruye la cache durable del dataset de finanzas por
// tienda (tabla finance_dataset_cache) en background, para que el "cold build"
// no caiga en el path del request del dashboard. Se ejecuta cada ~10 min (ver
// vercel.json) y las mutaciones tambien refrescan tras cada cambio.
async function run(storeFilter: string | null) {
  const targets = storeFilter
    ? FINANCE_STORES.filter((publicStore) => publicStore.code === storeFilter)
    : FINANCE_STORES;
  const results: Array<{ store: string; row_count: number; error?: string }> = [];

  for (const publicStore of targets) {
    const store = getStoreConfig(publicStore.code);
    try {
      // El cron es el único que puebla el índice por pedido (finance_order_index,
      // Fase 1): 1 vez/hora/tienda, fuera del path del request y de las mutaciones.
      const rowCount = await refreshFinanceDatasetCache(store, { writeOrderIndex: true });
      results.push({ store: store.code, row_count: rowCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      results.push({ store: store.code, row_count: 0, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET(req: NextRequest) {
  return run(req.nextUrl.searchParams.get("store"));
}
