import { NextRequest, NextResponse } from "next/server";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { runShopifyRefresh, windowStart } from "@/lib/shopify-refresh-run";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_REFRESH_DAYS = 14;
// Presupuesto de tiempo por corrida: paginamos en profundidad hasta acercarnos
// al maxDuration (con margen para el ultimo upsert + respuesta). Asi una sola
// corrida con ?days amplio cubre casi todo el backlog; lo que quede se reanuda
// con ?next_url.
const TIME_BUDGET_MS = 50_000;
const MAX_PAGES_PER_STORE = 80; // tope duro de seguridad

// Barrida PROFUNDA por updated_at (14 dias por defecto): captura guias y
// fulfillments creados despues del pedido, que el sync inicial (que solo mira
// created_at) nunca reconsulta.
//
// Para que un pedido NUEVO aparezca rapido esta el cron shopify-recent, que
// corre cada 10 minutos con una ventana corta. Este es el respaldo.
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : DEFAULT_REFRESH_DAYS;
  const storeFilter = req.nextUrl.searchParams.get("store");
  // Reanudable (solo con una tienda): continua desde el cursor devuelto antes.
  const resumeUrl = req.nextUrl.searchParams.get("next_url");
  const updatedAtMin = windowStart({ days }, startedAt);

  const targetStores = storeFilter
    ? FINANCE_STORES.filter((store) => store.code === storeFilter)
    : FINANCE_STORES;

  const results: Array<{ store: string; synced: number; next_url?: string | null; error?: string }> = [];

  for (const publicStore of targetStores) {
    const store = getStoreConfig(publicStore.code);
    try {
      const { synced, next_url } = await runShopifyRefresh({
        store,
        updatedAtMin,
        timeBudgetMs: TIME_BUDGET_MS,
        maxPages: MAX_PAGES_PER_STORE,
        startedAt,
        resumeUrl: resumeUrl && storeFilter ? resumeUrl : null,
      });

      // El refresh muto shopify_orders de esta tienda: reconstruye su cache
      // durable del dataset una sola vez por corrida (solo si entraron pedidos).
      // Defensivo: nunca rompe el cron si la cache falla.
      if (synced > 0) {
        await refreshFinanceDatasetCache(store).catch((cacheErr) =>
          console.warn(`[cron/shopify-refresh cache] ${store.code}:`, cacheErr)
        );
      }

      // Si quedo url, se freno por tiempo/tope: devolvemos el cursor para reanudar
      // con ?next_url=<...>&store=<...> (solo una tienda).
      results.push({ store: store.code, synced, next_url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      results.push({ store: store.code, synced: 0, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}
