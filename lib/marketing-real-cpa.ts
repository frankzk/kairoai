// Pedidos reales por campaña y por anuncio (documento de mejoras, A1, A4,
// A6 y módulo 2). Solo ~1 de cada 3 pedidos trae UTM de campaña, así que el
// estimador es híbrido: los pedidos con UTM van a su campaña y el resto se
// reparte por producto asignado, en proporción al gasto del día de cada
// campaña que vende ese producto. Converge a UTM puro cuando iComfly capture
// los UTM en su formulario. Puro.
import type { MarketingSummary } from "./marketing";
import type { MarketingControl, RealOrderDay } from "./marketing-real-orders";
import type {
  MarketingAdsData,
  MarketingCampaign,
  MarketingSources,
} from "./marketing-source-types";
import {
  campaignKey,
  type CampaignProduct,
  type MarketingSettings,
} from "./marketing-settings-types";
import type { UsdRate } from "./marketing-charlie-types";
import {
  effectiveAssignment,
  type MarketingFamily,
} from "./marketing-product-families";
import {
  buildKeywordIndex,
  type KeywordIndex,
} from "./marketing-campaign-keywords";
import { asUsd } from "./marketing-usd-rate";

export type AdPlatform = "meta" | "tiktok";
export const utmKey = (platform: AdPlatform, campaignId: string) =>
  `${platform}:${campaignId}`;

/** Spend of one campaign on one CR date. `spendUsd` null = day not reported (TikTok lag) or not convertible. */
export interface SpendRow {
  platform: AdPlatform;
  accountId: string;
  campaignId: string;
  date: string;
  spendUsd: number | null;
}
export interface CampaignRealDay {
  /** Real orders with this campaign's UTM. */
  utm: number;
  /** Share of the product's orders without UTM. */
  assigned: number;
  /** utm + assigned; null when the campaign's spend that day is unknown. */
  total: number | null;
  /** Unassigned campaign, unknown own spend, or a partner campaign with no spend data at all. */
  partial: boolean;
  /** A partner campaign of the same product had not reported that day; its latest reported day was used for the split. */
  proxied?: boolean;
  /** No product assigned: only UTM orders are known, the rest is unknown (not zero). */
  unassigned?: boolean;
}
/** campaignKey(platform, account, campaign) → date → estimate. */
export type CampaignEstimates = Map<string, Map<string, CampaignRealDay>>;

/** Catalog keys a campaign mapping sells: all members of the family, the selected variants, or the legacy product key. */
export function mappingMemberKeys(
  mapping: CampaignProduct,
  families: MarketingFamily[],
): string[] {
  if (mapping.variant_scope === "none") return [];
  if (mapping.variant_scope === "selected")
    return Array.from(new Set(mapping.variant_keys ?? []));
  if (mapping.variant_scope === "all") {
    const family = families.find(
      (f) => f.key === (mapping.family_key || mapping.product_key),
    );
    return family ? family.members.map((m) => m.key) : [];
  }
  return mapping.product_key ? [mapping.product_key] : [];
}

const parseCampaignKey = (key: string) => {
  const [platform, accountId, ...rest] = key.split(":");
  return {
    platform: platform as AdPlatform,
    accountId,
    campaignId: rest.join(":"),
  };
};

/**
 * assigned(c,d) = Σ_{sku ∈ members(c)} unlinked[d][sku] × spend(c,d) / Σ_{c' sells sku} spend(c',d).
 * A product whose campaigns spent nothing that day keeps its orders
 * undistributed, so Σ total(c,d) ≤ real(d).
 */
