// Píxel contra pedidos reales (documento de mejoras, módulo 4). Factor =
// compras del píxel (Meta) o conversiones (TikTok, por Make) ÷ pedidos reales
// de iComfly estimados por campaña (UTM + reparto por producto, sin anulados),
// por plataforma, cuenta, producto y cuenta × producto. Y la salud del
// píxel: un día con pedidos reales y 0 compras, o un día muy por debajo de su
// factor habitual (TikTok el 26 y 27 oct registró 3 y 9 con ≈ 25 pedidos).
// Puro: se prueba en tests/marketing-pixel.test.ts.
import type { RealOrderDay } from "./marketing-real-orders";
import type { AssignedCampaign, CampaignEstimates } from "./marketing-real-cpa";
import type { AccountLabel } from "./marketing-settings-types";
import type { UsdRate } from "./marketing-charlie-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { shiftDate } from "./marketing-dates";
import { asUsd } from "./marketing-usd-rate";
import { accountLabel } from "./marketing-actions";
import {
  countText,
  decimalText,
  moneyText,
  shortDateText,
} from "./marketing-copy";

export type PixelPlatform = "meta" | "tiktok";
export type PixelTone =
  | "de_mas"
  | "de_menos"
  | "alineado"
  | "poco_dato"
  | "sin_reales";

export const PIXEL_TONE_LABEL: Record<PixelTone, string> = {
  de_mas: "Cuenta de más",
  de_menos: "Cuenta de menos",
  alineado: "Alineado",
  poco_dato: "Pocos pedidos",
  sin_reales: "Sin pedidos reales",
};

export interface PixelGroup {
  key: string;
  platform: PixelPlatform;
  /** "Meta", "CR4", "NAD+ Men's Complex", "CR2 · NAD+ Men's Complex". */
  label: string;
  accountLabel: string | null;
  productKey: string | null;
  productName: string | null;
  /** Pixel purchases (Meta) or conversions (TikTok) of the compared days. */
  pixel: number;
  /** Estimated real orders (UTM + share by product), not annulled. */
  real: number;
  /** Of `real`, orders with the campaign's UTM. */
  utm: number;
  /** USD spend of the compared campaign-days; null when some spend is not convertible. */
  spendUsd: number | null;
  /** pixel ÷ real; null without real orders. */
  factor: number | null;
  tone: PixelTone;
  /** Distinct dates compared. */
  days: number;
  campaigns: number;
  detail: string;
}

export interface PixelHealthAlert {
  platform: PixelPlatform;
  accountLabel: string;
  date: string;
  code: "sin_conversiones" | "caida";
  pixel: number;
  real: number;
  /** Median pixel ÷ real of the other days (caída only). */
  usualFactor: number | null;
  title: string;
  detail: string;
}

export interface PixelReport {
  window: { from: string; to: string; days: number };
  platforms: PixelGroup[];
  accounts: PixelGroup[];
  products: PixelGroup[];
  accountProducts: PixelGroup[];
  /** Newest first. */
  health: PixelHealthAlert[];
  /** UTM real orders ÷ real orders compared. */
  utmShare: number | null;
  /** Campaigns with pixel purchases in the window but no product: not comparable. */
  excludedCampaigns: number;
  /** Last TikTok date sent by Make when it is before the window end. */
  tiktokThrough: string | null;
  notes: string[];
}

const PLATFORM_NAME: Record<PixelPlatform, string> = {
  meta: "Meta",
  tiktok: "TikTok",
};

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** "18,6" when estimated, "19" when whole. */
export const realOrdersText = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? countText(rounded) : decimalText(rounded);
};

