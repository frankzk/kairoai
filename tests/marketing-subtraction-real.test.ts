import { describe, expect, it } from "vitest";
import {
  charlieAdSpendRows,
  charlieCampaignSources,
  subtractionRealOrders,
} from "../lib/marketing-subtraction-real";
import { buildCharlieModel } from "../lib/marketing-charlie";
import { marketingPeriod } from "../lib/marketing-dates";
import type {
  CharlieAccount,
  CharlieDay,
  CharlieReport,
  CharlieSettings,
} from "../lib/marketing-charlie-types";
import type {
  MarketingControl,
  RealOrderDay,
} from "../lib/marketing-real-orders";
import type { MarketingFamily } from "../lib/marketing-product-families";
import type { MarketingSettings } from "../lib/marketing-settings-types";

const D = "2026-11-03";
const now = new Date("2026-11-04T14:00:00Z");
const row = (date: string, spend: number, purchases = 0): CharlieDay => ({
  date,
  spend,
  impressions: 100,
  clicks: 5,
  frequency: 1.1,
  purchases,
  purchaseValue: null,
  interactions: 0,
});
const account = (
  id: string,
  ads: Array<{ id: string; campaignId: string; daily: CharlieDay[] }>,
  platform: "meta" | "tiktok" = "meta",
): CharlieAccount => ({
  platform,
  id,
  name: `Cuenta ${id}`,
  currency: "USD",
  timezone: "America/Costa_Rica",
  adsets: [],
  ads: ads.map((ad) => ({
    ...ad,
    name: `Anuncio ${ad.id}`,
    adsetId: "s1",
    campaignName:
      ad.campaignId === "c1"
        ? "CBO Magnesium Complex | CR"
        : "CBO NEOCELL | CR",
    effectiveStatus: "ACTIVE",
    postId: null,
    creativeId: null,
    assets: null,
  })),
});
const report = (accounts: CharlieAccount[]): CharlieReport => ({
  status: "ready",
  checkedAt: now.toISOString(),
  message: "",
  data: { accounts, from: D, to: D, trailFrom: D, trailTo: D },
});
const families: MarketingFamily[] = [
  {
    key: "family:magnesium",
    name: "Magnesium Complex",
    source: "shopify",
    review: false,
    members: [{ key: "sku:mag", sku: "MAG", name: "Magnesium Complex" }],
  },
];
const day = (patch: Partial<RealOrderDay>): RealOrderDay => ({
  date: D,
  created: 0,
  real: 0,
  withCampaign: 0,
  byCampaign: {},
  byAd: {},
  unlinkedBySku: {},
  unlinkedNoProduct: 0,
  ...patch,
});
const control = (days: RealOrderDay[]): MarketingControl => ({
  from: D,
  to: D,
  today: "2026-11-04",
  generatedAt: now.toISOString(),
  origins: "ok",
  days,
  pace: null,
});
const settings: MarketingSettings = {
  mappings: [
    {
      platform: "meta",
      account_id: "1",
      campaign_id: "c1",
      product_key: "family:magnesium",
      product_name: "Magnesium Complex",
      sku: "",
      family_key: "family:magnesium",
      variant_scope: "all",
    },
  ],
  plans: [],
};

describe("sustracción con pedidos reales", () => {
  it("builds campaign daily spend from the ads of the report", () => {
    const sources = charlieCampaignSources(
      report([
        account("1", [
          { id: "a1", campaignId: "c1", daily: [row(D, 6, 1)] },
          { id: "a2", campaignId: "c1", daily: [row(D, 4)] },
        ]),
        account(
          "9",
          [{ id: "t1", campaignId: "c9", daily: [row(D, 3)] }],
          "tiktok",
        ),
      ]),
    )!;
    const campaign = sources.meta.data!.accounts[0].campaigns[0];
    expect(campaign).toMatchObject({
      id: "c1",
      name: "CBO Magnesium Complex | CR",
      spend: 10,
      purchases: 1,
      daily: [{ date: D, spend: 10, purchases: 1 }],
    });
    expect(sources.tiktok.data!.accounts[0].campaigns[0].id).toBe("c9");
    expect(charlieCampaignSources(null)).toBeNull();
  });

  it("gives Magnesium its 3 real orders even when the pixel saw none", () => {
    const ads = report([
      account("1", [
        { id: "a1", campaignId: "c1", daily: [row(D, 20)] },
        { id: "a2", campaignId: "c1", daily: [row(D, 10)] },
      ]),
    ]);
    const real = subtractionRealOrders({
      report: ads,
      sources: null,
      summary: { productFamilies: families },
      settings,
      control: control([day({ real: 3, unlinkedBySku: { "sku:mag": 3 } })]),
      fx: null,
    })!;
    expect(real("meta", "1", "c1", "a1", D)).toEqual({
      orders: 2,
      basis: "estimado",
    });
    expect(real("meta", "1", "c1", "a2", D)!.orders).toBe(1);
    expect(charlieAdSpendRows(ads, null)).toHaveLength(2);

    const fx: CharlieSettings = {
      config: { crc_per_usd: null, rate_date: null, hero_product_keys: [] },
      roles: [],
      fx: {
        rate: 500,
        date: D,
        source: "hacienda",
        checkedAt: now.toISOString(),
        message: "",
      },
    };
    const model = buildCharlieModel(
      {
        period: marketingPeriod(D, D)!,
        totals: { generated: 3, delivered: 0 },
      },
      null,
      null,
      ads,
      fx,
      D,
      now,
      real,
    );
    const first = model.ads.find((ad) => ad.id === "a1")!;
    expect(first.dayRealOrders).toBe(2);
    expect(first.reasons).not.toContain(
      "Gasto diario sin compras reportadas (píxel)",
    );
  });

  it("waits for orders, catalogue and assignments before using real orders", () => {
    const ads = report([
      account("1", [{ id: "a1", campaignId: "c1", daily: [row(D, 5)] }]),
    ]);
    const base = {
      report: ads,
      sources: null,
      summary: { productFamilies: families },
      settings,
      control: control([day({})]),
      fx: null,
    };
    expect(subtractionRealOrders({ ...base, control: null })).toBeNull();
    expect(subtractionRealOrders({ ...base, settings: null })).toBeNull();
    expect(subtractionRealOrders({ ...base, summary: null })).toBeNull();
    expect(
      subtractionRealOrders({
        ...base,
        report: { ...ads, status: "error", data: null },
      }),
    ).toBeNull();
  });
});
