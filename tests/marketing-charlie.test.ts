import { describe, expect, it, vi } from "vitest";
import { marketingPeriod } from "../lib/marketing-dates";
import { buildCharlieRevenue } from "../lib/marketing-charlie-revenue";
import {
  buildCharlieModel,
  detectAdsetRole,
  funnelHint,
} from "../lib/marketing-charlie";
import { getMarketingUsdRate, asUsd } from "../lib/marketing-usd-rate";
import type { MarketingSources } from "../lib/marketing-source-types";
import type {
  CharlieReport,
  CharlieSettings,
  CharlieAd,
  CharlieDay,
} from "../lib/marketing-charlie-types";
import type { OrderProfitabilityRow } from "../lib/finance-orders";

const period = marketingPeriod("2026-10-28", "2026-10-29")!,
  now = new Date("2026-10-29T20:00:00Z");
const order = (
  key: string,
  time: string,
  patch: Partial<OrderProfitabilityRow> = {},
): OrderProfitabilityRow =>
  ({
    order_key: key,
    created_at: time,
    order_value: 5000,
    tracking_status: "pending",
    delivered_on: null,
    items: [{ sku: "A", title: "Oferta real", quantity: 1, price: 5000 }],
    ...patch,
  }) as OrderProfitabilityRow;
const pending = {
  status: "pending" as const,
  data: null,
  message: "",
  checkedAt: "",
};
const settings = (): CharlieSettings => ({
  config: { crc_per_usd: null, rate_date: null, hero_product_keys: [] },
  roles: [],
  fx: {
    rate: 500,
    date: "2026-10-29",
    source: "hacienda",
    checkedAt: now.toISOString(),
    message: "",
  },
});
const sources = (spend = 8): MarketingSources => ({
  meta: {
    ...pending,
    status: "ready",
    data: {
      accounts: [
        {
          accountId: "123",
          currency: "USD",
          timezone: "America/Costa_Rica",
          campaigns: [
            {
              id: "9",
              name: "CBO real",
              spend,
              impressions: 100,
              clicks: 10,
              dailyBudget: 20,
              budgetKind: "campaign",
            },
          ],
        },
      ],
    },
  },
  tiktok: pending,
  shiphero: pending,
});
const day = (patch: Partial<CharlieDay> = {}): CharlieDay => ({
  date: "2026-10-28",
  spend: 10,
  impressions: 1000,
  clicks: 20,
  frequency: 1.1,
  purchases: 2,
  purchaseValue: 40,
  interactions: 5,
  ...patch,
});
const ad = (id: string, daily: CharlieDay[]): CharlieAd => ({
  id,
  name: `Anuncio ${id}`,
  adsetId: "11",
  campaignId: "9",
  effectiveStatus: "ACTIVE",
  postId: `55_${id}`,
  creativeId: id,
  assets: null,
  daily,
});
const report = (ads: CharlieAd[]): CharlieReport => ({
  ...pending,
  status: "ready",
  data: {
    accounts: [
      {
        id: "123",
        name: "Costa Rica",
        currency: "USD",
        timezone: "America/Costa_Rica",
        ads,
        adsets: [
          {
            id: "11",
            name: "Testing | 3:2:2",
            campaignId: "9",
            dynamic: true,
            effectiveStatus: "ACTIVE",
          },
        ],
      },
    ],
    from: period.from,
    to: period.to,
    trailFrom: "2026-10-23",
    trailTo: period.to,
  },
});
const summary = { period, totals: { generated: 2, delivered: 0 } };

