import { NextRequest, NextResponse } from "next/server";
import {
  getPersistedShopifyCoverage,
  listPersistedShopifyOrders,
  upsertPersistedShopifyOrders,
} from "@/lib/finance";
import {
  getRequiredStoreFromBody,
  getRequiredStoreFromSearchParams,
} from "@/lib/stores";
import {
  DEFAULT_SYNC_PAGES_PER_REQUEST,
  MAX_SYNC_PAGES_PER_REQUEST,
  PAGE_DELAY_MS,
  buildInitialUrl,
  buildUpdatedUrl,
  fetchShopifyPage,
  getDefaultCreatedAtMin,
  mapShopifyOrder,
  sleep,
} from "@/lib/shopify-sync";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";
import { toFriendlyErrorMessage } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_GET_LIMIT = 1000;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  try {
    const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || 1000);
    const offset = Math.max(Number(req.nextUrl.searchParams.get("offset") || 0), 0);
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_GET_LIMIT);
    const includeCoverage = req.nextUrl.searchParams.get("coverage") !== "0";
    const [orders, coverage] = await Promise.all([
      listPersistedShopifyOrders(limit + 1, offset, store.id),
      includeCoverage ? getPersistedShopifyCoverage(store.id) : Promise.resolve(null),
    ]);
    const pageOrders = orders.slice(0, limit);
    const hasMore = orders.length > limit;
    return NextResponse.json({
      orders: pageOrders,
      total: pageOrders.length,
      coverage,
      store: store.code,
      offset,
      limit,
      has_more: hasMore,
      next_offset: hasMore ? offset + pageOrders.length : null,
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al leer pedidos Shopify sincronizados");
    return NextResponse.json({ orders: [], total: 0, coverage: null, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const store = getRequiredStoreFromBody(body);
    if (!store) return missingStoreResponse();
    const maxPages = Math.min(
      Math.max(Number(body.max_pages ?? DEFAULT_SYNC_PAGES_PER_REQUEST), 1),
      MAX_SYNC_PAGES_PER_REQUEST
    );
    const mode =
      body.mode === "backfill" ? "backfill" : body.mode === "refresh" ? "refresh" : "forward";
    const createdAtMin = String(body.created_at_min ?? getDefaultCreatedAtMin(store));

    let url: string;
    if (typeof body.next_url === "string" && body.next_url) {
      url = body.next_url;
    } else if (mode === "refresh") {
      // Recorre pedidos por updated_at para capturar guias/fulfillments que se
      // crearon despues del sync inicial (que solo mira created_at).
      const updatedAtMin = String(
        body.updated_at_min ?? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      );
      url = buildUpdatedUrl(updatedAtMin, store);
    } else if (mode === "backfill") {
      // Continua hacia atras desde el pedido mas viejo ya sincronizado, asi
      // cada llamada avanza aunque la anterior haya muerto a mitad de camino.
      const coverage = await getPersistedShopifyCoverage(store.id);
      if (!coverage.oldest) {
        url = buildInitialUrl(createdAtMin, undefined, store);
      } else if (coverage.oldest <= createdAtMin) {
        return NextResponse.json({ synced: 0, done: true, oldest: coverage.oldest, store: store.code });
      } else {
        // Se excluye el pedido frontera (ya sincronizado) restando un segundo,
        // para que cada llamada avance en vez de repetir la misma ventana.
        const beforeOldest = new Date(new Date(coverage.oldest).getTime() - 1000).toISOString();
        url = buildInitialUrl(createdAtMin, beforeOldest, store);
      }
    } else {
      url = buildInitialUrl(createdAtMin, undefined, store);
    }

    const rawOrders: Array<Record<string, unknown>> = [];
    let pagesChecked = 0;
    for (let page = 0; page < maxPages && url; page++) {
      if (page > 0) await sleep(PAGE_DELAY_MS);
      const res = await fetchShopifyPage(url, store);

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json(
          { error: `Shopify error ${res.status}: ${text.slice(0, 200)}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      rawOrders.push(...((data.orders as Array<Record<string, unknown>>) ?? []));
      pagesChecked += 1;

      const link = res.headers.get("link") ?? "";
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch?.[1] ?? "";
    }

    const orders = rawOrders.map((order) => mapShopifyOrder(order, store));
    await upsertPersistedShopifyOrders(orders, store.id);

    // El sync muto shopify_orders: refresca la cache durable del dataset (solo si
    // entraron pedidos). Defensivo: nunca rompe el sync si la cache falla.
    if (orders.length > 0) {
      await refreshFinanceDatasetCache(store).catch((cacheErr) =>
        console.warn(`[finance/shopify-sync cache] ${store.code}:`, cacheErr)
      );
    }

    const oldestFetched = orders.reduce<string | null>((min, order) => {
      const created = order.shopify_created_at;
      if (!created) return min;
      return !min || created < min ? created : min;
    }, null);

    return NextResponse.json({
      synced: orders.length,
      next_url: url || null,
      partial: Boolean(url),
      done: mode === "backfill" && !url && orders.length === 0,
      oldest: oldestFetched,
      created_at_min: createdAtMin,
      pages_checked: pagesChecked,
      store: store.code,
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error sincronizando Shopify");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function missingStoreResponse() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}
