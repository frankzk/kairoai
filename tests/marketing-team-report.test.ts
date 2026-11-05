import { describe, expect, it } from "vitest";
import { buildMarketingSummary } from "../lib/marketing";
import { productComparison, reportChannel } from "../lib/marketing-team-report";
import type {
  MarketingSources,
  MarketingAdsData,
} from "../lib/marketing-source-types";
import type { MarketingSettings } from "../lib/marketing-settings-types";
import type { UsdRate } from "../lib/marketing-charlie-types";
import type { OrderProfitabilityRow } from "../lib/finance-orders";

const now = new Date("2026-11-04T15:00:00Z");
const fx: UsdRate = {
  rate: 500,
  date: "2026-11-04",
  source: "hacienda",
  checkedAt: now.toISOString(),
  message: "",
  pen: { rate: 4, date: "2026-11-04", source: "bcrp" },
};
const account = (id: string, currency = "USD"): MarketingAdsData => ({
  accountId: id,
  currency,
  timezone: "America/Costa_Rica",
  campaigns: [
    {
      id: "9",
      name: "Oferta",
      spend: 28,
      clicks: 100,
      impressions: 1000,
      purchases: 4,
      daily: [
        {
          date: "2026-11-04",
          spend: 8,
          impressions: 100,
          clicks: 5,
          purchases: 1,
        },
        {
          date: "2026-11-03",
          spend: 20,
          impressions: 100,
          clicks: 5,
          purchases: 3,
        },
      ],
    },
  ],
});
function sources(): MarketingSources {
  return {
    meta: {
      status: "ready",
      checkedAt: "",
      message: "",
      data: { accounts: [account("1")] },
    },
    tiktok: {
      status: "ready",
      checkedAt: "",
      message: "",
      data: { accounts: [account("2", "PEN")] },
    },
    shiphero: { status: "pending", checkedAt: "", message: "", data: null },
  };
}
const orders = ["2026-11-04", "2026-11-03"].map(
  (date, i) =>
    ({
      order_key: String(i),
      created_at: `${date}T14:00:00Z`,
      tracking_status: "pending",
      items: [{ sku: "A", title: "Producto", quantity: 1, price: 5000 }],
      settlement_count: 0,
      missing_cost_skus: [],
    }) as unknown as OrderProfitabilityRow,
);
const summary = buildMarketingSummary({
  orders,
  expenses: [],
  from: "2026-11-01",
  to: "2026-11-04",
  now,
});
const settings: MarketingSettings = {
  plans: [],
  mappings: ["1", "2"].map((id, i) => ({
    platform: i ? "tiktok" : "meta",
    account_id: id,
    campaign_id: "9",
    product_key: summary.products[0].key,
    product_name: "Producto",
    sku: "A",
  })),
};

