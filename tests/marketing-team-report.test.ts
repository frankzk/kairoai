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
  it("withholds product CPA if any spending campaign is unassigned or assignments are unavailable", () => {
    const s = sources();
    s.meta.data!.accounts[0].campaigns.push({
      ...account("3").campaigns[0],
      id: "unassigned",
    });
    expect(productComparison(summary, s, settings, fx, now)[0].cpas).toEqual([
      null,
      null,
      null,
    ]);
    expect(
      productComparison(summary, sources(), null, fx, now)[0].cpas,
    ).toEqual([null, null, null]);
  });
  it("withholds CPA for incomparable calendars, missing rates and missing daily metrics", () => {
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
      ).toEqual([null, null, null]);
    }
  });
});
