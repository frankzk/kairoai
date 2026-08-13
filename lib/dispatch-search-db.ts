// Consulta de la busqueda del tablero de despacho (guia / celular / pedido).
// Las reglas de interpretacion y etiquetado viven en dispatch-search.ts.
//
// Por que hace falta un puente contra Shopify: iComfly NO guarda el telefono
// del cliente, y su tracking_number viene vacio en buena parte de los pedidos
// (los recien creados). Shopify si tiene ambos, asi que enlazamos por el
// numero visible del pedido:
//
//   icomfly_orders.shopify_display_number  ==  shopify_orders.name   ("#MCRC13403")

import { getDB } from "./db";
import { phoneConfigForStore } from "./phone-cr";
import {
  labelDispatchMatches,
  parseDispatchQuery,
  phoneLikePatterns,
  type DispatchSearchHit,
  type DispatchSearchTerms,
} from "./dispatch-search";
import type { IcomflyOrderRecord } from "./finance-types";

const MAX_HITS = 100;

interface ShopifyLookupRow {
  name: string | null;
  phone: string | null;
  tracking_number: string | null;
}

/**
 * Busca pedidos por guia, celular o numero de pedido sobre toda la BD (no solo
 * los pedidos visibles en el tablero). Devuelve null si la consulta es
 * demasiado corta para buscar.
 */
export async function searchDispatchOrders(opts: {
  storeId: number;
  storeCode?: string | null;
  query: string;
  limit?: number;
}): Promise<{ terms: DispatchSearchTerms; hits: DispatchSearchHit[] } | null> {
  const cfg = phoneConfigForStore(opts.storeCode);
  const terms = parseDispatchQuery(opts.query, cfg);
  if (!terms) return null;

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_HITS);
  const db = getDB();
  const { storeId } = opts;
  const like = `%${terms.text}%`;

  // (a) Match directo contra iComfly: numero de pedido o guia ya sincronizada.
  //     '*' es el comodin de PostgREST dentro de or().
  const wild = `*${terms.text}*`;
  const directQuery = db
    .from("icomfly_orders")
    .select("*")
    .eq("store_id", storeId)
    .or(
      [
        `order_number.ilike.${wild}`,
        `shopify_display_number.ilike.${wild}`,
        `tracking_number.ilike.${wild}`,
      ].join(",")
    )
    .limit(limit);

  // (b) Guia que solo esta en Shopify (iComfly aun no la trae).
  const byGuideQuery = db
    .from("shopify_orders")
    .select("name")
    .eq("store_id", storeId)
    .ilike("tracking_number", like)
    .limit(limit);

  // (c) Celular: cada variante de formato como consulta aparte, para no tener
  //     que escapar espacios dentro de un or() de PostgREST.
  const phoneQueries = terms.national
    ? phoneLikePatterns(terms.national).map((pattern) =>
        db
          .from("shopify_orders")
          .select("name")
          .eq("store_id", storeId)
          .ilike("phone", pattern)
          .limit(limit)
      )
    : [];

  const [directRes, byGuideRes, ...phoneResults] = await Promise.all([
    directQuery,
    byGuideQuery,
    ...phoneQueries,
  ]);

  if (directRes.error) {
    throw new Error(`searchDispatchOrders (pedido/guia): ${directRes.error.message}`);
  }
  if (byGuideRes.error) {
    throw new Error(`searchDispatchOrders (guia Shopify): ${byGuideRes.error.message}`);
  }
  for (const res of phoneResults) {
    if (res.error) throw new Error(`searchDispatchOrders (celular): ${res.error.message}`);
  }

  const names = new Set<string>();
  for (const res of [byGuideRes, ...phoneResults]) {
    for (const row of (res.data ?? []) as Array<{ name: string | null }>) {
      if (row.name) names.add(row.name);
    }
  }

  const orders = new Map<string, IcomflyOrderRecord>();
  for (const row of (directRes.data ?? []) as IcomflyOrderRecord[]) {
    orders.set(row.icomfly_order_id, row);
  }

  // (d) De los numeros visibles encontrados en Shopify, de vuelta a iComfly.
  if (names.size) {
    const { data, error } = await db
      .from("icomfly_orders")
      .select("*")
      .eq("store_id", storeId)
      .in("shopify_display_number", Array.from(names))
      .limit(limit);
    if (error) throw new Error(`searchDispatchOrders (pedidos por Shopify): ${error.message}`);
    for (const row of (data ?? []) as IcomflyOrderRecord[]) {
      orders.set(row.icomfly_order_id, row);
    }
  }

  if (!orders.size) return { terms, hits: [] };

  // (e) Enriquecer con telefono y guia, para mostrarlos y para etiquetar.
  const displayNumbers = Array.from(
    new Set(
      Array.from(orders.values())
        .map((o) => o.shopify_display_number)
        .filter(Boolean)
    )
  );
  const shopifyByName = new Map<string, ShopifyLookupRow>();
  if (displayNumbers.length) {
    const { data, error } = await db
      .from("shopify_orders")
      .select("name,phone,tracking_number")
      .eq("store_id", storeId)
      .in("name", displayNumbers);
    if (error) throw new Error(`searchDispatchOrders (datos de Shopify): ${error.message}`);
    for (const row of (data ?? []) as ShopifyLookupRow[]) {
      if (row.name) shopifyByName.set(row.name.toUpperCase(), row);
    }
  }

  const hits: DispatchSearchHit[] = Array.from(orders.values()).map((order) => {
    const shopify = shopifyByName.get(String(order.shopify_display_number).toUpperCase());
    const phone = shopify?.phone ?? "";
    const guide = order.tracking_number?.trim() || shopify?.tracking_number?.trim() || "";
    return { order, phone, guide, matched: labelDispatchMatches(order, phone, guide, terms) };
  });

  // Mas recientes primero, igual que el tablero.
  hits.sort((a, b) =>
    String(b.order.requested_at ?? b.order.icomfly_created_at ?? "").localeCompare(
      String(a.order.requested_at ?? a.order.icomfly_created_at ?? "")
    )
  );

  return { terms, hits: hits.slice(0, limit) };
}