export function estimateCampaignRealOrders(input: {
  days: RealOrderDay[];
  spend: SpendRow[];
  members: Map<string, string[]>;
}): CampaignEstimates {
  const spendBy = new Map<string, Map<string, number | null>>();
  const campaigns = new Set<string>(input.members.keys());
  for (const row of input.spend) {
    const key = campaignKey(row.platform, row.accountId, row.campaignId);
    campaigns.add(key);
    const dates = spendBy.get(key) ?? new Map<string, number | null>();
    const before = dates.get(row.date);
    dates.set(
      row.date,
      before === null || row.spendUsd == null
        ? null
        : (before ?? 0) + row.spendUsd,
    );
    spendBy.set(key, dates);
  }
  const spendOf = (key: string, date: string) => {
    const value = spendBy.get(key)?.get(date);
    return value === undefined ? 0 : value;
  };
  // A partner that has not reported yet (TikTok arrives a day late) takes
  // part in the split with its latest reported day, so the other campaigns
  // of the product are not left without an estimate every morning.
  const poolSpendOf = (key: string, date: string) => {
    const value = spendOf(key, date);
    if (value != null) return { value, proxied: false };
    const earlier = Array.from(spendBy.get(key) ?? [])
      .filter(([d, v]) => d < date && v != null)
      .sort(([a], [b]) => (a < b ? 1 : -1))[0];
    return earlier
      ? { value: earlier[1] as number, proxied: true }
      : { value: null, proxied: false };
  };
  const sellers = new Map<string, string[]>();
  for (const [key, skus] of Array.from(input.members))
    for (const sku of skus)
      sellers.set(sku, [...(sellers.get(sku) ?? []), key]);
  const out: CampaignEstimates = new Map();
  for (const key of Array.from(campaigns)) out.set(key, new Map());
  for (const day of input.days)
    for (const key of Array.from(campaigns)) {
      const { platform, campaignId } = parseCampaignKey(key);
      const utm = day.byCampaign[utmKey(platform, campaignId)] ?? 0;
      const skus = input.members.get(key) ?? [];
      if (!skus.length) {
        out.get(key)!.set(day.date, {
          utm,
          assigned: 0,
          total: utm,
          partial: true,
          unassigned: true,
        });
        continue;
      }
      const own = spendOf(key, day.date);
      let assigned = 0,
        partial = false,
        proxied = false;
      for (const sku of skus) {
        const pool = sellers.get(sku) ?? [];
        const spends = pool.map((other) => poolSpendOf(other, day.date));
        if (spends.some((v) => v.value == null)) partial = true;
        if (spends.some((v) => v.proxied)) proxied = true;
        const poolSpend = spends.reduce<number>(
          (n, v) => n + (v.value ?? 0),
          0,
        );
        const orders = day.unlinkedBySku[sku] ?? 0;
        if (own != null && poolSpend > 0 && orders > 0)
          assigned += (orders * own) / poolSpend;
      }
      out.get(key)!.set(day.date, {
        utm,
        assigned: own == null ? 0 : round4(assigned),
        total: own == null ? null : round4(utm + assigned),
        partial: partial || own == null,
        ...(proxied && own != null ? { proxied: true } : {}),
      });
    }
  return out;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Sum of a campaign's estimate over [from, to]. A missing or unknown day makes it partial. */
export function sumWindow(
  days: Map<string, CampaignRealDay> | undefined,
  from: string,
  to: string,
): { orders: number | null; utm: number; partial: boolean } {
  if (!days) return { orders: null, utm: 0, partial: true };
  let orders = 0,
    utm = 0,
    known = 0,
    partial = false;
  for (let date = from; date <= to; date = nextDate(date)) {
    const day = days.get(date);
    if (!day) {
      partial = true;
      continue;
    }
    utm += day.utm;
    if (day.partial) partial = true;
    if (day.total == null) {
      partial = true;
      continue;
    }
    orders += day.total;
    known++;
  }
  return { orders: known ? round4(orders) : null, utm, partial };
}

const nextDate = (date: string) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);

export interface AdSpendRow {
  platform: AdPlatform;
  accountId: string;
  campaignId: string;
  adId: string;
  date: string;
  spendUsd: number | null;
}
export type AdRealOrders = (
  platform: AdPlatform,
  accountId: string,
  campaignId: string,
  adId: string,
  date: string,
) => { orders: number; basis: "utm" | "estimado" } | null;

/**
 * adReal = utm(ad) + max(0, campaignEstimate − Σ utm(ads of the campaign)) × adSpend / campaignSpend,
 * with campaignSpend = Σ daily spend of the campaign's ads.
 */
