import type { AttributionGroup } from "./marketing-attribution";
import type { MarketingIntelligence } from "./marketing-intelligence";
import type { CharlieReport } from "./marketing-charlie-types";
import type { MarketingPeriod } from "./marketing-dates";

export type AttributionLevel = "campaign" | "adset" | "ad";
type Campaign = Pick<
  MarketingIntelligence["campaigns"][number],
  | "id"
  | "name"
  | "platform"
  | "accountId"
  | "accountName"
  | "currency"
  | "timezone"
  | "spend"
>;
export function buildAttributionCostRows(
  groups: AttributionGroup[],
  level: AttributionLevel,
  campaigns: Campaign[],
  report: CharlieReport | null,
  period: MarketingPeriod,
) {
  const grouped = new Map<string, AttributionGroup>();
  const conflicts = new Set<string>();
  const keyOf = (g: AttributionGroup) =>
    JSON.stringify([
      g.platform,
      g.campaignId,
      level === "adset" || (level === "ad" && !g.adId) ? g.adsetId : null,
      level === "ad" ? g.adId : null,
    ]);
  for (const g of groups) {
    const key = keyOf(g);
    const prev = grouped.get(key);
    if (!prev)
      grouped.set(key, {
        ...g,
        adsetId: level !== "campaign" ? g.adsetId : null,
        adId: level === "ad" ? g.adId : null,
      });
    else {
      if (
        level === "ad" &&
        prev.adsetId &&
        g.adsetId &&
        prev.adsetId !== g.adsetId
      )
        conflicts.add(key);
      if (level === "ad" && !prev.adsetId) prev.adsetId = g.adsetId;
      for (const field of [
        "orders",
        "delivered",
        "failed",
        "open",
        "annulled",
      ] as const)
        prev[field] += g[field];
    }
  }
  const addEmpty = (g: AttributionGroup) => {
    if (!grouped.has(keyOf(g))) grouped.set(keyOf(g), g);
  };
  const empty = {
    orders: 0,
    delivered: 0,
    failed: 0,
    open: 0,
    annulled: 0,
    deliveryRate: null,
  };
  // Keep spend without a linked purchase visible: it is not evidence of zero acquisition cost.
  if (level === "campaign")
    for (const c of campaigns) {
      if (c.spend > 0)
        addEmpty({
          ...empty,
          platform: c.platform,
          campaignId: c.id,
          adsetId: null,
          adId: null,
          campaignName: c.name,
          adsetName: "",
          adName: "",
        });
    }
  else if (
    report?.status === "ready" &&
    report.data?.from === period.from &&
    report.data.to === period.to
  ) {
    for (const a of report.data.accounts)
      for (const ad of a.ads) {
        if (
          a.platform &&
          ad.daily.some(
            (d) => d.date >= period.from && d.date <= period.to && d.spend > 0,
          )
        )
          addEmpty({
            ...empty,
            platform: a.platform,
            campaignId: ad.campaignId,
            adsetId: ad.adsetId,
            adId: level === "ad" ? ad.id : null,
            campaignName: ad.campaignName || "",
            adsetName: ad.adsetName || "",
            adName: ad.name,
          });
      }
  }
  return Array.from(grouped.values()).map((g) => {
    const matches = campaigns.filter(
      (c) => c.platform === g.platform && c.id === g.campaignId,
    );
    const campaign = matches.length === 1 ? matches[0] : null;
    let currency = campaign?.currency ?? null,
      timezone = campaign?.timezone ?? "",
      spend: number | null = null;
    let spendMessage =
      matches.length > 1 ? "Cruce ambiguo" : "Sin gasto disponible";
    let accountName = campaign?.accountName ?? "";
    if (conflicts.has(keyOf(g)))
      spendMessage = "Conjunto contradictorio en los UTM";
    else if (level === "campaign") {
      if (campaign && Number.isFinite(campaign.spend) && campaign.spend >= 0)
        spend = campaign.spend;
    } else if (
      report?.status === "ready" &&
      report.data?.from === period.from &&
      report.data.to === period.to
    ) {
      // IDs never cross platforms or accounts. Verify the parent IDs as well.
      const accounts = report.data.accounts.filter(
        (a) =>
          a.platform === g.platform &&
          (!campaign || a.id === campaign.accountId),
      );
      const found = accounts.flatMap((a) => {
        const ads = a.ads.filter(
          (ad) =>
            ad.campaignId === g.campaignId &&
            (level === "ad"
              ? Boolean(g.adId) &&
                ad.id === g.adId &&
                (!g.adsetId || ad.adsetId === g.adsetId)
              : Boolean(g.adsetId) && ad.adsetId === g.adsetId),
        );
        return ads.length ? [{ account: a, ads }] : [];
      });
      if (matches.length <= 1 && found.length === 1) {
        const { account, ads } = found[0];
        const days = ads.flatMap((ad) =>
          ad.daily.filter((d) => d.date >= period.from && d.date <= period.to),
        );
        const unique = new Set(
          ads.flatMap((ad) =>
            ad.daily
              .filter((d) => d.date >= period.from && d.date <= period.to)
              .map((d) => `${ad.id}:${d.date}`),
          ),
        );
        if (
          days.length &&
          unique.size === days.length &&
          days.every((d) => Number.isFinite(d.spend) && d.spend >= 0)
        ) {
          spend = days.reduce((sum, d) => sum + d.spend, 0);
          currency = account.currency;
          timezone = account.timezone;
          accountName = account.name;
        }
      } else if (found.length > 1 || matches.length > 1)
        spendMessage = "Cruce ambiguo";
    }
    const aligned = timezone === "America/Costa_Rica";
    if (spend != null)
      spendMessage = !aligned
        ? "Calendario distinto al de Costa Rica"
        : !g.delivered
          ? "Sin entregados todavía"
          : "Gasto registrado / entregados con UTM";
    return {
      ...g,
      closed: g.delivered + g.failed,
      deliveryRate:
        g.delivered + g.failed ? g.delivered / (g.delivered + g.failed) : null,
      spend,
      currency,
      costPerDelivered:
        spend != null && aligned && g.delivered > 0
          ? spend / g.delivered
          : null,
      spendMessage,
      accountName,
      matchedCampaignName: campaign?.name ?? "",
    };
  });
}
