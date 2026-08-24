import { NextRequest, NextResponse } from "next/server";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { runShopifyRefresh, windowStart } from "@/lib/shopify-refresh-run";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

// Ventana corta y CRON cada 10 min: un pedido nuevo entra al tablero solo,
// sin que nadie apriete "Sync Shopify". Antes el unico camino era la barrida
// de 14 dias cada 3 horas, asi que un pedido podia tardar ese tanto en verse.
//
// La ventana (30 min) es el TRIPLE del intervalo del cron a proposito: si una
// corrida falla o se demora, la siguiente igual alcanza lo que se perdio.
const WINDOW_MINUTES = Number(process.env.SHOPIFY_RECENT_WINDOW_MIN ?? 30);
// Con esa ventana entran unas pocas decenas de pedidos: una pagina alcanza y
// sobra. El tope existe para que un pico raro no consuma el maxDuration.
const TIME_BUDGET_MS = 40_000;
const MAX_PAGES_PER_STORE = 4;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const minutesParam = Number(req.nextUrl.searchParams.get("minutes"));
  const minutes = Number.isFinite(minutesParam) && minutesParam > 0 ? minutesParam : WINDOW_MINUTES;
  const updatedAtMin = windowStart({ minutes }, startedAt);

  const results: Array<{ store: string; synced: number; error?: string }> = [];

  for (const publicStore of FINANCE_STORES) {
    const store = getStoreConfig(publicStore.code);
    try {
      const { synced } = await runShopifyRefresh({
        store,
        updatedAtMin,
        timeBudgetMs: TIME_BUDGET_MS,
        maxPages: MAX_PAGES_PER_STORE,
        startedAt,
      });

      // Solo si de verdad entro algo: la reconstruccion de la cache es cara y
      // en horas muertas esta corrida no trae nada. Asi el costo queda atado al
      // volumen real de pedidos y no a la frecuencia del cron.
      if (synced > 0) {
        await refreshFinanceDatasetCache(store).catch((cacheErr) =>
          console.warn(`[cron/shopify-recent cache] ${store.code}:`, cacheErr)
        );
      }

      results.push({ store: store.code, synced });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      results.push({ store: store.code, synced: 0, error: message });
    }
  }

  return NextResponse.json({ ok: true, window_minutes: minutes, results });
}
