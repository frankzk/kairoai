import { NextRequest, NextResponse } from "next/server";
import { listStuckShopifyOrderIds, upsertPersistedShopifyOrders } from "@/lib/finance";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import {
  PAGE_DELAY_MS,
  buildByIdsUrl,
  fetchShopifyPage,
  mapShopifyOrder,
  sleep,
} from "@/lib/shopify-sync";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

// Shopify permite pedir por lista de ids junto con limit=250.
const CHUNK = 250;
const TIME_BUDGET_MS = 50_000;
const DEFAULT_MAX_ORDERS = 5000;
// Los pedidos recien creados que aun estan Pendiente son legitimos; solo
// re-chequeamos los que llevan un tiempo sin moverse.
const DEFAULT_MIN_AGE_DAYS = 2;

// Re-chequea pedidos "en limbo" (Pendiente en Kairo, sin anular/fulfillment/guia)
// por id exacto contra Shopify con status=any. Si en Shopify ya se anularon,
// trae cancelled_at y el pedido pasa a Anulado solo, sin inventar reglas nuevas.
// El refresh incremental por updated_at no los cubre pasada su ventana.
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const storeFilter = req.nextUrl.searchParams.get("store");
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const maxOrders =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : DEFAULT_MAX_ORDERS;
  const minAgeParam = Number(req.nextUrl.searchParams.get("min_age_days"));
  const minAgeDays =
    Number.isFinite(minAgeParam) && minAgeParam >= 0 ? minAgeParam : DEFAULT_MIN_AGE_DAYS;

  const targetStores = storeFilter
    ? FINANCE_STORES.filter((store) => store.code === storeFilter)
    : FINANCE_STORES;

  const results: Array<{
    store: string;
    candidates: number;
    checked: number;
    cancelled_found: number;
    truncated?: boolean;
    error?: string;
  }> = [];

  for (const publicStore of targetStores) {
    const store = getStoreConfig(publicStore.code);
    try {
      const stuck = await listStuckShopifyOrderIds(store.id, {
        limit: maxOrders,
        minAgeDays,
      });

      let checked = 0;
      let cancelledFound = 0;
      let anyUpserted = false;
      let truncated = false;

      for (let i = 0; i < stuck.length; i += CHUNK) {
        if (Date.now() - startedAt >= TIME_BUDGET_MS) {
          truncated = true;
          break;
        }
        const ids = stuck.slice(i, i + CHUNK).map((ref) => ref.shopify_order_id).filter(Boolean);
        if (!ids.length) continue;
        if (i > 0) await sleep(PAGE_DELAY_MS);

        const res = await fetchShopifyPage(buildByIdsUrl(ids, store), store);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Shopify error ${res.status}: ${text.slice(0, 200)}`);
        }

        const data = await res.json();
        const rawOrders = (data.orders as Array<Record<string, unknown>>) ?? [];
        const orders = rawOrders.map(mapShopifyOrder);
        // Los que llegan con cancelled_at eran candidatos con cancelled_at NULL en
        // Kairo: son anulaciones nuevas que este re-chequeo descongela.
        cancelledFound += orders.filter((order) => order.cancelled_at).length;
        await upsertPersistedShopifyOrders(orders, store.id);
        checked += ids.length;
        anyUpserted = anyUpserted || orders.length > 0;
      }

      // Solo reconstruimos la cache del dataset si algo entro (defensivo: nunca
      // rompe el cron si la cache falla).
      if (anyUpserted) {
        await refreshFinanceDatasetCache(store).catch((cacheErr) =>
          console.warn(`[cron/shopify-recheck-stale cache] ${store.code}:`, cacheErr)
        );
      }

      results.push({
        store: store.code,
        candidates: stuck.length,
        checked,
        cancelled_found: cancelledFound,
        truncated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      results.push({ store: store.code, candidates: 0, checked: 0, cancelled_found: 0, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}
