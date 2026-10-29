import { describe, expect, it, vi } from "vitest";
import {
  marketingDate,
  marketingPeriod,
  presetPeriod,
  previousPeriod,
} from "../lib/marketing-dates";
import { buildMarketingSummary } from "../lib/marketing";
import { buildMarketingIntelligence } from "../lib/marketing-intelligence";
import { readMetaBudgets } from "../lib/marketing-meta-budgets";
import { getMarketingSources } from "../lib/marketing-sources";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
import type { MarketingSources } from "../lib/marketing-source-types";
import type { MarketingSettings } from "../lib/marketing-settings-types";

const now = new Date("2026-10-29T18:00:00Z");
const order = (
  created_at: string,
  patch: Partial<OrderProfitabilityRow> = {},
): OrderProfitabilityRow =>
  ({
    order_key: created_at,
    created_at,
    tracking_status: "pending",
    guide_number: "",
    settlement_count: 0,
    items: [{ sku: "SKU-A", title: "Producto real", quantity: 1, price: 1000 }],
    missing_cost_skus: [],
    amount_to_liquidate: 0,
    product_cost: 0,
    ...patch,
  }) as OrderProfitabilityRow;
const summary = (orders: OrderProfitabilityRow[] = []) =>
  buildMarketingSummary({
    orders,
    expenses: [],
    from: "2026-10-29",
    to: "2026-10-29",
    now,
  });
const pending = {
  status: "pending" as const,
  checkedAt: "",
  data: null,
  message: "",
};
const sources = (): MarketingSources => ({
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
              id: "1",
              name: "Primera",
              spend: 10,
              impressions: 100,
              clicks: 15,
            },
            {
              id: "2",
              name: "Segunda",
              spend: 20,
              impressions: 100,
              clicks: 20,
            },
          ],
        },
      ],
    },
  },
  tiktok: pending,
  shiphero: pending,
});
const settings = (): MarketingSettings => ({
  mappings: ["1", "2"].map((campaign_id) => ({
    platform: "meta",
    account_id: "123",
    campaign_id,
    product_key: "sku:sku-a",
    product_name: "Producto real",
    sku: "SKU-A",
  })),
  plans: [],
});
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200 });

