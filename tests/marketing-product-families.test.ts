import { describe, it, expect } from "vitest";
import {
  buildProductFamilies,
  buildGroupMetrics,
  familyTargets,
  selectionTarget,
  baseProductName,
} from "../lib/marketing-product-groups-server";
import {
  matchCampaignProduct,
  effectiveAssignment,
} from "../lib/marketing-product-families";
import { marketingPeriod } from "../lib/marketing-dates";
import { buildMarketingSummary } from "../lib/marketing";
import { productComparison } from "../lib/marketing-team-report";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
import type { MarketingSources } from "../lib/marketing-source-types";

const native = [
  {
    shopify_id: "42",
    title: "Fat-Burn Shorts - Compresión",
    variants: [
      { sku: "FAT.BLACK", title: "Negro" },
      { sku: "FAT.BEIGE", title: "Beige" },
    ],
  },
];
const catalog = [
  {
    key: "sku:fat.black",
    sku: "FAT.BLACK",
    name: "Fat-Burn Shorts - Compresión - Color: Negro",
  },
  {
    key: "sku:old",
    sku: "OLD",
    name: "Fat-Burn Shorts - Compresión - Color: Rojo",
  },
];
const families = buildProductFamilies(catalog, native),
  f = families[0];
const now = new Date("2026-11-04T18:00:00Z"),
  period = marketingPeriod("2026-11-01", "2026-11-04")!;
const orders = [
  {
    created_at: "2026-11-03T14:00:00Z",
    tracking_status: "delivered",
    items: [
      { sku: "FAT.BLACK", title: "Black", quantity: 2 },
      { sku: "FAT.BEIGE", title: "Beige", quantity: 1 },
    ],
  },
  {
    created_at: "2026-11-03T15:00:00Z",
    tracking_status: "pending",
    items: [{ sku: "FAT.BEIGE", title: "Beige", quantity: 1 }],
  },
] as OrderProfitabilityRow[];

