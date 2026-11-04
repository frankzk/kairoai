import { describe, expect, it, vi } from "vitest";
import { marketingLoadPlan } from "../lib/marketing-loading";
import { getMarketingSources } from "../lib/marketing-sources";
import { marketingPeriod } from "../lib/marketing-dates";
import { buildCharlieRevenue } from "../lib/marketing-charlie-revenue";
import { buildCharlieModel } from "../lib/marketing-charlie";
import type { CharlieSettings } from "../lib/marketing-charlie-types";

const now = new Date("2026-11-04T14:00:00Z"),
  period = marketingPeriod("2026-11-01", "2026-11-04")!;
const env = {
  META_CR_AD_ACCOUNT_IDS: "123",
  META_CR_GRAPH_VERSION: "v26.0",
  META_CR_ACCESS_TOKEN: "private-fixture",
};
const rows = [
  {
    campaign_id: "1",
    campaign_name: "Producto",
    date_start: "2026-10-29",
    spend: "99",
    impressions: "99",
    clicks: "1",
  },
  {
    campaign_id: "1",
    campaign_name: "Producto",
    date_start: "2026-11-01",
    spend: "5",
    impressions: "20",
    clicks: "2",
  },
  {
    campaign_id: "1",
    campaign_name: "Producto",
    date_start: "2026-11-04",
    spend: "7",
    impressions: "30",
    clicks: "3",
  },
];
function provider(data = rows) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.hostname).toBe("graph.facebook.com");
    expect(String(input)).not.toContain(env.META_CR_ACCESS_TOKEN);
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}`,
    });
    if (url.pathname.endsWith("act_123"))
      return Response.json({
        id: "act_123",
        currency: "USD",
        timezone_name: "America/Costa_Rica",
      });
    expect(url.pathname.endsWith("/insights")).toBe(true);
    expect(url.searchParams.get("level")).toBe("campaign");
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(url.searchParams.get("fields")).not.toContain("actions");
    expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({
      since: "2026-10-29",
      until: "2026-11-04",
    });
    return Response.json({ data });
  });
}
describe("Marketing view loading boundaries", () => {
  it("opens the summary without all-ad reports, budgets or product settings", () => {
    expect(marketingLoadPlan("summary")).toMatchObject({
      summary: true,
      sourceScope: "overview",
      settings: false,
      reportScope: null,
    });
    expect(marketingLoadPlan("summary", true).settings).toBe(true);
  });
  it("defers the full creative catalogue to Control and Testing and avoids orders in ad-only views", () => {
    for (const view of ["matrix", "subtraction"] as const)
      expect(marketingLoadPlan(view)).toMatchObject({
        summary: false,
        settings: false,
        reportScope: "ads",
        sourceScope: "basic",
      });
    expect(marketingLoadPlan("structure")).toMatchObject({
      summary: false,
      reportScope: "structure",
      sourceScope: "details",
    });
    expect(marketingLoadPlan("sources")).toMatchObject({
      summary: false,
      settings: false,
      reportScope: null,
    });
    for (const view of ["details", "trends"] as const)
      expect(marketingLoadPlan(view)).toMatchObject({
        summary: true,
        settings: true,
        sourceScope: "details",
      });
  });
});
describe("Lightweight executive Meta query", () => {
  it("uses only account and daily campaign insights, keeping trailing days out of period spend", async () => {
    const fetcher = provider();
    const sources = await getMarketingSources(period, env, fetcher, {
      overview: true,
      now,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sources.meta.status).toBe("ready");
    const account = sources.meta.data!.accounts[0];
    expect(account.campaigns).toEqual([
      { id: "1", name: "Producto", spend: 12, impressions: 50, clicks: 5 },
    ]);
    expect(account.dailySpend).toEqual({
      from: "2026-10-29",
      to: "2026-11-04",
      days: rows.map((row) => ({
        date: row.date_start,
        spend: Number(row.spend),
      })),
    });
    expect(account.budgetMessage).toBeUndefined();
    expect(JSON.stringify(sources)).not.toContain(env.META_CR_ACCESS_TOKEN);
  });
  it("renders the seven-day Meta graph from aggregate data without any ad report", async () => {
    const sources = await getMarketingSources(period, env, provider(), {
      overview: true,
      now,
    });
    // TikTok spend remains available for combined metrics, but is not mislabeled as Meta in the graph.
    sources.tiktok = {
      ...sources.meta,
      data: {
        accounts: [
          {
            accountId: "456",
            currency: "USD",
            timezone: "America/Costa_Rica",
            campaigns: [
              {
                id: "9",
                name: "TikTok",
                spend: 333,
                impressions: 0,
                clicks: 0,
              },
            ],
          },
        ],
      },
    };
    const settings: CharlieSettings = {
      config: { crc_per_usd: null, rate_date: null, hero_product_keys: [] },
      roles: [],
      fx: {
        rate: 500,
        date: "2026-11-04",
        source: "hacienda",
        checkedAt: now.toISOString(),
        message: "",
      },
    };
    const business = buildCharlieRevenue([], new Map(), period, [], now);
    const model = buildCharlieModel(
      { period, totals: { generated: 0, delivered: 0 } },
      business,
      sources,
      null,
      settings,
      "",
      now,
    );
    expect(model.trailing).toHaveLength(7);
    expect(model.trailing.map((row) => row.metaSpendUsd)).toEqual([
      99, 0, 0, 5, 0, 0, 7,
    ]);
    expect(model.spendUsd).toBe(345);
  });
  it("does not turn a missing or duplicated report into known zero spend", async () => {
    const duplicate = await getMarketingSources(
      period,
      env,
      provider([...rows, rows[0]]),
      { overview: true, now },
    );
    expect(duplicate.meta).toMatchObject({ status: "error", data: null });
    const absent = await getMarketingSources(
      period,
      env,
      vi.fn().mockRejectedValue(new Error("provider unavailable")),
      { overview: true, now },
    );
    expect(absent.meta).toMatchObject({ status: "error", data: null });
    const settings: CharlieSettings = {
      config: { crc_per_usd: null, rate_date: null, hero_product_keys: [] },
      roles: [],
      fx: {
        rate: 500,
        date: "2026-11-04",
        source: "hacienda",
        checkedAt: now.toISOString(),
        message: "",
      },
    };
    expect(
      buildCharlieModel(
        { period, totals: { generated: 0, delivered: 0 } },
        buildCharlieRevenue([], new Map(), period, [], now),
        absent,
        null,
        settings,
        "",
        now,
      ).trailing.every((row) => row.metaSpendUsd === null),
    ).toBe(true);
  });
});