describe("Costa Rica reporting periods", () => {
  it("uses Costa Rica midnight, Monday week starts and calendar month transitions", () => {
    expect(marketingDate(new Date("2026-10-30T05:59:59Z"))).toBe("2026-10-29");
    expect(
      presetPeriod("today", new Date("2026-10-30T05:59:59Z")),
    ).toMatchObject({ from: "2026-10-29", to: "2026-10-29", days: 1 });
    expect(presetPeriod("week", now)).toMatchObject({
      from: "2026-10-26",
      to: "2026-10-29",
    });
    expect(
      presetPeriod("last-month", new Date("2026-01-10T18:00:00Z")),
    ).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetPeriod("7d", now)).toMatchObject({
      from: "2026-10-23",
      to: "2026-10-29",
      days: 7,
    });
  });
  it("rejects impossible, reversed and excessive ranges and compares equal day counts", () => {
    expect(marketingPeriod("2026-02-29", "2026-03-01")).toBeNull();
    expect(marketingPeriod("2026-10-29", "2026-10-28")).toBeNull();
    expect(marketingPeriod("2026-01-01", "2026-12-31")).toBeNull();
    expect(
      previousPeriod(marketingPeriod("2026-10-01", "2026-10-29")!),
    ).toMatchObject({ from: "2026-09-02", to: "2026-09-30", days: 29 });
  });
  it("filters orders at both boundaries and keeps rolling product demand independent of the report", () => {
    const data = summary([
      order("2026-10-29T05:59:59Z"),
      order("2026-10-29T06:00:00Z"),
      order("2026-10-30T06:00:00Z"),
      order("2026-10-28T12:00:00Z", {
        items: [
          { sku: "SKU-A", title: "Producto real", quantity: 3, price: 1 },
        ],
      }),
    ]);
    expect(data.totals.generated).toBe(1);
    expect(data.daily).toMatchObject([{ date: "2026-10-29", generated: 1 }]);
    expect(data.products[0]).toMatchObject({
      orders: 1,
      todayOrders: 1,
      yesterdayOrders: 2,
      recentUnits: 4,
      sevenDayOrders: 2,
      previousOrders: 2,
    });
  });
});
describe("product spend and replenishment", () => {
  it("adds mapped campaign spend once and uses product orders only once per order", () => {
    const data = summary([
      order("2026-10-29T12:00:00Z", {
        items: [
          { sku: "SKU-A", title: "Producto real", quantity: 1, price: 1 },
          { sku: "SKU-A", title: "Producto real", quantity: 2, price: 1 },
        ],
      }),
      order("2026-10-29T13:00:00Z"),
    ]);
    const model = buildMarketingIntelligence(data, sources(), settings());
    expect(model.products[0]).toMatchObject({
      orders: 2,
      units: 4,
      spend: 30,
      cpa: 15,
      campaignCount: 2,
    });
    expect(model.ads.spend).toBe(30);
  });
  it("withholds product spend when assignments fail and never invents stock", () => {
    const model = buildMarketingIntelligence(
      summary([order("2026-10-29T12:00:00Z")]),
      sources(),
      null,
    );
    expect(model.products[0]).toMatchObject({
      spend: null,
      cpa: null,
      available: null,
      coverageDays: null,
      suggestedUnits: null,
    });
    expect(model.unmapped).toEqual([]);
  });
  it("rejects mixed product currencies and mismatched calendars for cost ratios", () => {
    const source = sources();
    source.meta.data!.accounts.push({
      ...source.meta.data!.accounts[0],
      accountId: "456",
      currency: "CRC",
      campaigns: [
        { id: "1", name: "Otro", spend: 5000, clicks: 1, impressions: 5 },
      ],
    });
    const mapping = settings();
    mapping.mappings.push({ ...mapping.mappings[0], account_id: "456" });
    expect(
      buildMarketingIntelligence(
        summary([order("2026-10-29T12:00:00Z")]),
        source,
        mapping,
      ).products[0].cpa,
    ).toBeNull();
    source.meta.data!.accounts = [source.meta.data!.accounts[0]];
    source.meta.data!.accounts[0].timezone = "America/Los_Angeles";
    expect(
      buildMarketingIntelligence(
        summary([order("2026-10-29T12:00:00Z")]),
        source,
        settings(),
      ).products[0].cpa,
    ).toBeNull();
  });
  it("only suggests reviewing scale with complete platform coverage, assignments, enough orders and real stock", () => {
    const data = buildMarketingSummary({
      orders: Array.from({ length: 24 }, (_, i) =>
        order(`2026-10-${22 + (i % 7)}T12:00:00Z`),
      ),
      expenses: [],
      from: "2026-10-22",
      to: "2026-10-29",
      now,
    });
    const source = sources();
    source.shiphero = {
      ...pending,
      status: "ready",
      data: {
        stock: [
          {
            sku: "SKU-A",
            warehouseId: "CR",
            available: 120,
            onHand: 120,
            allocated: 0,
          },
        ],
      },
    };
    expect(
      buildMarketingIntelligence(data, source, settings()).alerts.some(
        (alert) => alert.key.startsWith("scale:"),
      ),
    ).toBe(false);
    source.tiktok = {
      ...pending,
      status: "ready",
      data: {
        accounts: [
          {
            accountId: "789",
            currency: "USD",
            timezone: "America/Costa_Rica",
            campaigns: [],
          },
        ],
      },
    };
    expect(
      buildMarketingIntelligence(data, source, settings()).alerts.some(
        (alert) => alert.key.startsWith("scale:"),
      ),
    ).toBe(true);
    source.shiphero = pending;
    expect(
      buildMarketingIntelligence(data, source, settings()).alerts.some(
        (alert) => alert.key.startsWith("scale:"),
      ),
    ).toBe(false);
  });
  it("plans replenishment using completed-day demand, explicit supplier terms and incoming units", () => {
    const orders = Array.from({ length: 7 }, (_, index) =>
      order(`2026-10-${22 + index}T12:00:00Z`, {
        items: [
          { sku: "SKU-A", title: "Producto real", quantity: 10, price: 1 },
        ],
      }),
    );
    const source = sources();
    source.shiphero = {
      ...pending,
      status: "ready",
      data: {
        stock: [
          {
            sku: "SKU-A",
            warehouseId: "CR",
            onHand: 70,
            available: 40,
            allocated: 30,
          },
        ],
      },
    };
    const mapping = settings();
    mapping.plans.push({
      product_key: "sku:sku-a",
      product_name: "Producto real",
      sku: "SKU-A",
      priority: true,
      supplier: "Proveedor CR",
      lead_days: 5,
      cover_days: 14,
      incoming_units: 20,
    });
    expect(
      buildMarketingIntelligence(summary(orders), source, mapping).products[0],
    ).toMatchObject({
      dailyDemand: 10,
      available: 40,
      coverageDays: 4,
      reorderPoint: 100,
      suggestedUnits: 130,
    });
    source.shiphero.data!.stock.push({ ...source.shiphero.data!.stock[0] });
    expect(
      buildMarketingIntelligence(summary(orders), source, mapping).products[0]
        .suggestedUnits,
    ).toBeNull();
  });
});
describe("daily campaign budgets", () => {
  it("uses campaign budgets or active adsets and never divides a lifetime budget into a fake daily amount", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          data: [
            { id: "1", name: "CBO", daily_budget: "12345" },
            { id: "2", name: "ABO" },
            { id: "3", lifetime_budget: "100000" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            {
              id: "11",
              campaign_id: "2",
              daily_budget: "1100",
              effective_status: "ACTIVE",
            },
            {
              id: "12",
              campaign_id: "2",
              daily_budget: "2200",
              effective_status: "ACTIVE",
            },
            {
              id: "13",
              campaign_id: "2",
              daily_budget: "9900",
              effective_status: "PAUSED",
            },
          ],
        }),
      );
    expect(
      await readMetaBudgets(
        "https://graph.facebook.com/v26.0/act_123",
        "USD",
        {},
        new AbortController().signal,
        fetcher,
      ),
    ).toMatchObject([
      { id: "1", dailyBudget: 123.45, budgetKind: "campaign" },
      { id: "2", dailyBudget: 33, budgetKind: "adsets" },
      { id: "3", dailyBudget: null, budgetKind: "lifetime" },
    ]);
  });
  it("reads dated insights, avoids duplicate purchase action types and retains spend when budgets fail", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/act_123"))
        return json({
          id: "act_123",
          currency: "USD",
          timezone_name: "America/Costa_Rica",
        });
      if (url.pathname.endsWith("/insights")) {
        expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({
          since: "2026-10-28",
          until: "2026-10-29",
        });
        expect(url.searchParams.get("time_increment")).toBe("1");
        return json({
          data: [28, 29].map((day) => ({
            campaign_id: "9",
            campaign_name: "Real",
            date_start: `2026-10-${day}`,
            spend: "7",
            impressions: "100",
            clicks: "10",
            actions: [
              { action_type: "omni_purchase", value: "2" },
              { action_type: "purchase", value: "2" },
            ],
          })),
        });
      }
      return new Response("{}", { status: 403 });
    });
    const result = await getMarketingSources(
      { from: "2026-10-28", to: "2026-10-29" },
      {
        META_CR_AD_ACCOUNT_IDS: "123",
        META_CR_GRAPH_VERSION: "v26.0",
        META_CR_ACCESS_TOKEN: "not-a-real-token",
      },
      fetcher,
      { details: true },
    );
    expect(result.meta.status).toBe("ready");
    expect(result.meta.data?.accounts[0].budgetMessage).toBeTruthy();
    expect(result.meta.data?.accounts[0].campaigns[0]).toMatchObject({
      spend: 14,
      purchases: 4,
      daily: [{ date: "2026-10-28" }, { date: "2026-10-29" }],
    });
  });
});
