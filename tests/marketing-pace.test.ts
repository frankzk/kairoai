import { describe, expect, it } from "vitest";
import { buildDailyPace, typicalShare } from "../lib/marketing-pace";
import type { MarketingControl } from "../lib/marketing-real-orders";
import type {
  MarketingAdsData,
  MarketingSources,
} from "../lib/marketing-source-types";
import type { UsdRate } from "../lib/marketing-charlie-types";
import { shiftDate } from "../lib/marketing-dates";

const TODAY = "2026-11-05";
const now = new Date("2026-11-05T20:35:00Z"); // 14:35 Costa Rica
const fx: UsdRate = {
  rate: 505,
  date: TODAY,
  source: "hacienda",
  checkedAt: now.toISOString(),
  message: "",
  pen: { rate: 3.5, date: TODAY, source: "bcrp" },
};
const slots = (fill: (slot: number) => number) =>
  Array.from({ length: 96 }, (_, i) => fill(i));
/** 24 orders a day, one every hour (slots 0, 4, …, 92); 21 of them real. */
const historyDay = (date: string) => ({
  date,
  created: slots((i) => (i % 4 === 0 ? 1 : 0)),
  real: slots((i) => (i % 4 === 0 && i < 84 ? 1 : 0)),
});
const control = (historyDays = 7): MarketingControl => {
  const history = Array.from({ length: historyDays }, (_, i) =>
    historyDay(shiftDate(TODAY, i - historyDays)),
  );
  return {
    from: shiftDate(TODAY, -13),
    to: TODAY,
    today: TODAY,
    generatedAt: now.toISOString(),
    origins: "ok",
    days: [],
    pace: {
      slotMinutes: 15,
      days: [
        ...history,
        {
          date: TODAY,
          created: slots((i) => (i === 10 ? 140 : 0)),
          real: slots((i) => (i === 10 ? 124 : 0)),
        },
      ],
    },
  };
};
const hourly = (date: string, hours: number[]) => ({ date, hours });
const meta = (withHourly = true): MarketingAdsData => ({
  accountId: "1",
  currency: "USD",
  timezone: "America/Costa_Rica",
  campaigns: [],
  dailySpend: {
    from: shiftDate(TODAY, -13),
    to: TODAY,
    days: [{ date: TODAY, spend: 640 }],
  },
  ...(withHourly
    ? {
        hourly: {
          from: shiftDate(TODAY, -7),
          to: TODAY,
          days: [
            hourly(
              TODAY,
              Array.from({ length: 24 }, (_, h) => (h < 14 ? 590 / 14 : 0)),
            ),
            ...Array.from({ length: 7 }, (_, i) =>
              hourly(
                shiftDate(TODAY, -1 - i),
                Array.from({ length: 24 }, (_, h) =>
                  i === 0 ? (h < 14 ? 610 / 14 : 0) : 50,
                ),
              ),
            ),
          ],
        },
      }
    : {}),
});
const tiktok = (): MarketingAdsData => ({
  accountId: "7",
  currency: "PEN",
  timezone: "America/Lima",
  campaigns: [
    {
      id: "t1",
      name: "CBO GOMITAS",
      spend: 2000,
      impressions: 0,
      clicks: 0,
      daily: [
        {
          date: "2026-11-02",
          spend: 670,
          impressions: 0,
          clicks: 0,
          purchases: 1,
        },
        {
          date: "2026-11-03",
          spend: 1330,
          impressions: 0,
          clicks: 0,
          purchases: 2,
        },
      ],
    },
  ],
});
const sources = (withHourly = true): MarketingSources => ({
  meta: {
    status: "ready",
    checkedAt: "",
    message: "",
    data: { accounts: [meta(withHourly)] },
  },
  tiktok: {
    status: "ready",
    checkedAt: "",
    message: "",
    data: { accounts: [tiktok()] },
  },
  shiphero: { status: "pending", checkedAt: "", message: "", data: null },
});

