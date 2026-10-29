import type { MarketingSummary } from "./marketing";
import type { MarketingSources } from "./marketing-source-types";
import { buildMarketingAdsSummary } from "./marketing-ads-summary";
import { asUsd } from "./marketing-usd-rate";
import type {
  CharlieReport,
  CharlieSettings,
  CharlieDay,
} from "./marketing-charlie-types";
import type { CharlieRevenue } from "./marketing-charlie-revenue";
import { marketingDate, shiftDate } from "./marketing-dates";
export const CHARLIE_CPA_CEILING = 8.5;
export function detectAdsetRole(name: string): "control" | "testing" | "other" {
  const value = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /(^|[\s|_/-])(control|all[ -]?stars?|proven[ _-]?winners?)(?=$|[\s|_/-])/.test(
      value,
    )
  )
    return "control";
  if (
    /(^|[\s|_/-])(test(?:ing)?|prueba|experimento|flex|dynamic)(?=$|[\s|_/-])/.test(
      value,
    )
  )
    return "testing";
  return "other";
}
export const funnelHint = (frequency: number | null) =>
  frequency == null
    ? "Sin frecuencia"
    : frequency <= 1.2
      ? "Prospecting orientativo"
      : frequency < 1.25
        ? "Intermedio"
        : frequency > 1.95
          ? "Retargeting / alta exposición"
          : "Retargeting orientativo";
