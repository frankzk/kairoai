import { describe, expect, it } from "vitest";
import {
  periodIncludesToday,
  periodIsToday,
  periodLabelText,
} from "../lib/marketing-copy";
import { presetPeriod } from "../lib/marketing-dates";

// 7 nov 2026, 10:00 in Costa Rica.
const now = new Date("2026-11-07T16:00:00Z");
const today = "2026-11-07";

describe("periodLabelText", () => {
  it("names the top filter presets as the period, not as today", () => {
    expect(periodLabelText(presetPeriod("today", now), today)).toBe("Hoy");
    expect(periodLabelText(presetPeriod("yesterday", now), today)).toBe("Ayer");
    expect(
      periodLabelText(presetPeriod("yesterday", now), today, { withDate: true }),
    ).toBe("Ayer · 6 nov");
    expect(periodLabelText(presetPeriod("7d", now), today)).toBe("1 al 7 nov");
    expect(periodLabelText({ from: "2026-11-05", to: "2026-11-05" }, today)).toBe(
      "5 nov",
    );
    expect(periodLabelText({ from: "2026-10-28", to: "2026-11-03" }, today)).toBe(
      "28 oct al 3 nov",
    );
  });

  it("knows when a period still includes today", () => {
    const yesterday = presetPeriod("yesterday", now);
    expect(periodIncludesToday(yesterday, today)).toBe(false);
    expect(periodIsToday(yesterday, today)).toBe(false);
    expect(periodIncludesToday(presetPeriod("month", now), today)).toBe(true);
    expect(periodIsToday(presetPeriod("month", now), today)).toBe(false);
    expect(periodIsToday(presetPeriod("today", now), today)).toBe(true);
  });
});
