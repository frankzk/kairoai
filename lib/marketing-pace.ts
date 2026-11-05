// "Hoy · cómo voy" (documento de mejoras, módulo 1): pedidos reales, gasto
// Meta + TikTok y CPA real contra las metas del día, hoy contra ayer a la
// misma hora, proyección de cierre y brecha. TikTok llega al día siguiente
// por Make, así que su gasto de hoy es un estimado con el último día completo.
// Puro.
import type {
  MarketingControl,
  MarketingPaceDay,
} from "./marketing-real-orders";
import { PACE_SLOTS, PACE_SLOT_MINUTES } from "./marketing-real-orders";
import type {
  MarketingAdsData,
  MarketingSources,
} from "./marketing-source-types";
import type { UsdRate } from "./marketing-charlie-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { dateTime, marketingDate, shiftDate } from "./marketing-dates";
import { asUsd } from "./marketing-usd-rate";
import { shortDateText, timeCrText } from "./marketing-copy";

export interface PaceInput {
  control: MarketingControl;
  sources: MarketingSources | null;
  fx: UsdRate | null;
  now?: Date;
  targets?: MarketingTargets;
}
export interface DailyPace {
  today: string;
  /** "14:35" in Costa Rica. */
  asOf: string;
  /** Index of the current 15-minute slot (0 = 00:00–00:14). */
  slot: number;
  /** Completed 15-minute slots of today. */
  elapsedSlots: number;
  orders: {
    created: number;
    real: number;
    goal: number;
    progress: number;
    gap: number;
    /** Same time yesterday (real = yesterday's current status); null without pace data. */
    yesterday: { created: number; real: number } | null;
    /** null = too early to project. */
    projected: { created: number; real: number } | null;
    typicalShare: number | null;
    cancelRate7d: number | null;
  };
  spend: {
    meta: number | null;
    /**
     * TikTok arrives a day late: `value` is its latest full day, `soFar` that
     * day scaled to the share of the day already spent (so-far numbers use it).
     */
    tiktokEstimate: { value: number; soFar: number; fromDate: string } | null;
    /** Meta today + TikTok `soFar`. */
    total: number | null;
    goal: number;
    progress: number | null;
    gap: number | null;
    /** Meta only, through the last complete hour. */
    sameHour: {
      through: string;
      today: number | null;
      yesterday: number | null;
    } | null;
    projected: number | null;
    notes: string[];
  };
  cpa: {
    real: number | null;
    created: number | null;
    goal: number;
    projected: number | null;
  };
  /** Orders gap × target CPA. */
  gapSpendAtGoalCpa: number | null;
  notes: string[];
}

const MIN_SHARE = 0.1;
const MIN_HISTORY_TOTAL = 20;
const MIN_HISTORY_DAYS = 3;

const cumulative = (values: number[], slot: number) =>
  values.slice(0, slot + 1).reduce((n, v) => n + v, 0);
/**
 * Past days up to the same minute as now: complete slots before `slot` plus
 * the elapsed fraction of the current one (today stops at "now", so the whole
 * current slot of a past day would be ahead of it).
 */
const cumulativeAt = (values: number[], slot: number, fraction: number) =>
  cumulative(values, slot - 1) + (values[slot] ?? 0) * fraction;
const total = (values: number[]) => values.reduce((n, v) => n + v, 0);
const mean = (values: number[]) =>
  values.reduce((n, v) => n + v, 0) / values.length;

/**
 * Typical share of the day's orders created by `slot` (plus `fraction` of it,
 * 1 = the end of the slot): mean of cum/total over days with at least 20
 * orders; needs 3 such days.
 */
export function typicalShare(
  days: Array<{ created: number[] }>,
  slot: number,
  fraction = 1,
): number | null {
  const shares = days
    .filter((d) => total(d.created) >= MIN_HISTORY_TOTAL)
    .map((d) => cumulativeAt(d.created, slot, fraction) / total(d.created));
  return shares.length >= MIN_HISTORY_DAYS ? mean(shares) : null;
}

/** USD per CR date of the Meta accounts (daily overview, else campaign rows). null if any account is unknown. */
function metaSpendOn(
  accounts: MarketingAdsData[],
  date: string,
  fx: UsdRate | null,
): number | null {
  let sum = 0;
  for (const account of accounts) {
    let native: number | null;
    if (
      account.dailySpend &&
      date >= account.dailySpend.from &&
      date <= account.dailySpend.to
    )
      native = account.dailySpend.days.find((d) => d.date === date)?.spend ?? 0;
    else if (account.campaigns.every((c) => c.daily))
      native = account.campaigns.reduce(
        (n, c) =>
          n +
          c
            .daily!.filter((d) => d.date === date)
            .reduce((s, d) => s + d.spend, 0),
        0,
      );
    else native = null;
    const usd = asUsd(native, account.currency, fx);
    if (usd == null) return null;
    sum += usd;
  }
  return sum;
}

