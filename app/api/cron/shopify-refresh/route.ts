import { NextRequest, NextResponse } from "next/server";
import { upsertPersistedShopifyOrders } from "@/lib/finance";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import {
  PAGE_DELAY_MS,
  buildUpdatedUrl,
  fetchShopifyPage,
  mapShopifyOrder,
  sleep,
} from "@/lib/shopify-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_REFRESH_DAYS = 14;
const MAX_PAGES_PER_STORE = 4;

// Refresca pedidos por updated_at para capturar guias/fulfillments creados
// despues del sync inicial (que solo mira created_at y nunca reconsulta).
export async function GET(req: NextRequest) {
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : DEFAULT_REFRESH_DAYS;
  const storeFilter = req.nextUrl.searchParams.get("store");
  const updatedAtMin = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const targetStores = storeFilter
    ? FINANCE_STORES.filter((store) => store.code === storeFilter)
    : FINANCE_STORES;

  const results: Array<{ store: string; synced: number; error?: string }> = [];

  for (const publicStore of targetStores) {
    const store = getStoreConfig(publicStore.code);
    try {
      let url = buildUpdatedUrl(updatedAtMin, store);
      let synced = 0;

      for (let page = 0; page < MAX_PAGES_PER_STORE && url; page++) {
        if (page > 0) await sleep(PAGE_DELAY_MS);
        const res = await fetchShopifyPage(url, store);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Shopify error ${res.status}: ${text.slice(0, 200)}`);
        }

        const data = await res.json();
        const rawOrders = (data.orders as Array<Record<string, unknown>>) ?? [];
        const orders = rawOrders.map(mapShopifyOrder);
        await upsertPersistedShopifyOrders(orders, store.id);
        synced += orders.length;

        const link = res.headers.get("link") ?? "";
        const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch?.[1] ?? "";
      }

      results.push({ store: store.code, synced });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      results.push({ store: store.code, synced: 0, error: message });
    }
  }

  return NextResponse.json({ ok: true, results });
}
