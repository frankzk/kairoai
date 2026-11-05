// Pedidos reales por anuncio para el Centro de sustracción (documento de
// mejoras, A4). La sustracción trabaja con el reporte de anuncios (Charlie),
// así que el gasto diario de cada campaña sale de la suma de sus anuncios y
// no hace falta pedir otra vez las campañas a Meta ni a TikTok. Puro.
import type { MarketingSummary } from "./marketing";
import type { MarketingControl } from "./marketing-real-orders";
import type {
  MarketingAdsData,
  MarketingCampaign,
  MarketingSources,
} from "./marketing-source-types";
import type { MarketingSettings } from "./marketing-settings-types";
import type { CharlieReport, UsdRate } from "./marketing-charlie-types";
import { asUsd } from "./marketing-usd-rate";
import {
  buildRealEstimate,
  estimateAdRealOrders,
  type AdRealOrders,
  type AdSpendRow,
} from "./marketing-real-cpa";

const ready = (accounts: MarketingAdsData[]) => ({
  status: "ready" as const,
  checkedAt: "",
  message: "",
  data: { accounts },
});

/**
 * Campaigns of the ad report as a sources object: daily spend, clicks and
 * purchases summed over each campaign's ads. Names come from `names` (the
 * campaign list of the period) when the report does not carry them.
 */
export function charlieCampaignSources(
  report: CharlieReport | null,
  names?: MarketingSources | null,
): MarketingSources | null {
  if (report?.status !== "ready" || !report.data) return null;
  const known = new Map<string, string>();
  for (const platform of ["meta", "tiktok"] as const)
    for (const account of names?.[platform].data?.accounts ?? [])
      for (const campaign of account.campaigns)
        known.set(
          `${platform}:${account.accountId}:${campaign.id}`,
          campaign.name,
        );
  const accounts = {
    meta: [] as MarketingAdsData[],
    tiktok: [] as MarketingAdsData[],
  };
  for (const account of report.data.accounts) {
    const platform = account.platform ?? "meta";
    const campaigns = new Map<string, MarketingCampaign>();
    for (const ad of account.ads) {
      const campaign = campaigns.get(ad.campaignId) ?? {
        id: ad.campaignId,
        name:
          known.get(`${platform}:${account.id}:${ad.campaignId}`) ||
          ad.campaignName ||
          ad.campaignId,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        daily: [],
      };
      for (const row of ad.daily) {
        campaign.spend += row.spend;
        campaign.impressions += row.impressions;
        campaign.clicks += row.clicks;
        campaign.purchases = (campaign.purchases ?? 0) + row.purchases;
        const day = campaign.daily!.find((d) => d.date === row.date);
        if (day) {
          day.spend += row.spend;
          day.impressions += row.impressions;
          day.clicks += row.clicks;
          day.purchases = (day.purchases ?? 0) + row.purchases;
        } else
          campaign.daily!.push({
            date: row.date,
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            purchases: row.purchases,
          });
      }
      campaigns.set(ad.campaignId, campaign);
    }
    accounts[platform].push({
      accountId: account.id,
      accountName: account.name,
      currency: account.currency,
      timezone: account.timezone,
      campaigns: Array.from(campaigns.values()).map((c) => ({
        ...c,
        daily: c.daily!.sort((a, b) => a.date.localeCompare(b.date)),
      })),
    });
  }
  return {
    meta: ready(accounts.meta),
    tiktok: ready(accounts.tiktok),
    shiphero: { status: "pending", checkedAt: "", message: "", data: null },
  };
}

/** Daily USD spend of every ad of the report. */
export function charlieAdSpendRows(
  report: CharlieReport | null,
  fx: UsdRate | null,
): AdSpendRow[] {
  if (report?.status !== "ready" || !report.data) return [];
  return report.data.accounts.flatMap((account) =>
    account.ads.flatMap((ad) =>
      ad.daily.map((row) => ({
        platform: account.platform ?? "meta",
        accountId: account.id,
        campaignId: ad.campaignId,
        adId: ad.id,
        date: row.date,
        spendUsd: asUsd(row.spend, account.currency, fx),
      })),
    ),
  );
}

/**
 * Real orders per ad and day (UTM of the ad + its share of the campaign
 * estimate). null until the ad report, the orders, the catalogue and the
 * assignments are all available: the panel then keeps the pixel reasons.
 */
export function subtractionRealOrders(input: {
  report: CharlieReport | null;
  sources: MarketingSources | null;
  summary: Pick<MarketingSummary, "productFamilies" | "familyDataError"> | null;
  settings: MarketingSettings | null;
  control: MarketingControl | null;
  fx: UsdRate | null;
}): AdRealOrders | null {
  if (!input.summary || !input.settings || !input.control) return null;
  const sources = charlieCampaignSources(input.report, input.sources);
  if (!sources) return null;
  const { estimates } = buildRealEstimate({
    summary: input.summary,
    sources,
    settings: input.settings,
    control: input.control,
    fx: input.fx,
  });
  return estimateAdRealOrders({
    days: input.control.days,
    campaigns: estimates,
    ads: charlieAdSpendRows(input.report, input.fx),
  });
}
