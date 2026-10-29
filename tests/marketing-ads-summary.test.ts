import { describe, expect, it } from "vitest";
import { buildMarketingAdsSummary } from "../lib/marketing-ads-summary";
import type { MarketingAdsData, MarketingSource, MarketingSources } from "../lib/marketing-source-types";

const pending = (): MarketingSource<never> => ({ status: "pending", data: null, checkedAt: "2026-10-29T12:00:00Z", message: "" });
const account = (accountId: string, spend = 10, currency = "USD", timezone = "America/Costa_Rica"): MarketingAdsData => ({
  accountId, currency, timezone, campaigns: [{ id: "same-campaign-id", name: "Campaign", spend, impressions: 100, clicks: 2 }],
});
const ready = (accounts: MarketingAdsData[]) => ({ ...pending(), status: "ready" as const, data: { accounts } });
const sources = (accounts: MarketingAdsData[]): MarketingSources => ({ meta: ready(accounts), tiktok: pending(), shiphero: pending() });

describe("connected advertising summary", () => {
  it("sums all five Meta accounts and divides by created orders, with partial coverage", () => {
    const result = buildMarketingAdsSummary(sources([1, 2, 3, 4, 5].map(id => account(String(id), id * 10))), "2026-10", 30, 10);
    expect(result).toMatchObject({ accountCount: 5, providers: ["Meta"], spend: 150, currency: "USD", costPerGenerated: 5, costPerDelivered: 15, partial: true, aligned: true });
  });

  it("includes TikTok in the same currency and accepts its equivalent timezone", () => {
    const input = sources([account("meta", 20.12)]);
    input.tiktok = ready([account("tiktok", 10.13, "USD", "Etc/GMT+6")]);
    expect(buildMarketingAdsSummary(input, "2026-10", 5, 2)).toMatchObject({ spend: 30.25, costPerGenerated: 6.05, partial: false, aligned: true });
  });

  it("keeps missing or failed reports distinct from a successful zero-spend month", () => {
    expect(buildMarketingAdsSummary(null, "2026-10", 10, 5)).toMatchObject({ spend: null, costPerGenerated: null, accountCount: 0 });
    const input = sources([account("meta", 123)]);
    input.meta.status = "error";
    expect(buildMarketingAdsSummary(input, "2026-10", 10, 5).spend).toBeNull();
    input.meta = ready([{ ...account("meta"), campaigns: [] }]);
    expect(buildMarketingAdsSummary(input, "2026-10", 10, 5)).toMatchObject({ spend: 0, costPerGenerated: 0 });
  });

  it("retains available Meta spend if TikTok fails and never reports complete coverage", () => {
    const input = sources([account("meta", 20)]);
    input.tiktok = { ...pending(), status: "error" };
    expect(buildMarketingAdsSummary(input, "2026-10", 10, 5)).toMatchObject({ spend: 20, costPerGenerated: 2, partial: true });
  });

  it("never adds different currencies or publishes their component spend as a combined CPA", () => {
    const result = buildMarketingAdsSummary(sources([account("usd", 50), account("crc", 5000, "CRC")]), "2026-10", 10, 5);
    expect(result).toMatchObject({ spend: null, currency: null, costPerGenerated: null, costPerDelivered: null });
    expect(result.breakdown).toEqual([{ currency: "USD", spend: 50 }, { currency: "CRC", spend: 5000 }]);
  });

  it.each(["America/Los_Angeles", "unknown", ""]) ("shows spend but withholds CPA for incompatible calendar %s", timezone => {
    expect(buildMarketingAdsSummary(sources([account("meta", 20, "USD", timezone)]), "2026-10", 10, 5)).toMatchObject({ spend: 20, aligned: false, costPerGenerated: null });
  });

  it("does not divide by zero or interpret a missing denominator as zero acquisition cost", () => {
    expect(buildMarketingAdsSummary(sources([account("meta", 20)]), "2026-10", 0, 0)).toMatchObject({ spend: 20, costPerGenerated: null, costPerDelivered: null });
  });
});
