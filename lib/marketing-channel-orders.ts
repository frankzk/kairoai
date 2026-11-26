// Canal de venta (Página web / WhatsApp) de los pedidos reales para el CPA
// por producto y canal del Tablero (20/11/2026), con el origen fino dentro del
// canal (26/11/2026: bot, Conector IA, asesora, manual; formulario, carrito,
// Shopify).
//
// Los pedidos y sus productos salen del dataset de Finanzas (los mismos que
// cuentan el CPA general por producto); el canal sale del pedido de iComfly
// que les corresponde, con el mismo cruce único por número de pedido o guía
// que los UTM (orderMatcher). Las reglas del canal están en
// lib/marketing-channel-cpa.ts. Un pedido sin cruce queda "sin canal": nunca
// se adivina.
//
// Solo servidor por sus dependencias (lib/marketing-order-facts.ts), pero
// puro: se prueba en tests/marketing-channel-cpa.test.ts. Lo que sale son
// grupos anónimos (canal, productos, unidades, cantidad de pedidos, origen).
import type { OrderProfitabilityRow } from "./finance-orders";
import type { MarketingOriginRow } from "./marketing-attribution";
import {
  itemUnits,
  saleOriginChannel,
  type ChannelOrderGroup,
  type SaleChannel,
  type SaleOrigin,
} from "./marketing-channel-cpa";
import { marketingDate, type MarketingPeriod } from "./marketing-dates";
import { labelNames, orderSubOrigin } from "./marketing-order-facts";
import {
  orderItemKey,
  orderMatcher,
  type RealOrderDay,
} from "./marketing-real-orders";

/** Channel of one order and its origin inside the channel. */
export interface OrderChannel {
  channel: SaleChannel;
  origin: SaleOrigin;
}

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Origin of one row (iComfly payload, saved Shopify order or upsell original). */
export function rowSaleOrigin(
  row: MarketingOriginRow,
): Exclude<SaleOrigin, "otro"> {
  // Shopify was the landing until 28/10/2026.
  if (
    row.originSource === "shopify_saved" ||
    row.originSource === "shopify_archive"
  )
    return "shopify";
  // An upsell row carries the replacement's name in its numbers (to match the
  // replacement order); the original's own numbers decide its origin.
  const upsell = row.originSource === "upsell_original";
  return orderSubOrigin({
    shopifyNumber:
      text(upsell ? row.originalShopifyNumber : row.shopify_display_number) ||
      null,
    labels: labelNames(row.labels),
    salesChannel: text(row.sales_channel) || null,
    creator: text(row.creator) || null,
    orderNumber: upsell ? row.originalOrderNumber : row.order_number,
  });
}

/** Sale channel of one origin row. */
export function rowChannel(row: MarketingOriginRow): SaleChannel {
  return saleOriginChannel(rowSaleOrigin(row)) ?? "landing";
}

/**
 * Finance order key → channel and origin. An upsell replacement keeps the
 * channel and origin of the original order (its own iComfly row was typed by
 * the team); then iComfly rows win over saved Shopify rows. Rows of the same
 * rank that disagree on the channel leave the order without channel; rows
 * that agree on the channel but not on the origin keep the channel with
 * origin "otro".
 */
export function matchChannelsToOrders(
  orders: OrderProfitabilityRow[],
  rows: MarketingOriginRow[],
): Map<string, OrderChannel> {
  const match = orderMatcher(orders);
  const rank = (row: MarketingOriginRow) =>
    row.originSource === "upsell_original"
      ? 0
      : row.originSource === "icomfly" || row.originSource == null
        ? 1
        : 2;
  const found = new Map<string, Array<Set<SaleOrigin>>>();
  for (const row of rows) {
    const orderKey = match(row);
    if (!orderKey) continue;
    const ranks = found.get(orderKey) ?? [new Set(), new Set(), new Set()];
    ranks[rank(row)].add(rowSaleOrigin(row));
    found.set(orderKey, ranks);
  }
  const result = new Map<string, OrderChannel>();
  for (const [orderKey, ranks] of Array.from(found)) {
    const set = ranks.find((r) => r.size > 0);
    if (!set) continue;
    const origins = Array.from(set);
    const channels = new Set(origins.map(saleOriginChannel));
    if (channels.size !== 1) continue;
    const channel = Array.from(channels)[0];
    if (!channel) continue;
    result.set(orderKey, {
      channel,
      origin: origins.length === 1 ? origins[0] : "otro",
    });
  }
  return result;
}

/**
 * Adds `mix` to each day: real (non-annulled) orders grouped by channel,
 * lines `[product key, units]` and origin. Without `channels` (iComfly could
 * not be read) every order is "unknown": product totals stay usable.
 */
export function attachChannelMix(
  days: RealOrderDay[],
  orders: OrderProfitabilityRow[],
  channels: Map<string, OrderChannel> | null,
  period: Pick<MarketingPeriod, "start" | "end">,
  now = new Date(),
): RealOrderDay[] {
  const byDay = new Map<string, Map<string, ChannelOrderGroup>>();
  for (const order of orders) {
    if (order.tracking_status === "annulled") continue;
    const time = Date.parse(order.created_at || "");
    if (!(time >= period.start && time < period.end && time <= now.getTime()))
      continue;
    const date = marketingDate(new Date(time));
    const units = new Map<string, number>();
    for (const item of order.items) {
      const key = orderItemKey(item);
      if (key === "name:") continue;
      units.set(key, (units.get(key) ?? 0) + itemUnits(item));
    }
    const lines = Array.from(units)
      .map(([key, n]): [string, number] => [key, Math.round(n * 1000) / 1000])
      .sort((a, b) => a[0].localeCompare(b[0]));
    const found = channels?.get(order.order_key);
    const signature = JSON.stringify([found?.channel, lines, found?.origin]);
    const groups = byDay.get(date) ?? new Map<string, ChannelOrderGroup>();
    const group: ChannelOrderGroup = groups.get(signature) ??
      (found
        ? [found.channel, lines, 0, found.origin]
        : ["unknown", lines, 0]);
    group[2]++;
    groups.set(signature, group);
    byDay.set(date, groups);
  }
  return days.map((day) => ({
    ...day,
    mix: Array.from(byDay.get(day.date)?.values() ?? []),
  }));
}
