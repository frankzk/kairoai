import type { MarketingSummary } from "./marketing";
import type { MarketingSources } from "./marketing-source-types";
import type { MarketingSettings } from "./marketing-settings-types";
import type { UsdRate } from "./marketing-charlie-types";
import {
  effectiveAssignment,
  reportProductMetrics,
} from "./marketing-product-families";
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
      m,
    ]) ?? [],
  );
  const ready = Boolean(
    settings &&
    sources?.meta.status === "ready" &&
    sources.tiktok.status === "ready",
  );
  const campaigns = (["meta", "tiktok"] as const).flatMap(
    (platform) =>
      (sources?.[platform].status === "ready"
        ? sources[platform].data?.accounts
        : []
      )?.flatMap((a) =>
        a.campaigns.map((c) => ({
          ...c,
          platform,
          observedThrough:
            a.campaigns
              .flatMap((c) => c.daily?.map((d) => d.date) ?? [])
              .sort()
              .at(-1) ?? "",
          currency: a.currency,
          timezone: a.timezone,
          mapping: effectiveAssignment(
            mappings.get(campaignKey(platform, a.accountId, c.id)),
            summary.productFamilies ?? [],
            platform,
            a.accountId,
            c.id,
            c.name,
            Boolean(settings) && !summary.familyDataError,
          ),
        })),
      ) ?? [],
  );
  const unmapped = campaigns.filter((c) => c.spend > 0 && !c.mapping).length;
  const partial = !ready || unmapped > 0;
  return reportProductMetrics(
    summary,
    campaigns.flatMap((c) => (c.mapping ? [c.mapping] : [])),
  ).map((p) => {
    const related = campaigns.filter(
      (c) =>
        c.mapping?.product_key === p.key ||
        ("scope" in p &&
          p.scope === "all" &&
          (c.mapping?.family_key === p.familyKey ||
            (c.mapping && p.memberKeys?.includes(c.mapping.product_key)))),
    );
    function observation(start: string, end: string, orders: number) {
      const late = related.some(
        (c) => c.platform === "tiktok" && c.observedThrough < end,
      );
      const base = {
        partial: partial || late,
        approximate: related.some((c) => c.timezone !== summary.timezone),
        campaignCount: related.length,
        unmapped,
      };
      if (!settings)
        return { ...base, value: null, reason: "Asignaciones no disponibles" };
      if (!related.length)
        return { ...base, value: null, reason: "Asigna sus campañas" };
      if (!orders)
        return { ...base, value: null, reason: "Sin pedidos creados" };
      if (related.some((c) => !c.daily))
        return { ...base, value: null, reason: "Detalle diario pendiente" };
      const values = related.map((c) =>
        asUsd(
          c
            .daily!.filter((d) => d.date >= start && d.date <= end)
            .reduce((n, d) => n + d.spend, 0),
          c.currency,
          fx,
        ),
      );
      if (values.some((v) => v == null))
        return { ...base, value: null, reason: "Conversión pendiente" };
      const spend = values.reduce<number>((n, v) => n + v!, 0);
      if (base.partial && spend === 0)
        return {
          ...base,
          value: null,
          reason: "Sin pauta asignada en estas fechas",
        };
      return {
        ...base,
        value: spend / orders,
        reason: late
          ? "TikTok no reporta todo el rango"
          : partial
            ? "Solo pauta asignada, cobertura parcial"
            : base.approximate
              ? "Calendarios distintos"
              : "Pauta asignada / pedidos",
      };
    }
    const costs = [
      observation(today, today, p.todayOrders),
      observation(yesterday, yesterday, p.yesterdayOrders),
      observation(from, yesterday, p.sevenDayOrders),
    ];
    return {
      ...p,
      costs,
      cpas: costs.map((c) => c.value),
    };
  });
}
