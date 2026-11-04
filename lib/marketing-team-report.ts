import type { MarketingSummary } from "./marketing";
import type { MarketingSources } from "./marketing-source-types";
import type { MarketingSettings } from "./marketing-settings-types";
import type { UsdRate } from "./marketing-charlie-types";
import { campaignKey } from "./marketing-settings-types";
import { asUsd } from "./marketing-usd-rate";
import { marketingDate, shiftDate } from "./marketing-dates";

/** No currency is summed before conversion. Missing sources/rates stay unknown. */
export function reportChannel(
  sources: MarketingSources | null,
  platform: "meta" | "tiktok",
  fx: UsdRate | null,
) {
  const source = sources?.[platform];
  const accounts = source?.status === "ready" ? source.data?.accounts : null;
  if (!accounts?.length)
    return { spend: null, purchases: null, conversions: null };
  const amounts = accounts.map((a) =>
    asUsd(
      a.campaigns.reduce((n, c) => n + c.spend, 0),
      a.currency,
      fx,
    ),
  );
  const campaigns = accounts.flatMap((a) => a.campaigns);
  return {
    spend: amounts.every((v) => v != null)
      ? amounts.reduce<number>((n, v) => n + v!, 0)
      : null,
    conversions: campaigns.every(
      (c) => c.daily && c.daily.every((d) => d.purchases != null),
    )
      ? campaigns.reduce(
          (n, c) => n + c.daily!.reduce((s, d) => s + d.purchases!, 0),
          0,
        )
      : null,
    purchases: campaigns.every((c) => c.purchases != null)
      ? campaigns.reduce((n, c) => n + c.purchases!, 0)
      : null,
  };
}

export function productComparison(
  summary: MarketingSummary,
  sources: MarketingSources | null,
  settings: MarketingSettings | null,
  fx: UsdRate | null,
  now = new Date(),
) {
  const today = marketingDate(now),
    yesterday = shiftDate(today, -1),
    from = shiftDate(today, -7);
  const mappings = new Map(
    settings?.mappings.map((m) => [
      campaignKey(m.platform, m.account_id, m.campaign_id),
      m.product_key,
    ]) ?? [],
  );
  const ready = Boolean(
    settings &&
    sources?.meta.status === "ready" &&
    sources.tiktok.status === "ready",
  );
  const campaigns = (["meta", "tiktok"] as const).flatMap(
    (platform) =>
      sources?.[platform].data?.accounts.flatMap((a) =>
        a.campaigns.map((c) => ({
          ...c,
          currency: a.currency,
          timezone: a.timezone,
          product: mappings.get(campaignKey(platform, a.accountId, c.id)),
        })),
      ) ?? [],
  );
  const complete =
    ready && campaigns.every((c) => c.spend === 0 || Boolean(c.product));
  return summary.products.map((p) => {
    const related = campaigns.filter((c) => c.product === p.key);
    function cpa(start: string, end: string, orders: number) {
      if (
        !complete ||
        !related.length ||
        !orders ||
        related.some((c) => c.timezone !== summary.timezone || !c.daily)
      )
        return null;
      const values = related.map((c) =>
        asUsd(
          c
            .daily!.filter((d) => d.date >= start && d.date <= end)
            .reduce((n, d) => n + d.spend, 0),
          c.currency,
          fx,
        ),
      );
      return values.every((v) => v != null)
        ? values.reduce<number>((n, v) => n + v!, 0) / orders
        : null;
    }
    return {
      ...p,
      cpas: [
        cpa(today, today, p.todayOrders),
        cpa(yesterday, yesterday, p.yesterdayOrders),
        cpa(from, yesterday, p.sevenDayOrders),
      ],
    };
  });
}
