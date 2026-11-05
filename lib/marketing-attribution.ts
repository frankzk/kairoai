import type { OriginCampaign, IcomflyAdOrigin } from "./icomfly-ad-origin";
import { matchOriginsToOrders } from "./marketing-real-orders";
import type { OrderProfitabilityRow } from "./finance-orders";
import type { MarketingPeriod } from "./marketing-dates";

export interface MarketingOriginRow {
  icomfly_order_id: string;
  order_number: unknown;
  shopify_display_number: unknown;
  store_web_seq: unknown;
  tracking_number: unknown;
  ad_origin: unknown;
  resolvedOrigin?: IcomflyAdOrigin | null;
  originSource?:
    | "icomfly"
    | "shopify_saved"
    | "shopify_archive"
    | "upsell_original";
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
  catalog: OriginCampaign[] = [],
) {
  const cohort = orders.filter((o) => {
    const t = Date.parse(o.created_at || "");
    return t >= period.start && t < period.end && t <= now.getTime();
  });
  const matched = matchOriginsToOrders(cohort, rows, catalog);
  const groups = new Map<string, AttributionGroup>();
  const channelOrders = { meta: 0, tiktok: 0, other: 0 };
  let withUtm = 0,
    linkedCampaign = 0,
    conflicts = 0,
    ambiguous = 0;
  for (const order of cohort) {
    const origin = matched.get(order.order_key);
    if (!origin) continue;
    withUtm++;
    if (origin === "ambiguous") {
      ambiguous++;
      continue;
    }
    if (origin.conflicts.length) {
      conflicts++;
      continue;
    }
    if (origin.platform === "meta" || origin.platform === "tiktok")
      channelOrders[origin.platform]++;
    else if (origin.platform === "other") channelOrders.other++;
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
    channelOrders,
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
