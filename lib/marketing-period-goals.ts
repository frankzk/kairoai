// Metas del período elegido en el filtro (Reporte general): las metas diarias
// (200 pedidos reales, USD 1 700 de gasto, CPA real USD 8,50) multiplicadas
// por los días del período. Así lo primero que se ve sigue al filtro; el ritmo
// de hoy queda aparte y solo cuando el período incluye hoy.
import { MARKETING_TARGETS } from "./marketing-targets";

export interface PeriodGoalsInput {
  period: { from: string; to: string; days: number };
  today: string;
  /** Pedidos reales del período (creados − anulados). */
  realOrders: number;
  /** Gasto Meta + TikTok del período en USD (null = incompleto). */
  spendUsd: number | null;
  /** CPA real del período (null = sin gasto completo o sin pedidos). */
  cpaReal: number | null;
  targets?: { dailyOrders: number; dailySpendUsd: number; cpaUsd: number };
}

export interface PeriodGoals {
  days: number;
  /** El período llega a hoy: el último día todavía está en curso. */
  includesToday: boolean;
  orders: { value: number; goal: number; progress: number; perDay: number };
  spend: {
    value: number | null;
    goal: number;
    progress: number | null;
    perDay: number | null;
  };
  cpa: { value: number | null; goal: number; over: boolean; progress: number | null };
}

export function periodGoals(input: PeriodGoalsInput): PeriodGoals {
  const t = input.targets ?? MARKETING_TARGETS;
  const days = Math.max(1, input.period.days);
  const includesToday =
    input.period.from <= input.today && input.period.to >= input.today;
  const ordersGoal = t.dailyOrders * days;
  const spendGoal = t.dailySpendUsd * days;
  const spend = input.spendUsd;
  const cpa = input.cpaReal;
  return {
    days,
    includesToday,
    orders: {
      value: input.realOrders,
      goal: ordersGoal,
      progress: ordersGoal > 0 ? input.realOrders / ordersGoal : 0,
      perDay: input.realOrders / days,
    },
    spend: {
      value: spend,
      goal: spendGoal,
      progress: spend == null || spendGoal <= 0 ? null : spend / spendGoal,
      perDay: spend == null ? null : spend / days,
    },
    cpa: {
      value: cpa,
      goal: t.cpaUsd,
      over: cpa != null && cpa > t.cpaUsd,
      progress: cpa == null || t.cpaUsd <= 0 ? null : cpa / t.cpaUsd,
    },
  };
}