export function estimateAdRealOrders(input: {
  days: RealOrderDay[];
  campaigns: CampaignEstimates;
  ads: AdSpendRow[];
}): AdRealOrders {
  const days = new Map(input.days.map((d) => [d.date, d]));
  const groups = new Map<string, AdSpendRow[]>();
  for (const ad of input.ads) {
    const key = `${campaignKey(ad.platform, ad.accountId, ad.campaignId)}|${ad.date}`;
    groups.set(key, [...(groups.get(key) ?? []), ad]);
  }
  return (platform, accountId, campaignId, adId, date) => {
    const day = days.get(date);
    const campaign = input.campaigns
      .get(campaignKey(platform, accountId, campaignId))
      ?.get(date);
    // Without a product, the campaign's orders without UTM are unknown: an
    // ad's UTM count alone would read as "0 real orders".
    if (!day || !campaign || campaign.total == null || campaign.unassigned)
      return null;
    const ads =
      groups.get(`${campaignKey(platform, accountId, campaignId)}|${date}`) ??
      [];
    const ids = Array.from(new Set(ads.map((a) => a.adId)));
    if (!ids.includes(adId)) ids.push(adId);
    const utmOf = (id: string) => day.byAd[`${platform}:${id}`] ?? 0;
    const adsUtm = ids.reduce((n, id) => n + utmOf(id), 0);
    const remainder = Math.max(0, campaign.total - adsUtm);
    const spendOf = (id: string) =>
      ads
        .filter((a) => a.adId === id)
        .reduce<
          number | null
        >((n, a) => (n == null || a.spendUsd == null ? null : n + a.spendUsd), 0);
    const own = spendOf(adId);
    const spends = ids.map(spendOf);
    const total = spends.every((v) => v != null)
      ? spends.reduce<number>((n, v) => n + v!, 0)
      : null;
    const share =
      remainder > 0 && own != null && total != null && total > 0
        ? (remainder * own) / total
        : 0;
    return {
      orders: round4(utmOf(adId) + share),
      basis: remainder > 0 || campaign.assigned > 0 ? "estimado" : "utm",
    };
  };
}

/** CPA real (sin anulados) y CPA con pedidos creados, como referencia. */
export function realCpa(
  spendUsd: number | null,
  created: number,
  annulled: number,
): { real: number; cpaReal: number | null; cpaCreated: number | null } {
  const real = Math.max(0, created - annulled);
  return {
    real,
    cpaReal: spendUsd != null && real > 0 ? spendUsd / real : null,
    cpaCreated: spendUsd != null && created > 0 ? spendUsd / created : null,
  };
}

/** A campaign of the sources with its effective product assignment. */
export interface AssignedCampaign {
  key: string;
  platform: AdPlatform;
  account: MarketingAdsData;
  campaign: MarketingCampaign;
  mapping: CampaignProduct | null;
  members: string[];
  /** Last date with daily data in the account (TikTok arrives a day late). */
  observedThrough: string | null;
}

/** Campaign → product, with the same precedence everywhere (stored, alias, exact, keyword). */
export function assignedCampaigns(
  summary: Pick<MarketingSummary, "productFamilies" | "familyDataError">,
  sources: MarketingSources | null,
  settings: MarketingSettings | null,
  keywords?: KeywordIndex,
): AssignedCampaign[] {
  const families = summary.productFamilies ?? [];
  const index =
    keywords ?? buildKeywordIndex(families, settings?.keywords ?? []);
  const stored = new Map(
    settings?.mappings.map((m) => [
      campaignKey(m.platform, m.account_id, m.campaign_id),
      m,
    ]) ?? [],
  );
  return (["meta", "tiktok"] as const).flatMap((platform) => {
    const source = sources?.[platform];
    if (source?.status !== "ready") return [];
    return (source.data?.accounts ?? []).flatMap((account) => {
      const observedThrough =
        account.campaigns
          .flatMap((c) => c.daily?.map((d) => d.date) ?? [])
          .sort()
          .at(-1) ?? null;
      return account.campaigns.map((campaign) => {
        const key = campaignKey(platform, account.accountId, campaign.id);
        const mapping = effectiveAssignment(
          stored.get(key),
          families,
          platform,
          account.accountId,
          campaign.id,
          campaign.name,
          Boolean(settings) && !summary.familyDataError,
          settings?.mappings ?? [],
          index,
        );
        return {
          key,
          platform,
          account,
          campaign,
          mapping,
          members: mapping ? mappingMemberKeys(mapping, families) : [],
          observedThrough,
        };
      });
    });
  });
}

