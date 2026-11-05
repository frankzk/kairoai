// Listas del "Reporte del equipo" (documento de mejoras, A2 y A4): stock en
// días de cobertura y "CPA por encima del objetivo" con pedidos reales. El
// CPA del píxel queda solo como referencia. Puro.
import { effectiveRealCpa, type CampaignActionRow } from "./marketing-actions";
import type { Coverage, CoverageTone } from "./marketing-coverage";
import type { productComparison } from "./marketing-team-report";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { countText, moneyText } from "./marketing-copy";

type Comparison = ReturnType<typeof productComparison>[number];

export interface CpaAlert {
  key: string;
  title: string;
  detail: string;
  /** Pixel CPA, as secondary text ("píxel USD 6,10"). */
  pixel: string | null;
}

const TONE_ORDER: Record<CoverageTone, number> = {
  red: 0,
  yellow: 1,
  ok: 2,
  no_demand: 3,
  unknown: 4,
};

/**
 * Stock table rows: only red and yellow by default, sorted by days
 * ascending; with `all`, every product with known stock, red first.
 */
export function stockDaysRows<T extends { name: string; coverage: Coverage }>(
  products: T[],
  all = false,
): T[] {
  return products
    .filter((p) =>
      all
        ? p.coverage.available != null
        : p.coverage.available != null &&
          (p.coverage.tone === "red" || p.coverage.tone === "yellow"),
    )
    .sort(
      (a, b) =>
        TONE_ORDER[a.coverage.tone] - TONE_ORDER[b.coverage.tone] ||
        (a.coverage.days ?? Infinity) - (b.coverage.days ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
}

const pixelText = (spend: number, pixel: number) =>
  pixel > 0 ? `píxel ${moneyText(spend / pixel)}` : "píxel sin compras";

/**
 * "CPA por encima del objetivo": products whose 7-day real CPA is above the
 * target (complete data, at least the test kill spend), then campaigns whose
 * 3-day real CPA is above the target. Spend without real orders counts as
 * above the target and goes first. Pixel CPA only as secondary text.
 */
export function highCpaAlerts(
  comparisons: Comparison[],
  rows: CampaignActionRow[],
  t: MarketingTargets = MARKETING_TARGETS,
): { products: CpaAlert[]; campaigns: CpaAlert[] } {
  const products = comparisons
    .map((p) => {
      const week = p.costs[2];
      const cpa =
        !week || week.partial
          ? null
          : week.value != null
            ? week.value
            : p.sevenDayReal === 0 && week.spend != null && week.spend > 0
              ? Infinity
              : null;
      return { p, week, cpa };
    })
    .filter(({ cpa }) => cpa != null && cpa > t.cpaUsd)
    .sort(
      (a, b) => b.cpa! - a.cpa! || (b.week.spend ?? 0) - (a.week.spend ?? 0),
    )
    .flatMap(({ p, week, cpa }): CpaAlert[] => {
      const spend = week.spend ?? 0;
      if (spend < t.metaTestKillUsd) return [];
      const related = rows.filter((r) => r.product?.key === p.key);
      const pixelSpend = related.reduce(
        (n, r) => n + (r.days7.spendUsd ?? 0),
        0,
      );
      const pixel = related.every((r) => r.days7.pixel != null)
        ? related.reduce((n, r) => n + r.days7.pixel!, 0)
        : null;
      return [
        {
          key: `product:${p.key}`,
          title: p.name,
          detail: Number.isFinite(cpa!)
            ? `CPA real 7 días ${moneyText(cpa)} (${countText(p.sevenDayReal)} pedidos reales)`
            : `Sin pedidos reales en 7 días con ${moneyText(spend)} de gasto`,
          pixel:
            related.length && pixel != null && pixelSpend > 0
              ? pixelText(pixelSpend, pixel)
              : null,
        },
      ];
    });
  const campaigns = rows
    .map((r) => ({ r, cpa: effectiveRealCpa(r.days3, t) }))
    .filter(({ cpa }) => cpa != null && cpa > t.cpaUsd)
    .sort(
      (a, b) =>
        b.cpa! - a.cpa! ||
        (b.r.days3.spendUsd ?? 0) - (a.r.days3.spendUsd ?? 0),
    )
    .map(({ r, cpa }) => {
      const estimated = r.days3.real !== r.days3.utm;
      return {
        key: `campaign:${r.key}`,
        title: `${r.name} · ${r.accountLabel}`,
        detail: Number.isFinite(cpa!)
          ? `CPA real 3 días ${moneyText(cpa)}${estimated ? " (estimado)" : " (UTM)"}`
          : `Sin pedidos reales en 3 días con ${moneyText(r.days3.spendUsd)} de gasto`,
        pixel:
          r.days3.spendUsd != null && r.days3.pixel != null
            ? pixelText(r.days3.spendUsd, r.days3.pixel)
            : null,
      };
    });
  return { products, campaigns };
}
