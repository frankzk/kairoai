// Simulador del camino a 200 pedidos reales por día (documento de mejoras,
// módulo 10). Puro: se prueba en tests/marketing-simulator.test.ts.
//
// Pedidos reales = publicidad (gasto ÷ CPA real) + pedidos sin campaña +
// palancas (carritos recuperados y recompras extra). Bajar la anulación
// multiplica los pedidos reales por k = (1 − meta) / (1 − hoy): los mismos
// pedidos creados dejan más pedidos reales.
import type { RealOrderDay } from "./marketing-real-orders";
import {
  channelOrders,
  type CampaignEstimates,
  type SpendRow,
} from "./marketing-real-cpa";
import type { OrderFactsPayload } from "./marketing-insights-types";
import { shiftDate } from "./marketing-dates";
import { moneyText, shortDateText } from "./marketing-copy";
import { closedCancelRate } from "./marketing-cancellations";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";

export interface SimulatorInput {
  /** Daily spend Meta + TikTok (USD). */
  spendUsd: number;
  /** Real CPA of the ads (real orders of campaigns), USD. */
  cpaRealUsd: number;
  /** Real orders per day without a campaign (organic / not assigned). */
  otherRealPerDay: number;
  /** Cancellation rate today, 0..1 (M7's rate on closed days). */
  cancelRateNow: number;
  /** Cancellation rate to simulate, 0..1. */
  cancelRateTarget: number;
  /** Extra recovered carts per day (created orders). */
  extraCartsPerDay: number;
  /** Extra repeat purchases per day (created orders). */
  extraRepeatPerDay: number;
  /** Default MARKETING_TARGETS.dailyOrders. */
  goalOrders?: number;
}

export interface SimulatorResult {
  /** Multiplier of real orders from the cancellation change. */
  k: number;
  adOrders: number;
  otherOrders: number;
  leverOrders: number;
  total: number;
  goal: number;
  /** Orders missing to reach the goal (0 when reached). */
  gap: number;
  /** Daily spend needed for the goal at this CPA and levers (0 = already covered). */
  spendForGoal: number | null;
  /** CPA that reaches the goal with this spend and levers (null = covered without ads or no spend). */
  cpaForGoal: number | null;
  breakdown: Array<{
    code: "ads" | "other" | "carts" | "repeat";
    label: string;
    orders: number;
  }>;
}

const finite = (value: number) => (Number.isFinite(value) ? value : 0);
const positive = (value: number) => Math.max(0, finite(value));
const rate = (value: number) => Math.min(1, positive(value));

/** k = (1 − target) / (1 − now); 1 when the current rate is 100 % (nothing to scale). */
export function cancelFactor(now: number, target: number): number {
  const n = rate(now),
    g = rate(target);
  return n >= 1 ? 1 : (1 - g) / (1 - n);
}

export function simulateOrders(input: SimulatorInput): SimulatorResult {
  const goal = positive(input.goalOrders ?? MARKETING_TARGETS.dailyOrders);
  const spend = positive(input.spendUsd);
  const cpa = positive(input.cpaRealUsd);
  const k = cancelFactor(input.cancelRateNow, input.cancelRateTarget);
  const keep = 1 - rate(input.cancelRateTarget);
  const adOrders = cpa > 0 ? (spend / cpa) * k : 0;
  const otherOrders = positive(input.otherRealPerDay) * k;
  const carts = positive(input.extraCartsPerDay) * keep;
  const repeat = positive(input.extraRepeatPerDay) * keep;
  const leverOrders = carts + repeat;
  const total = adOrders + otherOrders + leverOrders;
  const need = goal - otherOrders - leverOrders;
  return {
    k,
    adOrders,
    otherOrders,
    leverOrders,
    total,
    goal,
    gap: Math.max(0, goal - total),
    spendForGoal:
      need <= 0 ? 0 : k > 0 && cpa > 0 ? (need / k) * cpa : null,
    cpaForGoal: need <= 0 || spend <= 0 || k <= 0 ? null : (spend * k) / need,
    breakdown: [
      { code: "ads", label: "Publicidad", orders: adOrders },
      { code: "other", label: "Sin campaña", orders: otherOrders },
      { code: "carts", label: "Carritos recuperados extra", orders: carts },
      { code: "repeat", label: "Recompras extra", orders: repeat },
    ],
  };
}