/** "2,16" (two decimals) for a factor. */
export const factorText = (value: number | null) =>
  value == null
    ? "Sin dato"
    : new Intl.NumberFormat("es-CR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);

export function pixelTone(
  pixel: number,
  real: number,
  t: Pick<
    MarketingTargets,
    "pixelMinRealOrders" | "pixelFactorHigh" | "pixelFactorLow"
  > = MARKETING_TARGETS,
): PixelTone {
  if (real <= 0) return pixel > 0 ? "sin_reales" : "poco_dato";
  if (real < t.pixelMinRealOrders) return "poco_dato";
  const factor = pixel / real;
  if (factor > t.pixelFactorHigh) return "de_mas";
  if (factor < t.pixelFactorLow) return "de_menos";
  return "alineado";
}

function toneDetail(
  tone: PixelTone,
  factor: number | null,
  platform: PixelPlatform,
  t: Pick<MarketingTargets, "pixelMinRealOrders">,
) {
  const unit = platform === "meta" ? "compras" : "conversiones";
  switch (tone) {
    case "de_mas":
      return `Registra ${factorText(factor)} ${unit} por cada pedido real: el CPA del píxel se ve mejor de lo que es.`;
    case "de_menos":
      return `Registra ${factorText(factor)} ${unit} por cada pedido real: el CPA del píxel se ve peor de lo que es.`;
    case "alineado":
      return `Registra ${factorText(factor)} ${unit} por cada pedido real.`;
    case "sin_reales":
      return `${unit === "compras" ? "Compras" : "Conversiones"} en el píxel sin pedidos reales estimados.`;
    case "poco_dato":
      return `Menos de ${countText(t.pixelMinRealOrders)} pedidos reales: compara más días.`;
  }
}

/** One compared campaign-day. */
interface CampaignDay {
  campaign: AssignedCampaign;
  date: string;
  pixel: number;
  real: number;
  utm: number;
  spendUsd: number | null;
}

/**
 * Campaign-days that can be compared: the campaign has a product (its
 * estimate is not "unassigned"), the estimate of the day is known (TikTok
 * days Make has not sent yet are skipped) and the pixel value of the day is
 * known. A day without a daily row is 0 pixel and 0 spend.
 */
function comparableDays(
  campaigns: AssignedCampaign[],
  estimates: CampaignEstimates,
  dates: string[],
  fx: UsdRate | null,
): CampaignDay[] {
  const out: CampaignDay[] = [];
  for (const c of campaigns) {
    const byDate = estimates.get(c.key);
    for (const date of dates) {
      const rows = c.campaign.daily?.filter((d) => d.date === date) ?? [];
      const pixel = rows.some((d) => d.purchases == null)
        ? null
        : rows.reduce((n, d) => n + (d.purchases ?? 0), 0);
      const estimate = byDate?.get(date);
      if (!c.mapping || !c.members.length || estimate?.unassigned) continue;
      if (!c.campaign.daily || pixel == null) continue;
      if (!estimate || estimate.total == null) continue;
      const spend = rows.reduce((n, d) => n + d.spend, 0);
      out.push({
        campaign: c,
        date,
        pixel,
        real: estimate.total,
        utm: estimate.utm,
        spendUsd: asUsd(spend, c.account.currency, fx),
      });
    }
  }
  return out;
}

interface Bucket {
  key: string;
  platform: PixelPlatform;
  label: string;
  accountLabel: string | null;
  productKey: string | null;
  productName: string | null;
  pixel: number;
  real: number;
  utm: number;
  spendUsd: number | null;
  dates: Set<string>;
  campaigns: Set<string>;
}

function collect(
  rows: CampaignDay[],
  keyOf: (
    row: CampaignDay,
  ) => Omit<
    Bucket,
    "pixel" | "real" | "utm" | "spendUsd" | "dates" | "campaigns"
  >,
): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const head = keyOf(row);
    const bucket = buckets.get(head.key) ?? {
      ...head,
      pixel: 0,
      real: 0,
      utm: 0,
      spendUsd: 0,
      dates: new Set<string>(),
      campaigns: new Set<string>(),
    };
    bucket.pixel += row.pixel;
    bucket.real += row.real;
    bucket.utm += row.utm;
    bucket.spendUsd =
      bucket.spendUsd == null || row.spendUsd == null
        ? null
        : bucket.spendUsd + row.spendUsd;
    bucket.dates.add(row.date);
    bucket.campaigns.add(row.campaign.key);
    buckets.set(head.key, bucket);
  }
  return Array.from(buckets.values());
}

function toGroup(bucket: Bucket, t: MarketingTargets): PixelGroup {
  const real = round4(bucket.real);
  const tone = pixelTone(bucket.pixel, real, t);
  const factor = real > 0 ? bucket.pixel / real : null;
  return {
    key: bucket.key,
    platform: bucket.platform,
    label: bucket.label,
    accountLabel: bucket.accountLabel,
    productKey: bucket.productKey,
    productName: bucket.productName,
    pixel: bucket.pixel,
    real,
    utm: bucket.utm,
    spendUsd: bucket.spendUsd == null ? null : round4(bucket.spendUsd),
    factor,
    tone,
    days: bucket.dates.size,
    campaigns: bucket.campaigns.size,
    detail: toneDetail(tone, factor, bucket.platform, t),
  };
}

const byReal = (a: PixelGroup, b: PixelGroup) =>
  b.real - a.real || b.pixel - a.pixel || a.label.localeCompare(b.label);

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const healthKey = (c: AssignedCampaign) =>
  c.platform === "tiktok" ? "tiktok" : `meta:${c.account.accountId}`;

/**
 * Pixel purchases of every campaign (with or without a product) per health
 * group and date: a campaign without a product that buys proves the pixel works.
 */
