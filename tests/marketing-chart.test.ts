import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bandIndex,
  columnPath,
  labelsFit,
  nearestIndex,
  niceTicks,
  shortName,
  xLabelIndexes,
} from "../lib/marketing-chart";

vi.mock("../components/marketing/charts.module.css", () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock("../components/marketing/team-report.module.css", () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

describe("marketing chart scales", () => {
  it("rounds axis ticks to clean steps that cover the maximum", () => {
    expect(niceTicks(155, 4, true)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(58, 4, true)).toEqual([0, 20, 40, 60]);
    expect(niceTicks(3, 4, true)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0.353)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it("never yields fractional steps for counts", () => {
    for (const max of [1, 2, 7, 9, 13]) {
      for (const tick of niceTicks(max, 4, true))
        expect(Number.isInteger(tick)).toBe(true);
    }
  });
  it("snaps the pointer to the nearest point and to the band under it", () => {
    expect(nearestIndex(0, 30, 40, 580)).toBe(0);
    expect(nearestIndex(40 + 580 * 0.5, 31, 40, 580)).toBe(15);
    expect(nearestIndex(9999, 30, 40, 580)).toBe(29);
    expect(nearestIndex(100, 1, 40, 580)).toBe(0);
    expect(bandIndex(40 + 59, 7, 40, 700)).toBe(0);
    expect(bandIndex(40 + 101, 7, 40, 700)).toBe(1);
    expect(bandIndex(-50, 7, 40, 700)).toBe(0);
  });
  it("keeps first and last x labels and spaces the rest without collisions", () => {
    expect(xLabelIndexes(7, 700)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const thirty = xLabelIndexes(30, 300, 56);
    expect(thirty[0]).toBe(0);
    expect(thirty[thirty.length - 1]).toBe(29);
    const px = (i: number) => (i / 29) * 300;
    thirty.slice(1).forEach((index, i) =>
      expect(px(index) - px(thirty[i])).toBeGreaterThanOrEqual(56),
    );
  });
  it("only allows end labels that do not overlap", () => {
    expect(labelsFit([20, 60, 100])).toBe(true);
    expect(labelsFit([20, 28, 100])).toBe(false);
  });
  it("draws columns with a rounded data end and a square baseline", () => {
    expect(columnPath(10, 20, 24, 100)).toBe(
      "M10,120V24Q10,20 14,20H30Q34,20 34,24V120Z",
    );
    expect(columnPath(0, 0, 10, 2)).toContain("V2");
    expect(columnPath(0, 0, 10, 0)).toBe("");
    expect(shortName("Colágeno hidrolizado con biotina")).toBe(
      "Colágeno hidrol…",
    );
  });
});

describe("marketing chart components", () => {
  it("renders a column chart with one labelled peak, a table-safe aria label and no number on every bar", async () => {
    const { ColumnChart } = await import("../components/marketing/charts");
    const html = renderToStaticMarkup(
      createElement(ColumnChart, {
        ariaLabel: "Pedidos por día",
        bins: [10, 30, 20].map((value, i) => ({
          key: `d${i}`,
          label: `${i + 1} nov`,
          title: `${i + 1} nov`,
          stacks: [
            [
              {
                key: "orders",
                label: "pedidos",
                value,
                color: "var(--mk-series-1)",
              },
            ],
          ],
        })),
      }),
    );
    expect(html).toContain('role="group"');
    expect(html).toContain("Pedidos por día. Usa las flechas");
    expect(html.match(/<path /g)).toHaveLength(3);
    expect(html.match(/class="label"/g)).toHaveLength(1);
    expect(html).toContain(">30<");
  });
  it("keeps each product's color when the legend hides another one", async () => {
    const { TrendChart } = await import("../components/marketing/TeamReportCharts");
    const daily = ["2026-11-01", "2026-11-02"].map((date) => ({ date }));
    const product = (key: string, orders: number) => ({
      key,
      name: key,
      orders,
      scope: "all",
      daily: daily.map((d) => ({ date: d.date, orders })),
    });
    const html = renderToStaticMarkup(
      createElement(TrendChart, {
        data: {
          daily,
          period: { from: "2026-11-01", to: "2026-11-02" },
          products: [],
          groupedProducts: [product("B", 5), product("A", 9), product("C", 2)],
        } as never,
      }),
    );
    // Ranked A, B, C → slots 1, 2, 3 in the legend and on the lines.
    expect(html.indexOf("var(--mk-series-1)")).toBeLessThan(
      html.indexOf("var(--mk-series-2)"),
    );
    expect(html).toMatch(/stroke="var\(--mk-series-1\)"/);
    expect(html).toMatch(/stroke="var\(--mk-series-3\)"/);
    expect(html).toContain('aria-pressed="true"');
  });
});