describe("hoy · cómo voy", () => {
  it("projects the day with the typical share of past days and real orders after cancellations", () => {
    const pace = buildDailyPace({
      control: control(),
      sources: sources(),
      fx,
      now,
    });
    expect(pace.asOf).toBe("14:35");
    expect(pace.slot).toBe(58);
    expect(pace.orders).toMatchObject({
      created: 140,
      real: 124,
      goal: 200,
      gap: 76,
      typicalShare: 15 / 24,
      projected: { created: 224, real: 196 },
    });
    expect(pace.orders.cancelRate7d).toBeCloseTo(3 / 24, 6);
    expect(pace.orders.progress).toBeCloseTo(0.62, 6);
    // Same time yesterday: 15 created (slots 0…56), 15 real.
    expect(pace.orders.yesterday).toEqual({ created: 15, real: 15 });
    expect(pace.gapSpendAtGoalCpa).toBe(646);
  });
  it("adds TikTok as an estimate from its latest day, scaled to the time of day, and compares Meta at the same hour", () => {
    const pace = buildDailyPace({
      control: control(),
      sources: sources(),
      fx,
      now,
    });
    // Meta's share of the day by 14:35: six days at 50/h and yesterday's
    // day that ended at 14:00.
    const share = (6 * ((14 * 50 + 50 * (35 / 60)) / 1200) + 1) / 7;
    expect(pace.spend.meta).toBe(640);
    expect(pace.spend.tiktokEstimate).toEqual({
      value: 380,
      soFar: expect.closeTo(380 * share, 6),
      fromDate: "2026-11-03",
    });
    expect(pace.spend.total).toBeCloseTo(640 + 380 * share, 6);
    expect(pace.spend.gap).toBeCloseTo(1700 - 640 - 380 * share, 6);
    expect(pace.spend.sameHour).toEqual({
      through: "14:00",
      today: expect.closeTo(590, 6),
      yesterday: expect.closeTo(610, 6),
    });
    expect(pace.spend.notes[0]).toBe(
      "TikTok ≈ estimado con el 3 nov; llega al día siguiente por Make.",
    );
    // Meta share from 6 full days (50/h) plus yesterday's partial day.
    expect(pace.spend.projected).not.toBeNull();
    expect(pace.cpa.real).toBeCloseTo((640 + 380 * share) / 124, 6);
    expect(pace.cpa.created).toBeCloseTo((640 + 380 * share) / 140, 6);
    expect(pace.cpa.goal).toBe(8.5);
  });
  it("uses a linear projection with little history and refuses to project too early", () => {
    const linear = buildDailyPace({
      control: control(2),
      sources: sources(),
      fx,
      now,
    });
    expect(linear.orders.typicalShare).toBeNull();
    // 14:35 is a third of the way into slot 58.
    expect(linear.orders.projected?.created).toBe(
      Math.round(140 / ((58 + 1 / 3) / 96)),
    );
    expect(linear.notes).toContain("Proyección lineal (poco historial)");
    const early = buildDailyPace({
      control: control(),
      sources: sources(),
      fx,
      now: new Date("2026-11-05T07:05:00Z"), // 01:05, slot 4
    });
    // 01:05: slot 0 complete, plus a third of slot 4's order.
    expect(early.orders.typicalShare).toBeCloseTo(4 / 3 / 24, 6);
    expect(early.orders.projected).toBeNull();
    expect(early.notes).toContain("Muy temprano para proyectar.");
    expect(early.cpa.projected).toBeNull();
  });
  it("compares with yesterday up to the same minute, not the end of the current slot", () => {
    const base = control();
    const yesterday = shiftDate(TODAY, -1);
    const days = base.pace!.days.map((d) =>
      d.date === yesterday
        ? {
            ...d,
            // 92 orders before 14:30 and 3 more in 14:30–14:44.
            created: slots((i) => (i === 50 ? 92 : i === 58 ? 3 : 0)),
            real: slots((i) => (i === 50 ? 92 : i === 58 ? 3 : 0)),
          }
        : d,
    );
    const pace = buildDailyPace({
      control: { ...base, pace: { slotMinutes: 15, days } },
      sources: sources(),
      fx,
      now, // 14:35, a third of slot 58
    });
    expect(pace.orders.yesterday).toEqual({ created: 93, real: 93 });
  });
  it("counts only the share of TikTok's day that has passed in the morning", () => {
    const pace = buildDailyPace({
      control: control(),
      sources: sources(false),
      fx,
      now: new Date("2026-11-05T15:00:00Z"), // 09:00, linear share 9/24
    });
    expect(pace.spend.tiktokEstimate?.soFar).toBeCloseTo(380 * (9 / 24), 6);
    expect(pace.spend.total).toBeCloseTo(640 + 380 * (9 / 24), 6);
    expect(pace.spend.projected).toBeCloseTo(640 / (9 / 24) + 380, 6);
  });
  it("needs three days with at least 20 orders for the typical share", () => {
    const full = slots((i) => (i % 4 === 0 ? 1 : 0));
    expect(typicalShare([{ created: full }, { created: full }], 58)).toBeNull();
    expect(
      typicalShare(
        [{ created: full }, { created: full }, { created: full }],
        58,
      ),
    ).toBe(15 / 24);
    expect(
      typicalShare(
        [{ created: full }, { created: full }, { created: slots(() => 0) }],
        58,
      ),
    ).toBeNull();
  });
  it("states missing Meta, missing hourly spend and the first slot", () => {
    const noHourly = buildDailyPace({
      control: control(),
      sources: sources(false),
      fx,
      now,
    });
    expect(noHourly.spend.sameHour).toBeNull();
    expect(noHourly.spend.notes).toContain("Sin gasto por hora");
    const s = sources();
    s.meta.status = "error";
    const noMeta = buildDailyPace({ control: control(), sources: s, fx, now });
    expect(noMeta.spend).toMatchObject({
      meta: null,
      total: null,
      projected: null,
    });
    expect(noMeta.spend.notes).toContain("Gasto de Meta no disponible");
    const first = buildDailyPace({
      control: {
        ...control(),
        pace: {
          slotMinutes: 15,
          days: [historyDay(TODAY)].map((d) => ({
            ...d,
            created: slots(() => 0),
            real: slots(() => 0),
          })),
        },
      },
      sources: sources(),
      fx,
      now: new Date("2026-11-05T06:05:00Z"),
    });
    expect(first.notes).toContain("Sin datos todavía");
  });
});