describe("Campaign product families", () => {
  it("groups current native variants and historical SKU without repeating products", () => {
    expect(families).toHaveLength(1);
    expect(f.members).toHaveLength(3);
    expect(f.members.find((v) => v.key === "sku:old")?.historical).toBe(true);
    expect(baseProductName("Pack 2 Fat-Burn - Color: Negro")).toBe(
      "Pack 2 Fat-Burn",
    );
    expect(baseProductName("2x Fat-Burn")).toBe("2x Fat-Burn");
    expect(
      baseProductName("Fat-Burn Shorts - Compresión — Beige - Beige"),
    ).toBe("Fat-Burn Shorts - Compresión");
    expect(baseProductName("Fat-Burn Shorts - Compresión (Negro / XXL)")).toBe(
      "Fat-Burn Shorts - Compresión",
    );
    expect(
      baseProductName(
        "Fat-Burn Shorts - Compresión (Negro / XXL) - Negro / XXL",
      ),
    ).toBe("Fat-Burn Shorts - Compresión");
  });
  it("never automatically resolves reused SKU or a duplicate product alias", () => {
    const ambiguous = buildProductFamilies(catalog, [
      ...native,
      { ...native[0], shopify_id: "43" },
    ]);
    expect(matchCampaignProduct("FAT.BLACK", ambiguous).kind).not.toBe("exact");
    expect(matchCampaignProduct("Fat-Burn Shorts", ambiguous).kind).not.toBe(
      "exact",
    );
  });
  it("applies only unique exact aliases or literal SKUs, with campaign wrappers", () => {
    expect(
      matchCampaignProduct("CBO FAT BURN SHORTS | CR", families),
    ).toMatchObject({
      kind: "exact",
      variantKeys: null,
      family: { key: f.key },
    });
    expect(matchCampaignProduct("CBO FAT.BLACK | CR", families)).toMatchObject({
      kind: "exact",
      variantKeys: ["sku:fat.black"],
    });
    expect(matchCampaignProduct("Fat Burn oferta", families).kind).not.toBe(
      "exact",
    );
    expect(matchCampaignProduct("Fat Black", families).kind).not.toBe("exact");
  });
  it("honors manual assignment and an explicit disable-auto override, and waits for settings", () => {
    const manual = {
      platform: "meta" as const,
      account_id: "1",
      campaign_id: "2",
      product_key: "sku:old",
      product_name: "Manual",
      sku: "OLD",
    };
    expect(
      effectiveAssignment(
        manual,
        families,
        "meta",
        "1",
        "2",
        "Fat-Burn Shorts",
        true,
      ),
    ).toBe(manual);
    expect(
      effectiveAssignment(
        { ...manual, variant_scope: "none" },
        families,
        "meta",
        "1",
        "2",
        "Fat-Burn Shorts",
        true,
      ),
    ).toBeNull();
    expect(
      effectiveAssignment(
        undefined,
        families,
        "meta",
        "1",
        "2",
        "Fat-Burn Shorts",
        false,
      ),
    ).toBeNull();
    expect(
      effectiveAssignment(
        undefined,
        families,
        "meta",
        "1",
        "2",
        "Fat-Burn Shorts",
        true,
      )?.automatic,
    ).toBe(true);
  });
  it("validates subsets and gives stable keys regardless of checkbox order", () => {
    expect(selectionTarget(f, ["sku:fat.black", "sku:fat.beige"]).key).toBe(
      selectionTarget(f, ["sku:fat.beige", "sku:fat.black"]).key,
    );
    expect(() => selectionTarget(f, ["sku:foreign"])).toThrow();
    expect(() => selectionTarget(f, [])).toThrow();
    expect(selectionTarget(f, null).memberKeys).toHaveLength(3);
  });
  it("counts a multi-variant order once while retaining units and subset demand", () => {
    const targets = [
      selectionTarget(f, null),
      selectionTarget(f, ["sku:fat.black"]),
      selectionTarget(f, ["sku:fat.black", "sku:fat.beige"]),
    ];
    const rows = buildGroupMetrics(orders, period, targets, now);
    expect(rows[0]).toMatchObject({
      orders: 2,
      units: 4,
      yesterdayOrders: 2,
      sevenDayOrders: 2,
      recentUnits: 4,
    });
    expect(rows[1]).toMatchObject({ orders: 1, units: 2, yesterdayOrders: 1 });
    expect(rows[2]).toMatchObject({ orders: 2, units: 4, yesterdayOrders: 2 });
    expect(rows[0].daily.reduce((sum, d) => sum + d.orders, 0)).toBe(2);
  });
  it("does not reuse an obsolete subset against a changed family", () => {
    expect(
      familyTargets(families, [
        {
          platform: "meta",
          account_id: "1",
          campaign_id: "2",
          product_key: "selection:fake",
          product_name: "x",
          sku: "",
          family_key: f.key,
          variant_scope: "selected",
          variant_keys: ["sku:foreign"],
        },
      ]),
    ).toHaveLength(1);
  });
  it("adds each campaign spend once to the parent, including variant campaigns", () => {
    const summary = {
      ...buildMarketingSummary({
        orders,
        expenses: [],
        from: period.from,
        to: period.to,
        now,
      }),
      productFamilies: families,
      groupedProducts: buildGroupMetrics(
        orders,
        period,
        [selectionTarget(f, null)],
        now,
      ),
    };
    const source: MarketingSources = {
      meta: {
        status: "ready",
        checkedAt: "",
        message: "",
        data: {
          accounts: [
            {
              accountId: "1",
              currency: "USD",
              timezone: "America/Costa_Rica",
              campaigns: [
                {
                  id: "2",
                  name: "Fat-Burn Shorts",
                  spend: 20,
                  clicks: 0,
                  impressions: 0,
                  daily: [
                    {
                      date: "2026-11-03",
                      spend: 20,
                      clicks: 0,
                      impressions: 0,
                      purchases: null,
                    },
                  ],
                },
                {
                  id: "3",
                  name: "FAT.BLACK",
                  spend: 10,
                  clicks: 0,
                  impressions: 0,
                  daily: [
                    {
                      date: "2026-11-03",
                      spend: 10,
                      clicks: 0,
                      impressions: 0,
                      purchases: null,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      tiktok: {
        status: "ready",
        checkedAt: "",
        message: "",
        data: { accounts: [] },
      },
      shiphero: { status: "pending", checkedAt: "", message: "", data: null },
    };
    const row = productComparison(
      summary,
      source,
      { mappings: [], plans: [] },
      null,
      now,
    ).find((p) => p.key === f.key)!;
    expect(row.costs[1]).toMatchObject({ campaignCount: 2, value: 15 });
  });
});