function accountPixelByDay(
  campaigns: AssignedCampaign[],
  dates: string[],
): Map<string, Map<string, number>> {
  const wanted = new Set(dates);
  const out = new Map<string, Map<string, number>>();
  for (const c of campaigns) {
    for (const d of c.campaign.daily ?? []) {
      if (!wanted.has(d.date) || !(Number(d.purchases) > 0)) continue;
      const key = healthKey(c);
      const byDate = out.get(key) ?? new Map<string, number>();
      byDate.set(d.date, (byDate.get(d.date) ?? 0) + Number(d.purchases));
      out.set(key, byDate);
    }
  }
  return out;
}

/**
 * Pixel health per Meta account and for TikTok as one group, over every
 * complete day given (not only the comparison window). `accountPixel` adds
 * the purchases of campaigns left out of the comparison (no product): with
 * them the account's pixel is not "sin compras".
 */
function pixelHealth(
  rows: CampaignDay[],
  labelOf: (c: AssignedCampaign) => string,
  t: MarketingTargets,
  accountPixel: Map<string, Map<string, number>> = new Map(),
): PixelHealthAlert[] {
  const groups = new Map<
    string,
    {
      platform: PixelPlatform;
      label: string;
      days: Map<string, { p: number; r: number; spend: number | null }>;
    }
  >();
  for (const row of rows) {
    const platform = row.campaign.platform;
    const key = healthKey(row.campaign);
    const group = groups.get(key) ?? {
      platform,
      label: platform === "tiktok" ? "TikTok" : labelOf(row.campaign),
      days: new Map(),
    };
    const day = group.days.get(row.date) ?? { p: 0, r: 0, spend: 0 };
    day.p += row.pixel;
    day.r += row.real;
    day.spend =
      day.spend == null || row.spendUsd == null
        ? null
        : day.spend + row.spendUsd;
    group.days.set(row.date, day);
    groups.set(key, group);
  }
  const alerts: PixelHealthAlert[] = [];
  for (const [key, group] of Array.from(groups.entries())) {
    const all = accountPixel.get(key);
    const days = Array.from(group.days.entries())
      .map(([date, d]) => ({
        date,
        ...d,
        r: round4(d.r),
        // Whole account (also campaigns without product), never below p.
        account: Math.max(d.p, all?.get(date) ?? 0),
      }))
      // A day without spend is not a pixel problem.
      .filter((d) => d.spend == null || d.spend > 0);
    for (const day of days) {
      const base = {
        platform: group.platform,
        accountLabel: group.label,
        date: day.date,
        pixel: day.p,
        real: day.r,
      };
      const unit = group.platform === "meta" ? "compras" : "conversiones";
      if (day.p === 0 && day.r >= t.pixelHealthMinReal) {
        // Campaigns without product bought that day: the pixel works.
        if (day.account > 0) continue;
        alerts.push({
          ...base,
          code: "sin_conversiones",
          usualFactor: null,
          title: `Píxel de ${group.label} sin ${unit} el ${shortDateText(day.date)}`,
          detail: `≈ ${realOrdersText(day.r)} pedidos reales y 0 ${unit} en el píxel${
            day.spend != null ? ` con ${moneyText(day.spend)} de gasto` : ""
          }.`,
        });
        continue;
      }
      if (day.r < t.pixelMinRealOrders) continue;
      const others = days
        .filter((d) => d.date !== day.date && d.r >= t.pixelMinRealOrders)
        .map((d) => d.p / d.r);
      if (others.length < t.pixelHealthBaselineDays) continue;
      const usual = median(others);
      if (
        usual > 0 &&
        day.p / day.r < t.pixelHealthDropRatio * usual &&
        day.account / day.r < t.pixelHealthDropRatio * usual
      )
        alerts.push({
          ...base,
          code: "caida",
          usualFactor: usual,
          title: `Píxel de ${group.label} cayó el ${shortDateText(day.date)}`,
          detail: `Registró ${countText(day.p)} ${unit} con ≈ ${realOrdersText(day.r)} pedidos reales; lo normal es ${factorText(usual)} por pedido.`,
        });
    }
  }
  return alerts.sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      a.accountLabel.localeCompare(b.accountLabel),
  );
}

