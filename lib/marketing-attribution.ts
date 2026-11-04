import { readIcomflyAdOrigin } from "./icomfly-ad-origin";
import { nombrePedidoIcomfly } from "./icomfly-pedidos";
import type { OrderProfitabilityRow } from "./finance-orders";
import type { MarketingPeriod } from "./marketing-dates";

export interface MarketingOriginRow {
  icomfly_order_id: string;
  order_number: unknown;
  shopify_display_number: unknown;
  store_web_seq: unknown;
  tracking_number: unknown;
  ad_origin: unknown;
}
export interface AttributionGroup {
  platform: string;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  campaignName: string;
  adsetName: string;
  adName: string;
  orders: number;
  delivered: number;
  failed: number;
  open: number;
  annulled: number;
  deliveryRate: number | null;
}
/** Counts canonical purchases once. Names describe, IDs join; unmatched is never called organic. */
export function buildMarketingAttribution(
  orders: OrderProfitabilityRow[],
  rows: MarketingOriginRow[],
  period: MarketingPeriod,
  now = new Date(),
) {
  const cohort = orders.filter((o) => {
    const t = Date.parse(o.created_at || "");
    return t >= period.start && t < period.end && t <= now.getTime();
  });
  const byName = new Map<string, Set<string>>(),
    byGuide = new Map<string, Set<string>>();
  const key = (s: unknown) =>
    String(s ?? "")
      .trim()
      .replace(/^#/, "")
      .toUpperCase();
  const add = (map: Map<string, Set<string>>, ref: unknown, order: string) => {
    const k = key(ref);
    if (k) {
      const values = map.get(k) ?? new Set<string>();
      values.add(order);
      map.set(k, values);
    }
  };
  for (const o of cohort) {
    add(byName, o.order_name, o.order_key);
    add(byGuide, o.guide_number, o.order_key);
  }
  const candidates = new Map<
    string,
    Array<NonNullable<ReturnType<typeof readIcomflyAdOrigin>>>
  >();
  for (const row of rows) {
    const origin = readIcomflyAdOrigin(row.ad_origin);
    if (!origin) continue;
    const name =
      row.shopify_display_number ||
      nombrePedidoIcomfly(
        row.order_number,
        row.icomfly_order_id,
        row.store_web_seq,
      );
    const direct = byName.get(key(name));
    const matches = direct?.size
      ? direct
      : byGuide.get(key(row.tracking_number));
    if (matches?.size !== 1) continue;
    const orderKey = Array.from(matches)[0];
    candidates.set(orderKey, [...(candidates.get(orderKey) ?? []), origin]);
  }
  const groups = new Map<string, AttributionGroup>();
  let withUtm = 0,
    linkedCampaign = 0,
    conflicts = 0,
    ambiguous = 0;
  for (const order of cohort) {
    const variants = candidates.get(order.order_key) ?? [];
    const distinct = new Map(
      variants.map((o) => [
        JSON.stringify([
          o.platform,
          o.campaignId,
          o.adsetId,
          o.adId,
          o.source,
          o.campaign,
          o.medium,
          o.content,
        ]),
        o,
      ]),
    );
    if (!distinct.size) continue;
    withUtm++;
    if (distinct.size > 1) {
      ambiguous++;
      continue;
    }
    const origin = Array.from(distinct.values())[0];
    if (origin.conflicts.length) {
      conflicts++;
      continue;
    }
    if (!origin.platform || origin.platform === "other" || !origin.campaignId)
      continue;
    linkedCampaign++;
    const groupKey = JSON.stringify([
      origin.platform,
      origin.campaignId,
      origin.adsetId,
      origin.adId,
    ]);
    const g = groups.get(groupKey) ?? {
      platform: origin.platform,
      campaignId: origin.campaignId,
      adsetId: origin.adsetId,
      adId: origin.adId,
      campaignName: origin.campaignName,
      adsetName: origin.adsetName,
      adName: origin.adName,
      orders: 0,
      delivered: 0,
      failed: 0,
      open: 0,
      annulled: 0,
      deliveryRate: null,
    };
    g.orders++;
    if (order.tracking_status === "delivered") g.delivered++;
    else if (["not_delivered", "returned"].includes(order.tracking_status))
      g.failed++;
    else if (order.tracking_status === "annulled") g.annulled++;
    else g.open++;
    groups.set(groupKey, g);
  }
  return {
    totalOrders: cohort.length,
    withUtm,
    linkedCampaign,
    withoutUtm: cohort.length - withUtm,
    conflicts,
    ambiguous,
    groups: Array.from(groups.values())
      .map((g) => ({
        ...g,
        deliveryRate:
          g.delivered + g.failed
            ? g.delivered / (g.delivered + g.failed)
            : null,
      }))
      .sort((a, b) => b.orders - a.orders),
  };
}
export type MarketingAttribution = ReturnType<typeof buildMarketingAttribution>;