describe("Team report financial integrity", () => {
  it("converts each account before summing, never adding PEN to USD", () => {
    const s = sources();
    s.meta.data!.accounts.push(account("3", "PEN"));
    expect(reportChannel(s, "meta", fx).spend).toBe(35);
    expect(reportChannel(s, "tiktok", fx).spend).toBe(7);
    expect(reportChannel(s, "tiktok", { ...fx, pen: null }).spend).toBeNull();
  });
  it("keeps missing connections unknown and distinguishes generic TikTok conversions from verified purchases", () => {
    const s = sources();
    delete s.tiktok.data!.accounts[0].campaigns[0].purchases;
    expect(reportChannel(s, "tiktok", fx)).toMatchObject({
      purchases: null,
      conversions: 4,
    });
    s.meta.status = "error";
    expect(reportChannel(s, "meta", fx).spend).toBeNull();
  });
  it("matches today, yesterday and seven completed days using mapped campaign spend", () => {
    expect(
      productComparison(summary, sources(), settings, fx, now)[0].cpas,
    ).toEqual([10, 25, 25]);
  });
  it("shows assigned cost as partial while unrelated spending campaigns remain unassigned", () => {
    const s = sources();
    s.meta.data!.accounts[0].campaigns.push({
      ...account("3").campaigns[0],
      id: "unassigned",
    });
    const product = productComparison(summary, s, settings, fx, now)[0];
    expect(product.cpas).toEqual([10, 25, 25]);
    expect(product.costs[0]).toMatchObject({
      partial: true,
      unmapped: 1,
      reason: "Solo pauta asignada, cobertura parcial",
    });
    expect(
      productComparison(summary, sources(), null, fx, now)[0].cpas,
    ).toEqual([null, null, null]);
  });
  it("withholds cost without rates/daily metrics and flags incomparable calendars as orientative", () => {
    for (const change of ["timezone", "daily", "rate"]) {
      const s = sources();
      let rate: UsdRate | null = fx;
      if (change === "timezone")
        s.tiktok.data!.accounts[0].timezone = "America/Lima";
      if (change === "daily")
        delete s.meta.data!.accounts[0].campaigns[0].daily;
      if (change === "rate") rate = null;
      expect(
        productComparison(summary, s, settings, rate, now)[0].cpas,
      ).toEqual(change === "timezone" ? [10, 25, 25] : [null, null, null]);
      if (change === "timezone")
        expect(
          productComparison(summary, s, settings, rate, now)[0].costs[0],
        ).toMatchObject({ approximate: true, partial: false });
    }
  });
  it("does not use data retained by an unavailable source and explains missing assignments", () => {
    const s = sources();
    s.tiktok.status = "error";
    const cost = productComparison(summary, s, settings, fx, now)[0].costs[0];
    expect(cost).toMatchObject({ value: 8, partial: true });
    expect(
      productComparison(summary, s, { mappings: [], plans: [] }, fx, now)[0]
        .costs[0],
    ).toMatchObject({ value: null, reason: "Asigna sus campañas" });
  });
});

it("marks a product cost partial if TikTok has not reported through the end date, without hiding completed-day comparisons", () => {
  const s = sources();
  s.tiktok.data!.accounts[0].campaigns[0].daily!.shift();
  const p = productComparison(summary, s, settings, fx, now)[0];
  expect(p.costs[0]).toMatchObject({
    value: 8,
    partial: true,
    reason: "TikTok no reporta todo el rango",
  });
  expect(p.costs[1]).toMatchObject({ value: 25, partial: false });
});

it("uses real orders (without annulled) and keeps the created CPA as reference", () => {
  const withAnnulled = buildMarketingSummary({
    orders: [
      ...orders,
      {
        ...orders[1],
        order_key: "x",
        tracking_status: "annulled",
      } as OrderProfitabilityRow,
      {
        ...orders[0],
        order_key: "y",
        tracking_status: "annulled",
      } as OrderProfitabilityRow,
    ],
    expenses: [],
    from: "2026-11-01",
    to: "2026-11-04",
    now,
  });
  expect(withAnnulled.products[0]).toMatchObject({
    realOrders: withAnnulled.products[0].orders - 2,
    todayOrders: 2,
    todayReal: 1,
    yesterdayOrders: 2,
    yesterdayReal: 1,
    sevenDayOrders: 2,
    sevenDayReal: 1,
  });
  const p = productComparison(withAnnulled, sources(), settings, fx, now)[0];
  // Today: USD 8 + PEN 8 (= USD 2) over 1 real order, 2 created.
  expect(p.costs[0]).toMatchObject({ value: 10, createdValue: 5 });
  expect(p.cpas).toEqual([10, 25, 25]);
  const allAnnulled = buildMarketingSummary({
    orders: orders.map(
      (o) => ({ ...o, tracking_status: "annulled" }) as OrderProfitabilityRow,
    ),
    expenses: [],
    from: "2026-11-01",
    to: "2026-11-04",
    now,
  });
  expect(
    productComparison(allAnnulled, sources(), settings, fx, now)[0].costs[0],
  ).toMatchObject({
    value: null,
    createdValue: 10,
    reason: "Sin pedidos reales",
    // The spend is kept so "CPA por encima del objetivo" can list it.
    spend: 10,
  });
});