export function buildPixelReport(input: {
  campaigns: AssignedCampaign[];
  estimates: CampaignEstimates;
  /** Real order days of the control (today−13..today). */
  days: RealOrderDay[];
  labels: AccountLabel[];
  fx: UsdRate | null;
  windowDays?: number;
  /** CR date of today: never compared (incomplete). */
  today: string;
  t?: MarketingTargets;
}): PixelReport {
  const t = input.t ?? MARKETING_TARGETS;
  const windowDays = Math.max(1, input.windowDays ?? t.pixelWindowDays);
  const to = shiftDate(input.today, -1);
  const from = shiftDate(to, -(windowDays - 1));
  const complete = input.days
    .map((d) => d.date)
    .filter((date) => date < input.today);
  const windowDates = complete.filter((date) => date >= from && date <= to);
  const all = comparableDays(
    input.campaigns,
    input.estimates,
    complete,
    input.fx,
  );
  const inWindow = all.filter((d) => d.date >= from && d.date <= to);

  const labelOf = (c: AssignedCampaign) =>
    accountLabel(
      c.platform,
      c.account.accountId,
      c.account.accountName || "",
      input.labels,
    );
  // Several TikTok advertisers would all read "TikTok": add the account name.
  const labelCount = new Map<string, Set<string>>();
  for (const c of input.campaigns) {
    const label = labelOf(c);
    const ids = labelCount.get(label) ?? new Set<string>();
    ids.add(`${c.platform}:${c.account.accountId}`);
    labelCount.set(label, ids);
  }
  const uniqueLabel = (c: AssignedCampaign) => {
    const label = labelOf(c);
    return (labelCount.get(label)?.size ?? 0) > 1
      ? `${label} · ${c.account.accountName || c.account.accountId}`
      : label;
  };
  const product = (row: CampaignDay) => ({
    key: row.campaign.mapping!.product_key,
    name:
      row.campaign.mapping!.product_name || row.campaign.mapping!.product_key,
  });

  const platforms = collect(inWindow, (row) => ({
    key: row.campaign.platform,
    platform: row.campaign.platform,
    label: PLATFORM_NAME[row.campaign.platform],
    accountLabel: null,
    productKey: null,
    productName: null,
  }))
    .map((b) => toGroup(b, t))
    .sort(
      (a, b) =>
        (a.platform === "meta" ? -1 : 1) - (b.platform === "meta" ? -1 : 1),
    );
  const accounts = collect(inWindow, (row) => ({
    key: `${row.campaign.platform}:${row.campaign.account.accountId}`,
    platform: row.campaign.platform,
    label: uniqueLabel(row.campaign),
    accountLabel: uniqueLabel(row.campaign),
    productKey: null,
    productName: null,
  }))
    .map((b) => toGroup(b, t))
    .sort(byReal);
  const products = collect(inWindow, (row) => {
    const p = product(row);
    return {
      key: `${row.campaign.platform}|${p.key}`,
      platform: row.campaign.platform,
      label: p.name,
      accountLabel: null,
      productKey: p.key,
      productName: p.name,
    };
  })
    .map((b) => toGroup(b, t))
    .sort(byReal);
  const accountProducts = collect(inWindow, (row) => {
    const p = product(row);
    const account = uniqueLabel(row.campaign);
    return {
      key: `${row.campaign.platform}:${row.campaign.account.accountId}|${p.key}`,
      platform: row.campaign.platform,
      label: `${account} · ${p.name}`,
      accountLabel: account,
      productKey: p.key,
      productName: p.name,
    };
  })
    .map((b) => toGroup(b, t))
    .sort(byReal);

  const real = inWindow.reduce((n, d) => n + d.real, 0);
  const utm = inWindow.reduce((n, d) => n + d.utm, 0);
  const excluded = new Set<string>();
  for (const c of input.campaigns) {
    const pixel = (c.campaign.daily ?? [])
      .filter((d) => d.date >= from && d.date <= to)
      .reduce((n, d) => n + (d.purchases ?? 0), 0);
    if (pixel > 0 && (!c.mapping || !c.members.length)) excluded.add(c.key);
  }
  const tiktokThrough =
    input.campaigns
      .filter((c) => c.platform === "tiktok")
      .map((c) => c.observedThrough)
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1) ?? null;
  const hasTiktok = input.campaigns.some((c) => c.platform === "tiktok");
  const notes: string[] = [];
  if (excluded.size)
    notes.push(
      `${countText(excluded.size)} ${excluded.size === 1 ? "campaña sin producto no entra" : "campañas sin producto no entran"} en la comparación.`,
    );
  const tiktokLate = hasTiktok && (tiktokThrough == null || tiktokThrough < to);
  if (tiktokLate)
    notes.push(
      tiktokThrough
        ? `TikTok hasta el ${shortDateText(tiktokThrough)} (llega al día siguiente por Make).`
        : "TikTok sin días recibidos de Make en este rango.",
    );
  return {
    window: { from, to, days: windowDates.length },
    platforms,
    accounts,
    products,
    accountProducts,
    health: pixelHealth(
      all,
      uniqueLabel,
      t,
      accountPixelByDay(input.campaigns, complete),
    ),
    utmShare: real > 0 ? utm / real : null,
    excludedCampaigns: excluded.size,
    tiktokThrough: tiktokLate ? tiktokThrough : null,
    notes,
  };
}