const sum = (
  rows: CharlieDay[],
  field: "spend" | "impressions" | "clicks" | "purchases" | "interactions",
) => rows.reduce((total, row) => total + row[field], 0);
function value(rows: CharlieDay[]) {
  return rows.some((row) => row.purchases > 0 && row.purchaseValue == null)
    ? null
    : rows.reduce((sum, row) => sum + (row.purchaseValue ?? 0), 0);
}
export function buildCharlieModel(
  summary: {
    period: MarketingSummary["period"];
    totals: Pick<MarketingSummary["totals"], "generated" | "delivered">;
  },
  business: CharlieRevenue | null,
  sources: MarketingSources | null,
  report: CharlieReport | null,
  settings: CharlieSettings | null,
  frequencyDay?: string,
  now = new Date(),
) {
  const end = summary.period.to,
    start = summary.period.from,
    today = marketingDate(now);
  const day =
    frequencyDay && frequencyDay >= start && frequencyDay <= end
      ? frequencyDay
      : end === today && start < today
        ? shiftDate(today, -1)
        : end;
  const fx = settings?.fx ?? null;
  const coverage = buildMarketingAdsSummary(
    sources,
    summary.period,
    business?.totalOrders ?? summary.totals.generated,
    summary.totals.delivered,
  );
  const spends = coverage.breakdown.map((group) =>
    asUsd(group.spend, group.currency, fx),
  );
  const spendUsd =
    spends.length && spends.every((value) => value != null)
      ? spends.reduce<number>((sum, value) => sum + value!, 0)
      : null;
  const count = business?.totalOrders ?? null;
  const revenueUsd = asUsd(business?.revenueCrc, "CRC", fx);
  const cpa =
    coverage.aligned && spendUsd != null && count != null && count > 0
      ? spendUsd / count
      : null;
  const aov =
    revenueUsd != null && count != null && count > 0
      ? revenueUsd / count
      : null;
  const profitVolume =
    revenueUsd != null && spendUsd != null ? revenueUsd - spendUsd : null;
  const gpt = aov != null && cpa != null ? aov - cpa : null;
  const headroom = cpa == null ? null : CHARLIE_CPA_CEILING - cpa;
  const decision =
    (count === 0 && (spendUsd ?? 0) > 0) ||
    (headroom != null && headroom < 0) ||
    (profitVolume != null && profitVolume <= 0)
      ? "blocked"
      : coverage.partial ||
          !coverage.aligned ||
          cpa == null ||
          gpt == null ||
          count == null ||
          count < 20 ||
          (spendUsd ?? 0) <= 0
        ? "incomplete"
        : "review";
  const roleMap = new Map(
    settings?.roles.map((role) => [
      `${role.account_id}:${role.adset_id}`,
      role.role,
    ]) ?? [],
  );
  const accounts =
    report?.status === "ready" ? (report.data?.accounts ?? []) : [];
  const campaigns = new Map(
    sources?.meta.data?.accounts.flatMap((account) =>
      account.campaigns.map(
        (campaign) =>
          [`${account.accountId}:${campaign.id}`, campaign] as const,
      ),
    ) ?? [],
  );
  const ads = accounts
    .flatMap((account) => {
      const todayRows = account.ads.flatMap((ad) =>
        ad.daily.filter((row) => row.date === day),
      );
      const totalDaySpend = sum(todayRows, "spend"),
        totalDayPurchases = sum(todayRows, "purchases"),
        totalDayValue = value(todayRows);
      const averageGpt =
        totalDayPurchases > 0 && totalDayValue != null
          ? asUsd(
              (totalDayValue - totalDaySpend) / totalDayPurchases,
              account.currency,
              fx,
            )
          : null;
      return account.ads.map((ad) => {
        const rows = ad.daily.filter(
            (row) => row.date >= start && row.date <= end,
          ),
          selected = ad.daily.find((row) => row.date === day) ?? null;
        const spend = asUsd(sum(rows, "spend"), account.currency, fx),
          purchases = sum(rows, "purchases"),
          reportedValue = asUsd(value(rows), account.currency, fx),
          impressions = sum(rows, "impressions");
        const platformCpa =
          purchases > 0 && spend != null ? spend / purchases : null;
        const platformGpt =
          purchases > 0 && reportedValue != null && platformCpa != null
            ? reportedValue / purchases - platformCpa
            : null;
        const daySpend = selected
          ? asUsd(selected.spend, account.currency, fx)
          : 0;
        const dayCpa =
          selected && selected.purchases > 0 && daySpend != null
            ? daySpend / selected.purchases
            : null;
        const dayValue = selected
          ? asUsd(selected.purchaseValue, account.currency, fx)
          : null;
        const dayGpt =
          selected &&
          selected.purchases > 0 &&
          dayValue != null &&
          dayCpa != null
            ? dayValue / selected.purchases - dayCpa
            : null;
        const share =
          selected && totalDaySpend > 0 ? selected.spend / totalDaySpend : 0;
        const reasons: string[] = [];
        if (dayCpa != null && dayCpa > CHARLIE_CPA_CEILING)
          reasons.push("CPA diario sobre el techo");
        if (dayGpt != null && averageGpt != null && dayGpt < averageGpt)
          reasons.push("GPT diario bajo el promedio ponderado de la cuenta");
        if (selected?.purchases === 0 && (daySpend ?? 0) >= CHARLIE_CPA_CEILING)
          reasons.push("Gasto diario sin compras reportadas");
        const adset = account.adsets.find((set) => set.id === ad.adsetId),
          detectedRole = detectAdsetRole(adset?.name || "");
        const role = roleMap.get(`${account.id}:${ad.adsetId}`) ?? detectedRole;
        return {
          ...ad,
          key: `${account.id}:${ad.id}`,
          accountId: account.id,
          accountName: account.name,
          nativeCurrency: account.currency,
          accountTimezone: account.timezone,
          adsetName: adset?.name || ad.adsetId,
          campaignName:
            campaigns.get(`${account.id}:${ad.campaignId}`)?.name ||
            ad.campaignId,
          spendUsd: spend,
          purchases,
          valueUsd: reportedValue,
          cpa: platformCpa,
          gpt: platformGpt,
          cpm:
            spend != null && impressions > 0
              ? (spend / impressions) * 1000
              : null,
          clicks: sum(rows, "clicks"),
          interactions: sum(rows, "interactions"),
          frequency: selected?.frequency ?? null,
          funnel: funnelHint(selected?.frequency ?? null),
          daySpendUsd: daySpend,
          dayCpa,
          dayGpt,
          accountAverageGpt: averageGpt,
          spendShare: share,
          passive: share >= 0.1 && share <= 0.4 && reasons.length > 0,
          reasons,
          role,
          detectedRole,
        };
      });
    })
    .sort((a, b) => (b.spendUsd ?? -1) - (a.spendUsd ?? -1));
  const structure = accounts.flatMap((account) =>
    account.adsets.map((set) => {
      const related = ads.filter(
        (ad) => ad.accountId === account.id && ad.adsetId === set.id,
      );
      const active = related.filter((ad) => ad.effectiveStatus === "ACTIVE");
      const posts = Array.from(
        new Set(
          active
            .map((ad) => ad.postId)
            .filter((post): post is string => Boolean(post)),
        ),
      );
      const campaign = campaigns.get(`${account.id}:${set.campaignId}`);
      const detectedRole = detectAdsetRole(set.name),
        manualRole = roleMap.get(`${account.id}:${set.id}`);
      const spendValues = related.map((ad) => ad.spendUsd);
      return {
        ...set,
        key: `${account.id}:${set.id}`,
        accountId: account.id,
        accountName: account.name,
        campaignName: campaign?.name || set.campaignId,
        cbo: campaign
          ? ["campaign", "lifetime"].includes(campaign.budgetKind || "")
          : null,
        detectedRole,
        manualRole: manualRole ?? null,
        role: manualRole ?? detectedRole,
        activeAds: account.metadataMessage ? null : active.length,
        posts,
        metadataComplete: !account.metadataMessage,
        spendUsd: spendValues.every((value) => value != null)
          ? spendValues.reduce<number>((sum, value) => sum + value!, 0)
          : null,
        flexAds: related.filter((ad) => ad.assets != null),
        pattern322: related.filter(
          (ad) =>
            ad.assets?.creatives === 3 &&
            ad.assets.bodies === 2 &&
            ad.assets.titles === 2,
        ).length,
        harvestVerified: false as const,
      };
    }),
  );
  const trailing =
    business?.days.map((date) => {
      const rows = accounts.flatMap((account) =>
        account.ads
          .map((ad) => ({
            currency: account.currency,
            row: ad.daily.find((row) => row.date === date.date),
          }))
          .filter((item) => item.row),
      );
      const values = rows.map((item) =>
        asUsd(item.row!.spend, item.currency, fx),
      );
      return {
        date: date.date,
        revenueUsd: asUsd(date.revenueCrc, "CRC", fx),
        metaSpendUsd:
          report?.status === "ready" && values.every((value) => value != null)
            ? values.reduce<number>((sum, value) => sum + value!, 0)
            : null,
      };
    }) ?? [];
  return {
    day,
    coverage,
    spendUsd,
    revenueUsd,
    cpa,
    aov,
    gpt,
    profitVolume,
    headroom,
    decision,
    totalOrders: count,
    recurringUsd: asUsd(business?.recurringRevenueCrc, "CRC", fx),
    heroUsd: asUsd(business?.heroRevenueCrc, "CRC", fx),
    floorUsd: asUsd(business?.floorRevenueCrc, "CRC", fx),
    floorShare:
      business?.floorRevenueCrc != null &&
      business.revenueCrc != null &&
      business.revenueCrc > 0
        ? business.floorRevenueCrc / business.revenueCrc
        : null,
    ads,
    structure,
    trailing,
    passives: ads.filter((ad) => ad.passive),
    settings,
    business,
  };
}
export type CharlieModel = ReturnType<typeof buildCharlieModel>;