describe("Charlie financial decision engine", () => {
  it("converts created order value to USD and keeps potential metrics separate from net profit", () => {
    const business = buildCharlieRevenue(
      [order("a", "2026-10-28T12:00:00Z"), order("b", "2026-10-29T12:00:00Z")],
      new Map(),
      period,
      [],
      now,
    );
    const model = buildCharlieModel(
      summary,
      business,
      sources(),
      null,
      settings(),
      "",
      now,
    );
    expect(model).toMatchObject({
      revenueUsd: 20,
      spendUsd: 8,
      totalOrders: 2,
      aov: 10,
      cpa: 4,
      gpt: 6,
      profitVolume: 12,
      headroom: 4.5,
      decision: "incomplete",
    });
    expect(model.coverage.partial).toBe(true);
  });
  it("withholds mixed-currency arithmetic when the reference or revenue is unavailable", () => {
    const business = buildCharlieRevenue(
        [order("a", "2026-10-28T12:00:00Z")],
        new Map(),
        period,
        [],
        now,
      ),
      config = settings();
    config.fx.rate = null;
    expect(
      buildCharlieModel(summary, business, sources(), null, config, "", now),
    ).toMatchObject({
      revenueUsd: null,
      cpa: 8,
      gpt: null,
      profitVolume: null,
    });
    expect(asUsd(100, "EUR", config.fx)).toBeNull();
    expect(asUsd(5000, "CRC", settings().fx)).toBe(10);
  });
  it("never invents zero CPA or full headroom without orders", () => {
    const business = buildCharlieRevenue([], new Map(), period, [], now);
    expect(
      buildCharlieModel(
        summary,
        business,
        sources(),
        null,
        settings(),
        "",
        now,
      ),
    ).toMatchObject({
      cpa: null,
      gpt: null,
      headroom: null,
      profitVolume: -8,
      decision: "blocked",
    });
  });
  it("does not assign a financial value to missing or negative order totals", () => {
    const business = buildCharlieRevenue(
      [order("a", "2026-10-28T12:00:00Z", { order_value: -1 })],
      new Map(),
      period,
      [],
      now,
    );
    expect(business).toMatchObject({ revenueCrc: null, missingValues: 1 });
    expect(
      buildCharlieModel(summary, business, sources(), null, settings(), "", now)
        .profitVolume,
    ).toBeNull();
  });
  it("deduplicates recurring and Hero Offer revenue and avoids using a later delivery as prior purchase", () => {
    const orders = [
      order("prior", "2026-10-01T12:00:00Z", {
        tracking_status: "delivered",
        delivered_on: "2026-10-05",
      }),
      order("a", "2026-10-28T12:00:00Z"),
      order("b", "2026-10-29T12:00:00Z"),
    ];
    const phones = new Map([
      ["prior", "+506 8888 1234"],
      ["a", "88881234"],
      ["b", "99991234"],
    ]);
    expect(
      buildCharlieRevenue(orders, phones, period, ["sku:a"], now),
    ).toMatchObject({
      revenueCrc: 10000,
      recurringRevenueCrc: 5000,
      recurringOrders: 1,
      heroRevenueCrc: 10000,
      floorRevenueCrc: 10000,
      identityCoverage: 1,
    });
    orders[0].delivered_on = "2026-10-29";
    expect(
      buildCharlieRevenue(orders, phones, period, [], now).recurringOrders,
    ).toBe(0);
    expect(
      JSON.stringify(buildCharlieRevenue(orders, phones, period, [], now)),
    ).not.toContain("88881234");
  });
  it("keeps the recurring floor pending without customer identifiers and the Hero Offer undefined", () => {
    expect(
      buildCharlieRevenue(
        [order("a", "2026-10-28T12:00:00Z")],
        new Map(),
        period,
        [],
        now,
      ),
    ).toMatchObject({
      recurringRevenueCrc: null,
      heroRevenueCrc: null,
      floorRevenueCrc: null,
      identityCoverage: 0,
    });
  });
});
describe("daily 4Pi diagnostics and subtraction", () => {
  it("uses the exact selected day's frequency and calculates CPM from period totals", () => {
    const input = report([
      ad("1", [
        day({ date: "2026-10-28", frequency: 1.1 }),
        day({ date: "2026-10-29", frequency: 1.8, impressions: 2000 }),
      ]),
    ]);
    const model = buildCharlieModel(
      summary,
      null,
      sources(),
      input,
      settings(),
      "2026-10-29",
      now,
    );
    expect(model.ads[0]).toMatchObject({
      frequency: 1.8,
      spendUsd: 20,
      cpm: (20 / 3000) * 1000,
    });
    expect(model.ads[0].frequency).not.toBe(1.45);
    expect(funnelHint(null)).toBe("Sin frecuencia");
    expect(funnelHint(1.22)).toBe("Intermedio");
  });
  it("uses account-day spend shares and weighted GPT, not an average of ad averages", () => {
    const input = report([
      ad("1", [day({ spend: 10, purchases: 0, purchaseValue: 0 })]),
      ad("2", [day({ spend: 20, purchases: 2, purchaseValue: 40 })]),
      ad("3", [day({ spend: 30, purchases: 3, purchaseValue: 90 })]),
    ]);
    const model = buildCharlieModel(
      summary,
      null,
      sources(),
      input,
      settings(),
      "2026-10-28",
      now,
    );
    expect(model.ads.find((ad) => ad.id === "2")).toMatchObject({
      accountAverageGpt: 14,
      dayGpt: 10,
      passive: true,
    });
    expect(model.ads.find((ad) => ad.id === "1")).toMatchObject({
      cpa: null,
      dayCpa: null,
      gpt: null,
      passive: true,
    });
    expect(model.ads.find((ad) => ad.id === "3")?.passive).toBe(false);
  });
  it("uses manual Control/Testing overrides and never claims a harvested permutation from aggregate ad spend", () => {
    expect(detectAdsetRole("CR | Proven Winners")).toBe("control");
    expect(detectAdsetRole("Test 2 - Shilajit")).toBe("testing");
    expect(detectAdsetRole("Contestación")).toBe("other");
    const input = report([
      {
        ...ad("1", [day({ spend: 100, interactions: 90 })]),
        assets: { creatives: 3, bodies: 2, titles: 2 },
      },
    ]);
    const config = settings();
    config.roles.push({ account_id: "123", adset_id: "11", role: "control" });
    expect(
      buildCharlieModel(summary, null, sources(), input, config, "", now)
        .structure[0],
    ).toMatchObject({
      role: "control",
      detectedRole: "testing",
      pattern322: 1,
      harvestVerified: false,
    });
  });
});
describe("official USD reference", () => {
  it("reads Hacienda's verified sale rate and records its date", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ venta: { fecha: "2026-10-29", valor: 454.82 } }),
        ),
      );
    expect(await getMarketingUsdRate(fetcher, now, false)).toMatchObject({
      rate: 454.82,
      date: "2026-10-29",
      source: "hacienda",
    });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.hacienda.go.cr/indicadores/tc/dolar",
    );
  });
  it.each([
    { fecha: "2026-10-10", valor: 500 },
    { fecha: "2026-10-30", valor: 500 },
    { fecha: "2026-10-29", valor: 0 },
    { fecha: "2026-02-30", valor: 500 },
  ])(
    "does not invent a rate for stale, future or invalid data %j",
    async (venta) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ venta })));
      expect(await getMarketingUsdRate(fetcher, now, false)).toMatchObject({
        rate: null,
        source: "unavailable",
      });
    },
  );
});
