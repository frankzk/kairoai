import { describe, expect, it } from "vitest";
import {
  channelOrders,
  estimateAdRealOrders,
  estimateCampaignRealOrders,
  mappingMemberKeys,
  realCpa,
  sumWindow,
  type SpendRow,
} from "../lib/marketing-real-cpa";
import type { RealOrderDay } from "../lib/marketing-real-orders";
import type { MarketingFamily } from "../lib/marketing-product-families";
import { campaignKey } from "../lib/marketing-settings-types";

const day = (
  date: string,
  patch: Partial<RealOrderDay> = {},
): RealOrderDay => ({
  date,
  created: 0,
  real: 0,
  withCampaign: 0,
  byCampaign: {},
  byAd: {},
  unlinkedBySku: {},
  unlinkedNoProduct: 0,
  ...patch,
});
const spend = (
  campaignId: string,
  date: string,
  spendUsd: number | null,
  platform: "meta" | "tiktok" = "meta",
): SpendRow => ({ platform, accountId: "1", campaignId, date, spendUsd });
const key = (id: string, platform: "meta" | "tiktok" = "meta") =>
  campaignKey(platform, "1", id);
const D = "2026-11-03";

describe("CPA real", () => {
  it("divides spend by real orders and keeps the created CPA as reference", () => {
    const value = realCpa(967.68, 128, 18);
    expect(value.real).toBe(110);
    expect(value.cpaCreated).toBeCloseTo(7.56, 2);
    expect(value.cpaReal).toBeCloseTo(8.8, 2);
    expect(realCpa(50, 3, 3)).toEqual({
      real: 0,
      cpaReal: null,
      cpaCreated: 50 / 3,
    });
    expect(realCpa(null, 3, 0).cpaReal).toBeNull();
  });
});

