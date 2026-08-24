// Corrida de refresco de pedidos por updated_at, compartida por los dos crons
// que la usan:
//
//   - shopify-recent  (cada 10 min, ventana corta): es el que hace que un
//     pedido nuevo aparezca en el tablero sin apretar "Sync Shopify".
//   - shopify-refresh (cada 3 h, ventana de 14 dias): la barrida de respaldo,
//     que ademas recoge guias y fulfillments creados despues del pedido.
//
// La logica es la misma; lo unico que cambia es que tan atras mira cada una.

import { upsertPersistedShopifyOrders } from "./finance";
import { buildUpdatedUrl, fetchShopifyPage, mapShopifyOrder, PAGE_DELAY_MS, sleep } from "./shopify-sync";
import type { FinanceStoreConfig } from "./stores";

export interface RefreshRunResult {
  synced: number;
  pages: number;
  /** Cursor cuando la corrida se freno por tiempo o por tope de paginas. */
  next_url: string | null;
}

/** Ventana hacia atras, en ISO, a partir de minutos o dias. */
export function windowStart(opts: { minutes?: number; days?: number }, now: number = Date.now()): string {
  const ms =
    opts.minutes && opts.minutes > 0
      ? opts.minutes * 60_000
      : (opts.days && opts.days > 0 ? opts.days : 14) * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

export async function runShopifyRefresh(opts: {
  store: FinanceStoreConfig;
  updatedAtMin: string;
  /** Se corta al acercarse a maxDuration; lo que quede vuelve en la proxima. */
  timeBudgetMs: number;
  maxPages: number;
  startedAt: number;
  /** Continua una corrida anterior desde su cursor. */
  resumeUrl?: string | null;
}): Promise<RefreshRunResult> {
  let url = opts.resumeUrl || buildUpdatedUrl(opts.updatedAtMin, opts.store);
  let synced = 0;
  let pages = 0;

  while (url && pages < opts.maxPages && Date.now() - opts.startedAt < opts.timeBudgetMs) {
    if (pages > 0) await sleep(PAGE_DELAY_MS);
    const res = await fetchShopifyPage(url, opts.store);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const rawOrders = (data.orders as Array<Record<string, unknown>>) ?? [];
    const orders = rawOrders.map(mapShopifyOrder);
    await upsertPersistedShopifyOrders(orders, opts.store.id);
    synced += orders.length;
    pages += 1;

    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? "";
  }

  return { synced, pages, next_url: url || null };
}