export interface SimulatorReference {
  /** Real orders per day labelled "Carrito abandonado recuperado". */
  cartsPerDay: number | null;
  /** Real orders per day from the WhatsApp bot. */
  botPerDay: number | null;
  /** Repeat purchases per day (phone bought before); null without the RPC. */
  repeatPerDay: number | null;
  repeatStatus: OrderFactsPayload["repeat"]["status"] | "sin_datos";
  from: string | null;
  to: string | null;
  days: number;
}

export interface SimulatorDefaults {
  values: SimulatorInput;
  /** Complete days used for spend, CPA and orders without campaign. */
  window: { from: string | null; to: string | null; days: number };
  /** Days used for today's cancellation rate (closed days only). */
  cancelWindow: { from: string | null; to: string | null; days: number };
  /**
   * "cancelaciones": same definition as M7; "todos": every order of the
   * control days (no order facts); null: no closed day with orders.
   */
  cancelSource: "cancelaciones" | "todos" | null;
  /** Share of real orders with a campaign UTM in the window (rest assigned by product). */
  utmShare: number | null;
  reference: SimulatorReference;
  notes: string[];
}

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/**
 * Starting values from the last week: the 7 complete
 * days before today that have every reporting campaign's spend (TikTok
 * arrives a day late: a day without it leaves both the spend and the orders).
 */
export function simulatorDefaults(input: {
  days: RealOrderDay[];
  estimates: CampaignEstimates;
  spend: SpendRow[];
  facts: Pick<
    OrderFactsPayload,
    "facts" | "repeat" | "to" | "loadedFrom"
  > | null;
  today: string;
  windowDays?: number;
  t?: MarketingTargets;
}): SimulatorDefaults {
  const t = input.t ?? MARKETING_TARGETS;
  const windowDays = input.windowDays ?? 7;
  const notes: string[] = [];
  const yesterday = shiftDate(input.today, -1);
  const first = shiftDate(yesterday, -(windowDays - 1));
  const candidates = input.days.filter(
    (d) => d.date >= first && d.date <= yesterday,
  );
  // Campaigns that report daily spend at all; a null day of one of them = not reported yet.
  const byCampaign = new Map<string, SpendRow[]>();
  for (const row of input.spend) {
    const key = `${row.platform}:${row.accountId}:${row.campaignId}`;
    byCampaign.set(key, [...(byCampaign.get(key) ?? []), row]);
  }
  let silent = 0;
  const missingDates = new Set<string>();
  const spendByDate = new Map<string, number>();
  for (const rows of Array.from(byCampaign.values())) {
    if (rows.every((row) => row.spendUsd == null)) {
      if (rows.length) silent += 1;
      continue;
    }
    for (const row of rows) {
      if (row.spendUsd == null) missingDates.add(row.date);
      else
        spendByDate.set(
          row.date,
          (spendByDate.get(row.date) ?? 0) + row.spendUsd,
        );
    }
  }
  const included = candidates.filter((d) => !missingDates.has(d.date));
  const skipped = candidates
    .filter((d) => missingDates.has(d.date))
    .map((d) => d.date);
  if (skipped.length)
    notes.push(
      `Sin gasto completo del ${skipped.map(shortDateText).join(", ")} (TikTok llega al día siguiente): ${skipped.length === 1 ? "ese día no entra" : "esos días no entran"}.`,
    );
  if (silent)
    notes.push(
      `${silent} ${silent === 1 ? "campaña sin gasto diario convertible no entra" : "campañas sin gasto diario convertible no entran"}.`,
    );
  const n = included.length;
  const from = n ? included[0].date : null;
  const to = n ? included[n - 1].date : null;
  const spendSum = included.reduce(
    (sum, d) => sum + (spendByDate.get(d.date) ?? 0),
    0,
  );
  const channel =
    n && from && to
      ? channelOrders(included, input.estimates, from, to)
      : null;
  const adReal = channel ? channel.meta.total + channel.tiktok.total : 0;
  let cpa: number = t.cpaUsd;
  if (n && adReal > 0) cpa = spendSum / adReal;
  else if (n)
    notes.push(
      `Sin pedidos reales de campaña en esos días: se usa el CPA meta (${moneyText(t.cpaUsd)}).`,
    );
  if (!n)
    notes.push(
      "Sin días completos con gasto y pedidos: los valores son las metas del equipo.",
    );

  // Cancellation: closed days only (the last `cancelOpenDays` can still be
  // annulled), with M7's definition (lib/marketing-cancellations.ts) so it is
  // the same number as "Cancelaciones". Without the order facts: every order
  // of the control days, which also counts tests and upsell replacements.
  const fromFacts = input.facts
    ? closedCancelRate(input.facts, input.today, windowDays, t)
    : null;
  let cancelNow = 0;
  let cancelWindow: SimulatorDefaults["cancelWindow"];
  let cancelSource: SimulatorDefaults["cancelSource"];
  if (fromFacts && fromFacts.rate != null) {
    cancelNow = fromFacts.rate;
    cancelWindow = { from: fromFacts.from, to: fromFacts.to, days: fromFacts.days };
    cancelSource = "cancelaciones";
  } else {
    const lastClosed = shiftDate(input.today, -t.cancelOpenDays);
    const closed = input.days
      .filter((d) => d.date <= lastClosed && d.created > 0)
      .slice(-windowDays);
    const created = closed.reduce((sum, d) => sum + d.created, 0);
    const real = closed.reduce((sum, d) => sum + d.real, 0);
    cancelNow = created > 0 ? Math.max(0, 1 - real / created) : 0;
    cancelWindow = {
      from: closed[0]?.date ?? null,
      to: closed.at(-1)?.date ?? null,
      days: closed.length,
    };
    cancelSource = created > 0 ? "todos" : null;
    if (!created)
      notes.push(
        "Sin pedidos de días cerrados: la anulación de hoy queda en 0 %.",
      );
    else
      notes.push(
        "Anulación de hoy con todos los pedidos (sin el detalle de iComfly): incluye pruebas y reemplazos por upsell, puede ser más alta que en Cancelaciones.",
      );
  }

  const values: SimulatorInput = {
    spendUsd: n ? round(spendSum / n, 2) : t.dailySpendUsd,
    cpaRealUsd: round(cpa, 2),
    otherRealPerDay: channel && n ? round(channel.other / n, 1) : 0,
    cancelRateNow: round(cancelNow, 3),
    cancelRateTarget: round(cancelNow, 3),
    extraCartsPerDay: 0,
    extraRepeatPerDay: 0,
    goalOrders: t.dailyOrders,
  };
  return {
    values,
    window: { from, to, days: n },
    cancelWindow,
    cancelSource,
    utmShare: channel?.utmShare ?? null,
    reference: simulatorReference(input.facts, input.today, windowDays),
    notes,
  };
}

