import type { MarketingSummary } from "./marketing";
import type { MarketingSources } from "./marketing-source-types";
import type { MarketingSettings } from "./marketing-settings-types";
import type { UsdRate } from "./marketing-charlie-types";
import {
  effectiveAssignment,
  reportProductMetrics,
} from "./marketing-product-families";
import { campaignKey } from "./marketing-settings-types";
import { buildKeywordIndex } from "./marketing-campaign-keywords";
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
  const keywords = buildKeywordIndex(
    summary.productFamilies ?? [],
    settings?.keywords ?? [],
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
            settings?.mappings ?? [],
            keywords,
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
    /** CPA real = spend / real orders; `createdValue` = spend / created orders (reference). */
    function observation(
      start: string,
      end: string,
      orders: number,
      created: number,
    ) {
      const late = related.some(
        (c) => c.platform === "tiktok" && c.observedThrough < end,
      );
      const base = {
        partial: partial || late,
        approximate: related.some((c) => c.timezone !== summary.timezone),
        campaignCount: related.length,
        unmapped,
      };
      const none = (reason: string, spend: number | null = null) => ({
        ...base,
        value: null,
        createdValue: null,
        reason,
        /** USD spend of the related campaigns in the range, when known. */
        spend,
      });
      /** USD spend of the related campaigns; "daily" / "fx" when unknown. */
      const spendIn = (): number | "daily" | "fx" => {
        if (related.some((c) => !c.daily)) return "daily";
        const values = related.map((c) =>
          asUsd(
            c
              .daily!.filter((d) => d.date >= start && d.date <= end)
              .reduce((n, d) => n + d.spend, 0),
            c.currency,
            fx,
          ),
        );
        if (values.some((v) => v == null)) return "fx";
        return values.reduce<number>((n, v) => n + v!, 0);
      };
      if (!settings) return none("Asignaciones no disponibles");
      if (!related.length) return none("Asigna sus campañas");
      if (!created) {
        const spend = spendIn();
        return none(
          "Sin pedidos creados",
          typeof spend === "number" ? spend : null,
        );
      }
      const spend = spendIn();
      if (spend === "daily") return none("Detalle diario pendiente");
      if (spend === "fx") return none("Conversión pendiente");
      if (base.partial && spend === 0)
        return none("Sin pauta asignada en estas fechas", 0);
      if (!orders)
        return {
          ...none("Sin pedidos reales", spend),
          createdValue: spend / created,
        };
      return {
        ...base,
        spend,
        value: spend / orders,
        createdValue: spend / created,
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
      observation(today, today, p.todayReal, p.todayOrders),
      observation(yesterday, yesterday, p.yesterdayReal, p.yesterdayOrders),
      observation(from, yesterday, p.sevenDayReal, p.sevenDayOrders),
    ];
    return {
      ...p,
      costs,
      cpas: costs.map((c) => c.value),
    };
  });
}
