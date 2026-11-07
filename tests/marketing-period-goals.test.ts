import { describe, expect, it } from "vitest";
import { periodGoals } from "@/lib/marketing-period-goals";

const targets = { dailyOrders: 200, dailySpendUsd: 1700, cpaUsd: 8.5 };

describe("periodGoals", () => {
  it("multiplica las metas diarias por los días del período", () => {
    const g = periodGoals({
      period: { from: "2026-11-01", to: "2026-11-06", days: 6 },
      today: "2026-11-06",
      realOrders: 637,
      spendUsd: 6299.29,
      cpaReal: 6299.29 / 637,
      targets,
    });
    expect(g.days).toBe(6);
    expect(g.includesToday).toBe(true);
    expect(g.orders.goal).toBe(1200);
    expect(g.orders.progress).toBeCloseTo(637 / 1200);
    expect(g.orders.perDay).toBeCloseTo(637 / 6);
    expect(g.spend.goal).toBe(10200);
    expect(g.spend.perDay).toBeCloseTo(6299.29 / 6);
    expect(g.cpa.over).toBe(true);
  });

  it("un día cerrado (ayer) no incluye hoy", () => {
    const g = periodGoals({
      period: { from: "2026-11-05", to: "2026-11-05", days: 1 },
      today: "2026-11-06",
      realOrders: 180,
      spendUsd: 1500,
      cpaReal: 1500 / 180,
      targets,
    });
    expect(g.includesToday).toBe(false);
    expect(g.orders.goal).toBe(200);
    expect(g.cpa.over).toBe(false);
  });

  it("sin gasto completo no hay avance de gasto ni CPA", () => {
    const g = periodGoals({
      period: { from: "2026-11-01", to: "2026-11-03", days: 3 },
      today: "2026-11-06",
      realOrders: 0,
      spendUsd: null,
      cpaReal: null,
      targets,
    });
    expect(g.spend.progress).toBeNull();
    expect(g.spend.perDay).toBeNull();
    expect(g.cpa.progress).toBeNull();
    expect(g.cpa.over).toBe(false);
    expect(g.orders.progress).toBe(0);
  });
});