/**
 * Daily USD spend of each campaign for the given dates. A date without a row
 * is 0, except TikTok dates after the account's last reported day (null) and
 * campaigns without daily detail (null).
 */
export function campaignSpendRows(
  campaigns: AssignedCampaign[],
  dates: string[],
  fx: UsdRate | null,
): SpendRow[] {
  return campaigns.flatMap((c) =>
    dates.map((date) => {
      const lagging =
        c.platform === "tiktok" &&
        (c.observedThrough == null || date > c.observedThrough);
      const rows = c.campaign.daily?.filter((d) => d.date === date);
      const native =
        !c.campaign.daily || lagging
          ? null
          : (rows ?? []).reduce((n, d) => n + d.spend, 0);
      return {
        platform: c.platform,
        accountId: c.account.accountId,
        campaignId: c.campaign.id,
        date,
        spendUsd: native == null ? null : asUsd(native, c.account.currency, fx),
      };
    }),
  );
}

/** One call for the UI: assignments + spend rows + per-campaign estimates for the control's days. */
export function buildRealEstimate(input: {
  summary: Pick<MarketingSummary, "productFamilies" | "familyDataError">;
  sources: MarketingSources | null;
  settings: MarketingSettings | null;
  control: MarketingControl | null;
  fx: UsdRate | null;
}) {
  const campaigns = assignedCampaigns(
    input.summary,
    input.sources,
    input.settings,
  );
  const days = input.control?.days ?? [];
  const spend = campaignSpendRows(
    campaigns,
    days.map((d) => d.date),
    input.fx,
  );
  const estimates = estimateCampaignRealOrders({
    days,
    spend,
    members: new Map(campaigns.map((c) => [c.key, c.members])),
  });
  return { campaigns, spend, estimates };
}

/**
 * Real orders by channel for [from, to] (A6 cards): UTM orders of each
 * platform plus the assigned share of its campaigns. "Otros" = real − Meta −
 * TikTok (products without a spending campaign, or organic).
 */
export function channelOrders(
  days: RealOrderDay[],
  estimates: CampaignEstimates,
  from: string,
  to: string,
) {
  const window = days.filter((d) => d.date >= from && d.date <= to);
  const real = window.reduce((n, d) => n + d.real, 0);
  const withCampaign = window.reduce((n, d) => n + d.withCampaign, 0);
  const channel = (platform: AdPlatform) => {
    const utm = window.reduce(
      (n, d) =>
        n +
        Object.entries(d.byCampaign)
          .filter(([key]) => key.startsWith(`${platform}:`))
          .reduce((s, [, v]) => s + v, 0),
      0,
    );
    let assigned = 0;
    const missing = new Set<string>();
    for (const [key, byDate] of Array.from(estimates)) {
      if (!key.startsWith(`${platform}:`)) continue;
      for (const day of window) {
        const estimate = byDate.get(day.date);
        if (!estimate) continue;
        if (estimate.total == null) missing.add(day.date);
        else assigned += estimate.assigned;
      }
    }
    return {
      total: round4(utm + assigned),
      utm,
      assigned: round4(assigned),
      missingDates: Array.from(missing).sort(),
    };
  };
  const meta = channel("meta"),
    tiktok = channel("tiktok");
  return {
    real,
    withCampaign,
    utmShare: real > 0 ? withCampaign / real : null,
    meta,
    tiktok,
    other: round4(Math.max(0, real - meta.total - tiktok.total)),
  };
}