/** Hourly USD for one date across accounts (24 values), or null when an account lacks hourly data. */
function hourlyOn(
  accounts: MarketingAdsData[],
  date: string,
  fx: UsdRate | null,
): number[] | null {
  const out = Array<number>(24).fill(0);
  for (const account of accounts) {
    const day = account.hourly?.days.find((d) => d.date === date);
    if (
      !account.hourly ||
      date < account.hourly.from ||
      date > account.hourly.to
    )
      return null;
    for (let h = 0; h < 24; h++) {
      const usd = asUsd(day?.hours[h] ?? 0, account.currency, fx);
      if (usd == null) return null;
      out[h] += usd;
    }
  }
  return out;
}

/** Latest TikTok day before today with data, in USD (summed across accounts). */
function tiktokLatest(
  accounts: MarketingAdsData[],
  today: string,
  fx: UsdRate | null,
): { value: number; fromDate: string } | null {
  const dates = accounts.flatMap((a) =>
    a.campaigns.flatMap((c) => c.daily?.map((d) => d.date) ?? []),
  );
  const fromDate = dates
    .filter((d) => d < today)
    .sort()
    .at(-1);
  if (!fromDate) return null;
  let value = 0;
  for (const account of accounts) {
    const native = account.campaigns.reduce(
      (n, c) =>
        n +
        (c.daily ?? [])
          .filter((d) => d.date === fromDate)
          .reduce((s, d) => s + d.spend, 0),
      0,
    );
    const usd = asUsd(native, account.currency, fx);
    if (usd == null) return null;
    value += usd;
  }
  return { value, fromDate };
}

