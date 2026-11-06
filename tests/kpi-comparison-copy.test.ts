import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildKpiComparisonCopy,
  relativeChangeCopy,
} from "../lib/kpi-comparison-copy";
import { getKpiWindows, type KpiRange } from "../lib/kpi-windows";
import { OperationalKpiCard } from "../components/OperationalKpiCard";

function comparison(
  range: KpiRange = "today",
  deltaLabel: string | null = "+8%",
  previousValue = "72",
) {
  return buildKpiComparisonCopy({
    range,
    window: getKpiWindows(
      range,
      new Date("2026-11-06T19:26:00Z"),
      { start: "2026-11-01", end: "2026-11-06" },
      "America/Costa_Rica",
    ),
    deltaLabel,
    previousValue,
  });
}

describe("KPI comparison communication", () => {
  it("explains today's change and the same-hour baseline without the redundant subtitle", () => {
    const html = renderToStaticMarkup(
      createElement(OperationalKpiCard, {
        label: "Pedidos generados",
        value: "78",
        sub: "pedidos creados",
        hideSubWhenComparing: true,
        comparison: comparison(),
        deltaTone: "good",
      }),
    );
    expect(html).toContain("↑ 8%");
    expect(html).toContain("vs. ayer");
    expect(html).toContain("Ayer a esta hora: 72");
    expect(html).not.toContain("pedidos creados");
    expect(html).not.toContain("truncate");
  });
  it.each([
    ["yesterday", "vs. anteayer", "Anteayer"],
    ["7d", "vs. 7 días previos", "7 días previos a este corte"],
    ["30d", "vs. 30 días previos", "30 días previos a este corte"],
    ["month", "vs. mes anterior", "Mes anterior a este corte"],
    ["custom", "vs. período previo", "Período previo a este corte"],
  ] as const)("uses the correct period for %s", (range, versus, baseline) => {
    expect(comparison(range)).toMatchObject({
      versusText: versus,
      baselineText: `${baseline}: 72`,
    });
  });
  it("keeps rate differences in percentage points and current sample counts visible", () => {
    const html = renderToStaticMarkup(
      createElement(OperationalKpiCard, {
        label: "Tasa de despacho",
        value: "39.7%",
        sub: "31/78 con guía",
        comparison: comparison("today", "−29.7 pp", "69.4%"),
        deltaTone: "bad",
      }),
    );
    expect(html).toContain("↓ 29.7 pp");
    expect(html).toContain("31/78 con guía");
    expect(html).toContain("Ayer a esta hora: 69.4%");
  });
  it("has no false direction for rounded zero, no percentage from a zero baseline, and no all-history comparison", () => {
    expect(comparison("today", "−0%")).toMatchObject({
      direction: "flat",
      changeText: "Sin cambio",
    });
    expect(comparison("today", null, "0")).toMatchObject({
      direction: null,
      changeText: "Sin base comparable",
      baselineText: "Ayer a esta hora: 0",
    });
    expect(comparison("all")).toBeNull();
  });
});

describe("Marketing real-order change", () => {
  it("compares 76 real orders with 69, independently of created orders", () => {
    expect(relativeChangeCopy(76, 69)).toEqual({
      text: "↑ 10,1% vs. ayer a esta hora",
      direction: "up",
    });
    expect(relativeChangeCopy(69, 76)).toEqual({
      text: "↓ 9,2% vs. ayer a esta hora",
      direction: "down",
    });
  });
  it("handles absent, invalid, zero and unchanged baselines", () => {
    expect(relativeChangeCopy(76, null)).toBeNull();
    expect(relativeChangeCopy(NaN, 69)).toBeNull();
    expect(relativeChangeCopy(76, Infinity)).toBeNull();
    expect(relativeChangeCopy(0, 0)?.direction).toBe("flat");
    expect(relativeChangeCopy(76, 0)?.text).toContain("Sin base porcentual");
    expect(relativeChangeCopy(76, 76)?.text).toContain("Sin cambio");
  });
});