/** Recovered carts, bot sales and repeat purchases per day (shown, never added). */
export function simulatorReference(
  facts: Pick<OrderFactsPayload, "facts" | "repeat" | "to" | "loadedFrom"> | null,
  today: string,
  windowDays = 7,
): SimulatorReference {
  const empty: SimulatorReference = {
    cartsPerDay: null,
    botPerDay: null,
    repeatPerDay: null,
    repeatStatus: "sin_datos",
    from: null,
    to: null,
    days: 0,
  };
  if (!facts) return empty;
  const yesterday = shiftDate(today, -1);
  const to = facts.to < yesterday ? facts.to : yesterday;
  const start = shiftDate(to, -(windowDays - 1));
  const from = start < facts.loadedFrom ? facts.loadedFrom : start;
  if (from > to) return { ...empty, repeatStatus: facts.repeat.status };
  const days =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  let carts = 0,
    bot = 0;
  for (const [date, state, , origin] of facts.facts) {
    if (state !== 0 || date < from || date > to) continue;
    if (origin === "carrito") carts += 1;
    else if (origin === "bot") bot += 1;
  }
  const repeat =
    facts.repeat.status === "ok"
      ? facts.repeat.days
          .filter((d) => d.date >= from && d.date <= to)
          .reduce((sum, d) => sum + d.repeat, 0)
      : null;
  return {
    cartsPerDay: round(carts / days, 1),
    botPerDay: round(bot / days, 1),
    repeatPerDay: repeat == null ? null : round(repeat / days, 1),
    repeatStatus: facts.repeat.status,
    from,
    to,
    days,
  };
}