export function buildDailyPace(input: PaceInput): DailyPace {
  const t = input.targets ?? MARKETING_TARGETS;
  const now = input.now ?? new Date();
  const today = input.control.today || marketingDate(now);
  const yesterday = shiftDate(today, -1);
  const notes: string[] = [];
  const minutes = (now.getTime() - dateTime(today)) / 60_000;
  const slot = Math.min(
    PACE_SLOTS - 1,
    Math.max(0, Math.floor(minutes / PACE_SLOT_MINUTES)),
  );
  const elapsedSlots = Math.min(PACE_SLOTS, Math.max(0, slot));
  /** Elapsed part of the current slot (0–1). */
  const slotFraction = Math.min(
    1,
    Math.max(0, (minutes - slot * PACE_SLOT_MINUTES) / PACE_SLOT_MINUTES),
  );

  // Orders.
  const paceDays = input.control.pace?.days ?? [];
  const todayPace = paceDays.find((d) => d.date === today);
  const history = paceDays.filter((d) => d.date < today);
  const yesterdayPace = paceDays.find((d) => d.date === yesterday);
  const controlToday = input.control.days.find((d) => d.date === today);
  const created = todayPace
    ? cumulative(todayPace.created, slot)
    : (controlToday?.created ?? 0);
  const real = todayPace
    ? cumulative(todayPace.real, slot)
    : (controlToday?.real ?? 0);
  if (slot === 0 && created === 0) notes.push("Sin datos todavía");
  const share = todayPace ? typicalShare(history, slot, slotFraction) : null;
  const historyCreated = history.reduce((n, d) => n + total(d.created), 0);
  const historyReal = history.reduce((n, d) => n + total(d.real), 0);
  const cancelRate7d =
    historyCreated > 0 ? 1 - historyReal / historyCreated : null;
  let projectedCreated: number | null = null;
  if (todayPace) {
    if (share != null) {
      if (share >= MIN_SHARE) projectedCreated = Math.round(created / share);
    } else {
      const linear = (slot + slotFraction) / PACE_SLOTS;
      if (linear >= MIN_SHARE) {
        projectedCreated = Math.round(created / linear);
        notes.push("Proyección lineal (poco historial)");
      }
    }
  }
  const keepRate =
    cancelRate7d != null ? 1 - cancelRate7d : created > 0 ? real / created : 1;
  const projectedOrders =
    projectedCreated == null
      ? null
      : {
          created: projectedCreated,
          real: Math.round(projectedCreated * keepRate),
        };
  if (!projectedOrders && !notes.includes("Sin datos todavía"))
    notes.push("Muy temprano para proyectar.");
  const ordersGap = Math.max(0, t.dailyOrders - real);

  // Spend.
  const spendNotes: string[] = [];
  const metaAccounts =
    input.sources?.meta.status === "ready"
      ? (input.sources.meta.data?.accounts ?? [])
      : null;
  const meta = metaAccounts ? metaSpendOn(metaAccounts, today, input.fx) : null;
  if (meta == null) spendNotes.push("Gasto de Meta no disponible");
  const tiktokAccounts =
    input.sources?.tiktok.status === "ready"
      ? (input.sources.tiktok.data?.accounts ?? [])
      : null;
  const tiktokLast = tiktokAccounts?.length
    ? tiktokLatest(tiktokAccounts, today, input.fx)
    : null;
  if (tiktokLast)
    spendNotes.push(
      `TikTok ≈ estimado con el ${shortDateText(tiktokLast.fromDate)}; llega al día siguiente por Make.`,
    );
  else spendNotes.push("TikTok sin datos de gasto recientes");
  const hour = Math.floor(minutes / 60);
  const minuteFraction = (minutes - hour * 60) / 60;
  const todayHourly = metaAccounts?.length
    ? hourlyOn(metaAccounts, today, input.fx)
    : null;
  let sameHour: DailyPace["spend"]["sameHour"] = null;
  if (!todayHourly) spendNotes.push("Sin gasto por hora");
  else if (hour >= 1) {
    const yesterdayHourly = hourlyOn(metaAccounts!, yesterday, input.fx);
    const upTo = (hours: number[] | null) =>
      hours ? hours.slice(0, hour).reduce((n, v) => n + v, 0) : null;
    sameHour = {
      through: `${String(hour).padStart(2, "0")}:00`,
      today: upTo(todayHourly),
      yesterday: upTo(yesterdayHourly),
    };
  }
  let metaShare: number | null = null;
  if (todayHourly) {
    const shares: number[] = [];
    for (let i = 1; i <= 7; i++) {
      const hours = hourlyOn(metaAccounts!, shiftDate(today, -i), input.fx);
      const dayTotal = hours ? total(hours) : 0;
      if (!hours || dayTotal <= 0) continue;
      const before = hours.slice(0, hour).reduce((n, v) => n + v, 0);
      shares.push((before + (hours[hour] ?? 0) * minuteFraction) / dayTotal);
    }
    if (shares.length >= MIN_HISTORY_DAYS) metaShare = mean(shares);
  }
  if (metaShare == null) {
    const linear = Math.min(1, Math.max(0, minutes / 1440));
    metaShare = linear;
    if (meta != null && linear >= MIN_SHARE)
      spendNotes.push("Proyección de gasto lineal (sin historial por hora)");
  }
  const projectedMeta =
    meta != null && metaShare >= MIN_SHARE ? meta / metaShare : null;
  // TikTok's latest day is a full day; "so far today" takes the share of the
  // day already spent (Meta's hourly curve, else the elapsed time).
  const tiktokEstimate = tiktokLast
    ? { ...tiktokLast, soFar: tiktokLast.value * metaShare }
    : null;
  const totalSpend = meta != null ? meta + (tiktokEstimate?.soFar ?? 0) : null;
  const projectedSpend =
    projectedMeta != null ? projectedMeta + (tiktokEstimate?.value ?? 0) : null;

  return {
    today,
    asOf: timeCrText(now),
    slot,
    elapsedSlots,
    orders: {
      created,
      real,
      goal: t.dailyOrders,
      progress: real / t.dailyOrders,
      gap: ordersGap,
      yesterday: yesterdayPace
        ? sameTime(yesterdayPace, slot, slotFraction)
        : null,
      projected: projectedOrders,
      typicalShare: share,
      cancelRate7d,
    },
    spend: {
      meta,
      tiktokEstimate,
      total: totalSpend,
      goal: t.dailySpendUsd,
      progress: totalSpend == null ? null : totalSpend / t.dailySpendUsd,
      gap:
        totalSpend == null ? null : Math.max(0, t.dailySpendUsd - totalSpend),
      sameHour,
      projected: projectedSpend,
      notes: spendNotes,
    },
    cpa: {
      real: totalSpend != null && real > 0 ? totalSpend / real : null,
      created: totalSpend != null && created > 0 ? totalSpend / created : null,
      goal: t.cpaUsd,
      projected:
        projectedSpend != null && projectedOrders && projectedOrders.real > 0
          ? projectedSpend / projectedOrders.real
          : null,
    },
    gapSpendAtGoalCpa: ordersGap * t.cpaUsd,
    notes,
  };
}

const sameTime = (day: MarketingPaceDay, slot: number, fraction: number) => ({
  created: Math.round(cumulativeAt(day.created, slot, fraction)),
  real: Math.round(cumulativeAt(day.real, slot, fraction)),
});
