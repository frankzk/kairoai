import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyPace } from "../lib/marketing-pace";
import { DailyGoals } from "../components/marketing/DailyGoals";

vi.mock("../components/marketing/team-report.module.css", () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const pace: DailyPace = {
  today: "2026-11-06",
  asOf: "13:26",
  slot: 53,
  elapsedSlots: 53,
  orders: {
    real: 76,
    created: 82,
    goal: 200,
    progress: 0.38,
    gap: 124,
    yesterday: { real: 69, created: 76 },
    projected: null,
    typicalShare: null,
    cancelRate7d: null,
  },
  spend: {
    meta: null,
    total: null,
    goal: 800,
    progress: null,
    gap: null,
    tiktokEstimate: null,
    sameHour: null,
    projected: null,
    notes: [],
  },
  cpa: { real: null, created: null, goal: 4, projected: null },
  gapSpendAtGoalCpa: 496,
  notes: [],
};

describe("Marketing daily-goal comparison", () => {
  it("shows the growth percentage separately from goal progress and retains both baselines", () => {
    const html = renderToStaticMarkup(
      createElement(DailyGoals, { pace, loading: false, error: "" }),
    );
    expect(html).toContain("↑ 10,1% vs. ayer a esta hora");
    expect(html).toContain('data-trend="up"');
    expect(html).toContain("38% de la meta · 82 creados hoy");
    expect(html).toContain("Ayer a esta hora: 69 (creados 76)");
    expect(html).not.toContain("7,9%");
  });
  it("does not invent a comparison when yesterday is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(DailyGoals, {
        pace: { ...pace, orders: { ...pace.orders, yesterday: null } },
        loading: false,
        error: "",
      }),
    );
    expect(html).toContain("Sin comparación con ayer a esta hora");
    expect(html).not.toContain("data-trend");
  });
});
