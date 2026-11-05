// "Control de las COST CAP" (documento de mejoras, módulo 3): gasto diario
// contra la puja, alerta roja con más de US$100 en un día o CPA del píxel
// mayor al doble de la puja (Gomitas CR4 gastó US$1.166 el 27 oct), marca de
// "no entrega" y candidatos para una COST CAP nueva. Usa el píxel a propósito
// (el factor píxel/reales es el módulo 4). Puro.
import type { CampaignActionRow } from "./marketing-actions";
import type { UsdRate } from "./marketing-charlie-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { marketingDate, shiftDate } from "./marketing-dates";
import { asUsd } from "./marketing-usd-rate";
import { countText, moneyText } from "./marketing-copy";

export interface CostCapAlert {
  code: "gasto_alto" | "cpa_doble" | "no_entrega";
  label: string;
  tone: "risk" | "wait";
  day: "hoy" | "ayer";
}
export interface CostCapDay {
  spendUsd: number | null;
  pixel: number | null;
  cpaPixel: number | null;
  real: number | null;
}
export interface CostCapRow {
  key: string;
  platform: "meta" | "tiktok";
  accountLabel: string;
  name: string;
  product: string | null;
  status: CampaignActionRow["status"];
  /** USD bid used for the comparison (the target CPA when the bid is unknown). */
  bid: number;
  bidAssumed: boolean;
  bidNote: string | null;
  today: CostCapDay;
  yesterday: CostCapDay;
  alerts: CostCapAlert[];
  risk: boolean;
}
export interface CostCapCandidate {
  productKey: string;
  name: string;
  cboSpend7d: number;
  cboPixel7d: number;
  cboPixelCpa7d: number;
  campaigns: number;
  detail: string;
}

const day = (w: CampaignActionRow["today"]): CostCapDay => ({
  spendUsd: w.spendUsd,
  pixel: w.pixel,
  cpaPixel: w.cpaPixel,
  real: w.real,
});

export function buildCostCapControl(
  rows: CampaignActionRow[],
  t: MarketingTargets = MARKETING_TARGETS,
  options: { fx?: UsdRate | null; now?: Date } = {},
): { rows: CostCapRow[]; candidates: CostCapCandidate[] } {
  const usd = (v: number | null) => moneyText(v, "USD");
  const yesterday = shiftDate(marketingDate(options.now ?? new Date()), -1);
  const costCaps = rows.filter((r) => r.type === "COST CAP");
  const out = costCaps.map((row): CostCapRow => {
    const known =
      row.bid != null && row.bid > 0
        ? asUsd(row.bid, row.currency, options.fx ?? null)
        : null;
    const bid = known ?? t.cpaUsd;
    const bidAssumed = known == null;
    const alerts: CostCapAlert[] = [];
    const check = (w: CostCapDay, label: "hoy" | "ayer") => {
      if (w.spendUsd == null) return;
      if (w.spendUsd > t.costCapDailyAlertUsd)
        alerts.push({
          code: "gasto_alto",
          tone: "risk",
          day: label,
          label: `Gastó ${usd(w.spendUsd)} en un día (límite de control ${usd(t.costCapDailyAlertUsd)})`,
        });
      const limit = bid * t.costCapCpaMultiple;
      if (
        w.pixel != null &&
        w.pixel > 0 &&
        w.cpaPixel != null &&
        w.cpaPixel > limit
      )
        alerts.push({
          code: "cpa_doble",
          tone: "risk",
          day: label,
          label: `CPA píxel ${usd(w.cpaPixel)}: más del doble de la puja`,
        });
      else if (w.pixel === 0 && w.spendUsd > limit)
        alerts.push({
          code: "cpa_doble",
          tone: "risk",
          day: label,
          label: `${usd(w.spendUsd)} sin compras en el píxel (más del doble de la puja)`,
        });
    };
    const today = day(row.today),
      before = day(row.yesterday);
    check(today, "hoy");
    check(before, "ayer");
    const reported =
      row.platform === "meta" ||
      (row.dataThrough != null && row.dataThrough >= yesterday);
    const active =
      row.status === "activa" ||
      (row.status === null && (row.days3.spendNative ?? 0) > 0);
    // Yesterday only says something about delivery when the campaign ran all
    // of it: launched before yesterday and not paused or activated since.
    const changedSince = (at: string | undefined) =>
      at != null &&
      Number.isFinite(Date.parse(at)) &&
      marketingDate(new Date(at)) >= yesterday;
    const ranYesterday =
      (row.launch.date == null || row.launch.date < yesterday) &&
      !changedSince(row.lastStatusChange?.at) &&
      !(
        row.lastChange?.kind === "lanzamiento" &&
        changedSince(row.lastChange.at)
      );
    if (
      active &&
      reported &&
      ranYesterday &&
      before.spendUsd != null &&
      before.spendUsd < t.costCapNoDeliveryUsd
    )
      alerts.push({
        code: "no_entrega",
        tone: "wait",
        day: "ayer",
        label: `No entrega: ${usd(before.spendUsd)} ayer`,
      });
    return {
      key: row.key,
      platform: row.platform,
      accountLabel: row.accountLabel,
      name: row.name,
      product: row.product?.name ?? null,
      status: row.status,
      bid,
      bidAssumed,
      bidNote: bidAssumed
        ? `Puja no disponible; se compara con ${usd(t.cpaUsd)}`
        : null,
      today,
      yesterday: before,
      alerts,
      risk: alerts.some((a) => a.tone === "risk"),
    };
  });

  out.sort(
    (a, b) =>
      Number(b.risk) - Number(a.risk) ||
      b.alerts.length - a.alerts.length ||
      (b.yesterday.spendUsd ?? -1) - (a.yesterday.spendUsd ?? -1),
  );
  const covered = new Set(
    costCaps
      .filter((r) => r.product && r.status !== "pausada")
      .map((r) => r.product!.key),
  );
  const groups = new Map<
    string,
    { name: string; spend: number; pixel: number; campaigns: number }
  >();
  for (const row of rows) {
    if (
      row.platform !== "meta" ||
      // Only known CBO/ABO: without the catalog a COST CAP may read "Sin dato".
      (row.type !== "CBO" && row.type !== "ABO") ||
      row.status !== "activa" ||
      !row.product ||
      row.days7.spendUsd == null ||
      row.days7.pixel == null
    )
      continue;
    const group = groups.get(row.product.key) ?? {
      name: row.product.name,
      spend: 0,
      pixel: 0,
      campaigns: 0,
    };
    group.spend += row.days7.spendUsd;
    group.pixel += row.days7.pixel;
    group.campaigns++;
    groups.set(row.product.key, group);
  }
  const candidates = Array.from(groups)
    .filter(
      ([key, g]) =>
        !covered.has(key) &&
        g.pixel >= t.costCapCandidateMinPurchases &&
        g.spend / g.pixel < t.cpaUsd,
    )
    .map(([productKey, g]) => {
      const cpa = g.spend / g.pixel;
      return {
        productKey,
        name: g.name,
        cboSpend7d: g.spend,
        cboPixel7d: g.pixel,
        cboPixelCpa7d: cpa,
        campaigns: g.campaigns,
        detail: `CPA del píxel en CBO ${usd(cpa)} con ${countText(g.pixel)} compras en 7 días. Candidato a COST CAP.`,
      };
    })
    .sort((a, b) => a.cboPixelCpa7d - b.cboPixelCpa7d);
  return { rows: out, candidates };
}