describe("pedidos reales por campaña", () => {
  it("splits a product's orders without UTM by the spend of its campaigns", () => {
    const result = estimateCampaignRealOrders({
      days: [day(D, { real: 3, unlinkedBySku: { "sku:mag": 3 } })],
      spend: [spend("a", D, 20), spend("b", D, 10)],
      members: new Map([
        [key("a"), ["sku:mag"]],
        [key("b"), ["sku:mag"]],
      ]),
    });
    expect(result.get(key("a"))!.get(D)).toEqual({
      utm: 0,
      assigned: 2,
      total: 2,
      partial: false,
    });
    expect(result.get(key("b"))!.get(D)!.total).toBe(1);
  });
  it("gives a UTM order to its campaign only", () => {
    const result = estimateCampaignRealOrders({
      days: [day(D, { real: 1, withCampaign: 1, byCampaign: { "meta:a": 1 } })],
      spend: [spend("a", D, 20), spend("b", D, 10)],
      members: new Map([
        [key("a"), ["sku:mag"]],
        [key("b"), ["sku:mag"]],
      ]),
    });
    expect(result.get(key("a"))!.get(D)!.total).toBe(1);
    expect(result.get(key("b"))!.get(D)!.total).toBe(0);
  });
  it("leaves orders undistributed when the product's campaigns spent nothing", () => {
    const result = estimateCampaignRealOrders({
      days: [day(D, { real: 2, unlinkedBySku: { "sku:mag": 2 } })],
      spend: [spend("a", D, 0)],
      members: new Map([[key("a"), ["sku:mag"]]]),
    });
    expect(result.get(key("a"))!.get(D)!.total).toBe(0);
  });
  it("marks TikTok days without spend as unknown and their product partners as partial", () => {
    const result = estimateCampaignRealOrders({
      days: [day(D, { real: 4, unlinkedBySku: { "sku:mag": 4 } })],
      spend: [spend("a", D, 10), spend("t", D, null, "tiktok")],
      members: new Map([
        [key("a"), ["sku:mag"]],
        [key("t", "tiktok"), ["sku:mag"]],
      ]),
    });
    expect(result.get(key("t", "tiktok"))!.get(D)).toMatchObject({
      total: null,
      partial: true,
    });
    expect(result.get(key("a"))!.get(D)).toMatchObject({
      total: 4,
      partial: true,
    });
  });
  it("splits with the latest reported day of a lagging TikTok partner", () => {
    const result = estimateCampaignRealOrders({
      days: [
        day("2026-11-02", { real: 0 }),
        day(D, { real: 4, unlinkedBySku: { "sku:mag": 4 } }),
      ],
      spend: [
        spend("a", D, 10),
        spend("t", "2026-11-02", 30, "tiktok"),
        spend("t", D, null, "tiktok"),
      ],
      members: new Map([
        [key("a"), ["sku:mag"]],
        [key("t", "tiktok"), ["sku:mag"]],
      ]),
    });
    expect(result.get(key("a"))!.get(D)).toEqual({
      utm: 0,
      assigned: 1,
      total: 1,
      partial: false,
      proxied: true,
    });
    expect(result.get(key("t", "tiktok"))!.get(D)!.total).toBeNull();
  });
  it("shares each SKU pool between a family campaign and a variant campaign without double counting", () => {
    const days = [
      day(D, {
        real: 9,
        withCampaign: 1,
        byCampaign: { "meta:all": 1 },
        unlinkedBySku: { "sku:s": 4, "sku:m": 2 },
        unlinkedNoProduct: 1,
      }),
    ];
    const result = estimateCampaignRealOrders({
      days,
      spend: [spend("all", D, 30), spend("s", D, 10), spend("x", D, 50)],
      members: new Map([
        [key("all"), ["sku:s", "sku:m"]],
        [key("s"), ["sku:s"]],
      ]),
    });
    const all = result.get(key("all"))!.get(D)!;
    const s = result.get(key("s"))!.get(D)!;
    expect(all.total).toBe(1 + 3 + 2);
    expect(s.total).toBe(1);
    // Unassigned campaign: UTM only, partial.
    expect(result.get(key("x"))!.get(D)).toMatchObject({
      total: 0,
      partial: true,
    });
    const sum = Array.from(result.values()).reduce(
      (n, dates) => n + (dates.get(D)!.total ?? 0),
      0,
    );
    expect(sum).toBeLessThanOrEqual(days[0].real);
    expect(sum).toBe(7);
  });
  it("sums windows and flags missing days", () => {
    const dates = new Map([
      ["2026-11-01", { utm: 1, assigned: 1, total: 2, partial: false }],
      ["2026-11-02", { utm: 0, assigned: 0.5, total: 0.5, partial: false }],
    ]);
    expect(sumWindow(dates, "2026-11-01", "2026-11-02")).toEqual({
      orders: 2.5,
      utm: 1,
      partial: false,
    });
    expect(sumWindow(dates, "2026-11-01", "2026-11-03").partial).toBe(true);
    expect(sumWindow(undefined, D, D)).toEqual({
      orders: null,
      utm: 0,
      partial: true,
    });
  });
  it("splits the campaign estimate between its ads: UTM first, the rest by ad spend", () => {
    const days = [
      day(D, {
        real: 5,
        withCampaign: 2,
        byCampaign: { "meta:c": 2 },
        byAd: { "meta:ad1": 2 },
        unlinkedBySku: { "sku:mag": 3 },
      }),
    ];
    const campaigns = estimateCampaignRealOrders({
      days,
      spend: [spend("c", D, 30)],
      members: new Map([[key("c"), ["sku:mag"]]]),
    });
    const real = estimateAdRealOrders({
      days,
      campaigns,
      ads: [
        {
          platform: "meta",
          accountId: "1",
          campaignId: "c",
          adId: "ad1",
          date: D,
          spendUsd: 10,
        },
        {
          platform: "meta",
          accountId: "1",
          campaignId: "c",
          adId: "ad2",
          date: D,
          spendUsd: 20,
        },
      ],
    });
    expect(real("meta", "1", "c", "ad1", D)).toEqual({
      orders: 3,
      basis: "estimado",
    });
    expect(real("meta", "1", "c", "ad2", D)).toEqual({
      orders: 2,
      basis: "estimado",
    });
    expect(real("meta", "1", "c", "ad1", "2026-11-04")).toBeNull();
  });
  it("gives no ad estimate for a campaign without product (not 0 real orders)", () => {
    const days = [day(D, { real: 5, unlinkedBySku: { "sku:mag": 5 } })];
    const campaigns = estimateCampaignRealOrders({
      days,
      spend: [spend("u", D, 40)],
      members: new Map(),
    });
    expect(campaigns.get(key("u"))!.get(D)).toMatchObject({
      total: 0,
      partial: true,
      unassigned: true,
    });
    const real = estimateAdRealOrders({
      days,
      campaigns,
      ads: [
        {
          platform: "meta",
          accountId: "1",
          campaignId: "u",
          adId: "77",
          date: D,
          spendUsd: 40,
        },
      ],
    });
    expect(real("meta", "1", "u", "77", D)).toBeNull();
  });
  it("lists the members a mapping sells", () => {
    const families: MarketingFamily[] = [
      {
        key: "family:shopify:1",
        name: "Fat",
        source: "shopify",
        review: false,
        members: [
          { key: "sku:s", sku: "S", name: "S" },
          { key: "sku:m", sku: "M", name: "M" },
        ],
      },
    ];
    const base = {
      platform: "meta" as const,
      account_id: "1",
      campaign_id: "1",
      product_key: "family:shopify:1",
      product_name: "Fat",
      sku: "",
      family_key: "family:shopify:1",
    };
    expect(
      mappingMemberKeys({ ...base, variant_scope: "all" }, families),
    ).toEqual(["sku:s", "sku:m"]);
    expect(
      mappingMemberKeys(
        { ...base, variant_scope: "selected", variant_keys: ["sku:m"] },
        families,
      ),
    ).toEqual(["sku:m"]);
    expect(
      mappingMemberKeys(
        { ...base, product_key: "sku:s", variant_scope: undefined },
        families,
      ),
    ).toEqual(["sku:s"]);
  });
  it("counts channel orders as UTM plus assigned share, and the rest as other", () => {
    const days = [
      day(D, {
        real: 10,
        withCampaign: 3,
        byCampaign: { "meta:a": 2, "tiktok:t": 1 },
        unlinkedBySku: { "sku:mag": 4, "sku:x": 3 },
      }),
    ];
    const estimates = estimateCampaignRealOrders({
      days,
      spend: [spend("a", D, 10), spend("t", D, 10, "tiktok")],
      members: new Map([
        [key("a"), ["sku:mag"]],
        [key("t", "tiktok"), ["sku:mag"]],
      ]),
    });
    expect(channelOrders(days, estimates, D, D)).toMatchObject({
      real: 10,
      withCampaign: 3,
      meta: { total: 4, utm: 2, assigned: 2, missingDates: [] },
      tiktok: { total: 3, utm: 1, assigned: 2 },
      other: 3,
    });
  });
});
