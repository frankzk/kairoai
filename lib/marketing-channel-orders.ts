// Canal de venta (Landing / WhatsApp) de los pedidos reales para el CPA por
// producto y canal del Tablero (20/11/2026).
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
// grupos anónimos (canal, productos, unidades, cantidad de pedidos).
import type { OrderProfitabilityRow } from "./finance-orders";
import type { MarketingOriginRow } from "./marketing-attribution";
import {
  itemUnits,
  originChannel,
  type ChannelOrderGroup,
  type SaleChannel,
} from "./marketing-channel-cpa";
import { marketingDate, type MarketingPeriod } from "./marketing-dates";
import { labelNames, orderOrigin } from "./marketing-order-facts";
import {
  orderItemKey,
  orderMatcher,
  type RealOrderDay,
} from "./marketing-real-orders";

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Sale channel of one origin row (iComfly payload, saved Shopify order or upsell original). */
export function rowChannel(row: MarketingOriginRow): SaleChannel {
  // Shopify was the landing until 28/10/2026.
  if (
    row.originSource === "shopify_saved" ||
    row.originSource === "shopify_archive"
  )
    return "landing";
  const origin = orderOrigin({
    shopifyNumber: text(row.shopify_display_number) || null,
    labels: labelNames(row.labels),
    salesChannel: text(row.sales_channel) || null,
    creator: text(row.creator) || null,
  });
  return originChannel(origin, row.order_number);
}

/**
 * Finance order key → channel. An upsell replacement keeps the channel of the
 * original order (its own iComfly row was typed by the team); then iComfly
 * rows win over saved Shopify rows. Rows of the same rank that disagree
 * leave the order without channel.
 */
export function matchChannelsToOrders(
  orders: OrderProfitabilityRow[],
  rows: MarketingOriginRow[],
): Map<string, SaleChannel> {
  const match = orderMatcher(orders);
  const rank = (row: MarketingOriginRow) =>
    row.originSource === "upsell_original"
      ? 0
      : row.originSource === "icomfly" || row.originSource == null
        ? 1
        : 2;
  const found = new Map<string, Array<Set<SaleChannel>>>();
  for (const row of rows) {
    const orderKey = match(row);
    if (!orderKey) continue;
    const ranks = found.get(orderKey) ?? [new Set(), new Set(), new Set()];
    ranks[rank(row)].add(rowChannel(row));
    found.set(orderKey, ranks);
  }
  const result = new Map<string, SaleChannel>();
  for (const [orderKey, ranks] of Array.from(found)) {
    const set = ranks.find((r) => r.size > 0);
    if (set?.size === 1) result.set(orderKey, Array.from(set)[0]);
  }
  return result;
}

/**
 * Adds `mix` to each day: real (non-annulled) orders grouped by channel and
 * lines `[product key, units]`. Without `channels` (iComfly could not be
 * read) every order is "unknown": product totals stay usable.
 */
export function attachChannelMix(
  days: RealOrderDay[],
  orders: OrderProfitabilityRow[],
  channels: Map<string, SaleChannel> | null,
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
    const channel = channels?.get(order.order_key) ?? "unknown";
    const signature = JSON.stringify([channel, lines]);
    const groups = byDay.get(date) ?? new Map<string, ChannelOrderGroup>();
    const group = groups.get(signature) ?? [channel, lines, 0];
    group[2]++;
    groups.set(signature, group);
    byDay.set(date, groups);
  }
  return days.map((day) => ({
    ...day,
    mix: Array.from(byDay.get(day.date)?.values() ?? []),
  }));
}
