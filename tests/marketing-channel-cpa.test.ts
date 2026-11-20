import { describe, expect, it } from "vitest";
import { buildMarketingSummary } from "../lib/marketing";
import {
  campaignChannelSpend,
  itemUnits,
  metaDestinationChannel,
  originChannel,
  productChannelCpa,
  type ChannelOrderGroup,
} from "../lib/marketing-channel-cpa";
import {
  attachChannelMix,
  matchChannelsToOrders,
  rowChannel,
} from "../lib/marketing-channel-orders";
import { marketingPeriod } from "../lib/marketing-dates";
import type { MarketingOriginRow } from "../lib/marketing-attribution";
import type { MarketingControl, RealOrderDay } from "../lib/marketing-real-orders";
import type {
  MarketingAdsData,
  MarketingSources,
} from "../lib/marketing-source-types";
import type { MarketingSettings } from "../lib/marketing-settings-types";
import type { UsdRate } from "../lib/marketing-charlie-types";
import type { OrderProfitabilityRow } from "../lib/finance-orders";

const now = new Date("2026-11-20T18:00:00Z");
const fx: UsdRate = {
  rate: 500,
  date: "2026-11-20",
  source: "hacienda",
  checkedAt: now.toISOString(),
  message: "",
  pen: { rate: 4, date: "2026-11-20", source: "bcrp" },
};

const order = (
  key: string,
  date: string,
  items: Array<{ sku: string; title: string; quantity: number }>,
  status = "pending",
): OrderProfitabilityRow =>
  ({
    order_key: key,
    order_name: key,
    guide_number: "",
    created_at: `${date}T16:00:00Z`,
    tracking_status: status,
    items: items.map((i) => ({ ...i, price: 1000 })),
    settlement_count: 0,
    missing_cost_skus: [],
  }) as unknown as OrderProfitabilityRow;

const row = (
  name: string,
  extra: Partial<MarketingOriginRow> = {},
): MarketingOriginRow => ({
  icomfly_order_id: name,
  order_number: null,
  shopify_display_number: name,
  store_web_seq: null,
  tracking_number: null,
  ad_origin: null,
  originSource: "icomfly",
  ...extra,
});

describe("canal de cada origen", () => {
  it("WhatsApp = bot + asesora; Landing = formulario, carrito y Shopify", () => {
    expect(originChannel("bot")).toBe("whatsapp");
    expect(originChannel("asesora")).toBe("whatsapp");
    expect(originChannel("formulario")).toBe("landing");
    expect(originChannel("carrito")).toBe("landing");
    expect(originChannel("shopify")).toBe("landing");
    // A MANUAL order without creator was typed by the team.
    expect(originChannel("formulario", "MANUAL-123")).toBe("whatsapp");
    expect(originChannel("formulario", "#1234")).toBe("landing");
  });
  it("classifies iComfly rows by label, channel, creator and order number", () => {
    const base = { shopify_display_number: null };
    expect(
      rowChannel(
        row("a", { ...base, labels: [{ id: 1, name: "Venta por bot" }] }),
      ),
    ).toBe("whatsapp");
    expect(rowChannel(row("a", { ...base, sales_channel: "whatsapp" }))).toBe(
      "whatsapp",
    );
    expect(rowChannel(row("a", { ...base, creator: "Conector IA" }))).toBe(
      "whatsapp",
    );
    expect(rowChannel(row("a", { ...base, creator: "Leonor" }))).toBe(
      "whatsapp",
    );
    expect(
      rowChannel(
        row("a", {
          ...base,
          labels: [{ name: "Carrito abandonado recuperado" }],
          creator: "Leonor",
        }),
      ),
    ).toBe("landing");
    expect(rowChannel(row("a", { ...base, order_number: "#55" }))).toBe(
      "landing",
    );
    expect(
      rowChannel(row("a", { ...base, order_number: "MANUAL-9" })),
    ).toBe("whatsapp");
    expect(rowChannel(row("#1001"))).toBe("landing");
    expect(rowChannel(row("#1001", { originSource: "shopify_saved" }))).toBe(
      "landing",
    );
  });
  it("Meta destinations: only WhatsApp destinations are WhatsApp", () => {
    expect(metaDestinationChannel("WHATSAPP")).toBe("whatsapp");
    expect(metaDestinationChannel("MESSAGING_MESSENGER_WHATSAPP")).toBe(
      "whatsapp",
    );
    for (const value of [
      "WEBSITE",
      "UNDEFINED",
      "MESSENGER",
      "INSTAGRAM_DIRECT",
      "ON_AD",
      "",
      null,
    ])
      expect(metaDestinationChannel(value)).toBe("landing");
  });
});

describe("unidades", () => {
  it("uses the item quantity, and the 'Nx' of the name as fallback", () => {
    expect(itemUnits({ quantity: 3, title: "Fat Burn" })).toBe(3);
    expect(itemUnits({ quantity: 1, title: "2x Fat Burn" })).toBe(2);
    expect(itemUnits({ quantity: null, title: "1x A, 2x B" })).toBe(3);
    expect(itemUnits({ quantity: 0, title: "Shilajit" })).toBe(1);
    expect(itemUnits({ quantity: 2, title: "3x Shilajit" })).toBe(2);
  });
});

describe("reparto del gasto por canal", () => {
  const daily = [
    { date: "2026-11-18", spend: 30, impressions: 0, clicks: 0, purchases: 0 },
    { date: "2026-11-19", spend: 10, impressions: 0, clicks: 0, purchases: 0 },
    { date: "2026-11-10", spend: 99, impressions: 0, clicks: 0, purchases: 0 },
  ];
  it("splits each day by the share of its ad sets", () => {
    expect(
      campaignChannelSpend(
        {
          daily,
          channelSpend: [
            { date: "2026-11-18", whatsapp: 10, landing: 20 },
            { date: "2026-11-19", whatsapp: 0, landing: 5 },
          ],
        },
        "meta",
        "2026-11-18",
        "2026-11-19",
      ),
    ).toEqual({ total: 40, landing: 30, whatsapp: 10, unknown: 0 });
  });
  it("TikTok is all Landing", () => {
    expect(
      campaignChannelSpend({ daily }, "tiktok", "2026-11-18", "2026-11-19"),
    ).toEqual({ total: 40, landing: 40, whatsapp: 0, unknown: 0 });
  });
  it("missing destinations leave the spend without split", () => {
    expect(
      campaignChannelSpend({ daily }, "meta", "2026-11-18", "2026-11-19"),
    ).toEqual({ total: 40, landing: 0, whatsapp: 0, unknown: 40 });
    expect(
      campaignChannelSpend(
        {
          daily,
          channelSpend: [{ date: "2026-11-18", whatsapp: 30, landing: 0 }],
        },
        "meta",
        "2026-11-18",
        "2026-11-19",
      ),
    ).toEqual({ total: 40, landing: 0, whatsapp: 30, unknown: 10 });
    expect(
      campaignChannelSpend({}, "meta", "2026-11-18", "2026-11-19"),
    ).toBeNull();
  });
});

describe("pedidos reales por canal", () => {
  const period = marketingPeriod("2026-11-18", "2026-11-19")!;
  const orders = [
    order("#1", "2026-11-18", [{ sku: "A", title: "Fat Burn", quantity: 2 }]),
    order("IC-50", "2026-11-18", [
      { sku: "A", title: "Fat Burn", quantity: 1 },
      { sku: "B", title: "Shilajit", quantity: 1 },
    ]),
    order("IC-51", "2026-11-19", [{ sku: "B", title: "Shilajit", quantity: 3 }]),
    order(
      "IC-52",
      "2026-11-19",
      [{ sku: "A", title: "Fat Burn", quantity: 5 }],
      "annulled",
    ),
    order("#2", "2026-11-19", [{ sku: "A", title: "Fat Burn", quantity: 1 }]),
  ];
  const rows = [
    row("#1"),
    row("IC-50", {
      shopify_display_number: null,
      order_number: "50",
      sales_channel: "whatsapp",
    }),
    row("IC-51", {
      shopify_display_number: null,
      icomfly_order_id: "51",
      order_number: "MANUAL-51",
      creator: "Leonor",
    }),
    row("IC-52", {
      shopify_display_number: null,
      order_number: "52",
      sales_channel: "whatsapp",
    }),
  ];
  const days = (): RealOrderDay[] =>
    ["2026-11-18", "2026-11-19"].map((date) => ({
      date,
      created: 0,
      real: 0,
      withCampaign: 0,
      byCampaign: {},
      byAd: {},
      unlinkedBySku: {},
      unlinkedNoProduct: 0,
    }));
  it("matches orders to iComfly rows and groups real orders anonymously", () => {
    const channels = matchChannelsToOrders(orders, rows);
    expect(channels.get("#1")).toBe("landing");
    expect(channels.get("IC-50")).toBe("whatsapp");
    expect(channels.get("IC-51")).toBe("whatsapp");
    expect(channels.has("#2")).toBe(false);
    const mixed = attachChannelMix(days(), orders, channels, period, now);
    expect(mixed[0].mix).toEqual(
      expect.arrayContaining<ChannelOrderGroup>([
        ["landing", [["sku:a", 2]], 1],
        [
          "whatsapp",
          [
            ["sku:a", 1],
            ["sku:b", 1],
          ],
          1,
        ],
      ]),
    );
    // Annulled IC-52 is excluded; #2 has no iComfly row → unknown.
    expect(mixed[1].mix).toEqual(
      expect.arrayContaining<ChannelOrderGroup>([
        ["whatsapp", [["sku:b", 3]], 1],
        ["unknown", [["sku:a", 1]], 1],
      ]),
    );
    expect(mixed[1].mix).toHaveLength(2);
  });
  it("upsell replacements keep the channel of the original order", () => {
    const channels = matchChannelsToOrders(orders, [
      row("IC-50", {
        shopify_display_number: null,
        order_number: "50",
        creator: "Leonor",
      }),
      row("IC-50", { originSource: "upsell_original" }),
    ]);
    expect(channels.get("IC-50")).toBe("landing");
  });
  it("without iComfly rows every order is unknown", () => {
    const mixed = attachChannelMix(days(), orders, null, period, now);
    expect(mixed.flatMap((d) => d.mix!).every((g) => g[0] === "unknown")).toBe(
      true,
    );
  });
});

describe("CPA por producto y canal", () => {
  const period = { from: "2026-11-18", to: "2026-11-19" };
  const summaryOrders = [
    order("#1", "2026-11-18", [{ sku: "A", title: "Fat Burn", quantity: 1 }]),
    order("IC-2", "2026-11-18", [{ sku: "B", title: "Shilajit", quantity: 1 }]),
  ];
  const summary = buildMarketingSummary({
    orders: summaryOrders,
    expenses: [],
    from: period.from,
    to: period.to,
    now,
  });
  const keyA = summary.products.find((p) => p.sku === "A")!.key;
  const keyB = summary.products.find((p) => p.sku === "B")!.key;
  const meta = (
    campaigns: MarketingAdsData["campaigns"],
  ): MarketingAdsData => ({
    accountId: "1",
    currency: "USD",
    timezone: "America/Costa_Rica",
    campaigns,
    channels: "ok",
  });
  const day = (date: string, spend: number) => ({
    date,
    spend,
    impressions: 0,
    clicks: 0,
    purchases: 0,
  });
  const sources = (
    campaigns: MarketingAdsData["campaigns"],
    tiktokSpend = 0,
  ): MarketingSources => ({
    meta: {
      status: "ready",
      checkedAt: "",
      message: "",
      data: { accounts: [meta(campaigns)] },
    },
    tiktok: {
      status: "ready",
      checkedAt: "",
      message: "",
      data: {
        accounts: [
          {
            accountId: "2",
            currency: "USD",
            timezone: "America/Costa_Rica",
            campaigns: tiktokSpend
              ? [
                  {
                    id: "t",
                    name: "TT",
                    spend: tiktokSpend,
                    impressions: 0,
                    clicks: 0,
                    daily: [day("2026-11-19", tiktokSpend)],
                  },
                ]
              : [],
          },
        ],
      },
    },
    shiphero: { status: "pending", checkedAt: "", message: "", data: null },
  });
  const campaign = (
    id: string,
    split: Array<{ date: string; whatsapp: number; landing: number }> | null,
  ) => ({
    id,
    name: id,
    spend: 60,
    impressions: 0,
    clicks: 0,
    daily: [day("2026-11-18", 40), day("2026-11-19", 20)],
    ...(split ? { channelSpend: split } : {}),
  });
  const settings: MarketingSettings = {
    plans: [],
    mappings: [
      ["meta", "1", "fat", keyA],
      ["meta", "1", "shi", keyB],
      ["tiktok", "2", "t", keyA],
    ].map(([platform, account, id, key]) => ({
      platform: platform as "meta" | "tiktok",
      account_id: account,
      campaign_id: id,
      product_key: key,
      product_name: "x",
      sku: "",
    })),
  };
  const control = (
    mix: Record<string, ChannelOrderGroup[]>,
  ): MarketingControl => ({
    from: period.from,
    to: period.to,
    today: "2026-11-20",
    generatedAt: now.toISOString(),
    origins: "ok",
    pace: null,
    days: [period.from, period.to].map((date) => ({
      date,
      created: 0,
      real: (mix[date] ?? []).reduce((n, g) => n + g[2], 0),
      withCampaign: 0,
      byCampaign: {},
      byAd: {},
      unlinkedBySku: {},
      unlinkedNoProduct: 0,
      mix: mix[date] ?? [],
    })),
  });
  const mix = {
    "2026-11-18": [
      ["landing", [[keyA, 2]], 3],
      ["whatsapp", [[keyA, 1]], 1],
      ["whatsapp", [[keyB, 1]], 2],
    ] as ChannelOrderGroup[],
    "2026-11-19": [
      [
        "landing",
        [
          [keyA, 1],
          [keyB, 2],
        ],
        1,
      ],
    ] as ChannelOrderGroup[],
  };
  const report = (
    s: MarketingSources,
    c: MarketingControl | null = control(mix),
  ) =>
    productChannelCpa({
      summary,
      sources: s,
      settings,
      control: c,
      fx,
      ...period,
    });

  it("computes spend, real orders, units and both CPAs per product and channel", () => {
    const result = report(
      sources(
        [
          campaign("fat", [
            { date: "2026-11-18", whatsapp: 10, landing: 30 },
            { date: "2026-11-19", whatsapp: 0, landing: 20 },
          ]),
          campaign("shi", [
            { date: "2026-11-18", whatsapp: 40, landing: 0 },
            { date: "2026-11-19", whatsapp: 5, landing: 15 },
          ]),
        ],
        12,
      ),
    );
    const a = result.rows.find((r) => r.key === keyA)!;
    // Meta 60 (10 WhatsApp) + TikTok 12 as Landing.
    expect(a.total).toEqual({
      spend: 72,
      orders: 5,
      units: 8,
      cpaOrder: 72 / 5,
      cpaUnit: 9,
    });
    expect(a.landing).toMatchObject({ spend: 62, orders: 4, units: 7 });
    expect(a.landing.cpaOrder).toBeCloseTo(15.5);
    expect(a.whatsapp).toMatchObject({
      spend: 10,
      orders: 1,
      units: 1,
      cpaOrder: 10,
      cpaUnit: 10,
    });
    expect(a.split).toBe("ok");
    expect(a.partial).toBe(false);
    const b = result.rows.find((r) => r.key === keyB)!;
    expect(b.whatsapp).toMatchObject({ spend: 45, orders: 2, units: 2 });
    expect(b.landing).toMatchObject({ spend: 15, orders: 1, units: 2 });
    // Totals: every campaign over every real order (an order counts once).
    expect(result.totals.total).toMatchObject({
      spend: 132,
      orders: 7,
      units: 12,
    });
    expect(result.totals.whatsapp).toMatchObject({ spend: 55, orders: 3 });
    expect(result.spendChannel).toBe("ok");
    expect(result.ordersChannel).toBe("ok");
  });

  it("CPA is null with 0 orders and no cost is invented", () => {
    const result = report(
      sources([
        campaign("fat", [
          { date: "2026-11-18", whatsapp: 10, landing: 30 },
          { date: "2026-11-19", whatsapp: 0, landing: 20 },
        ]),
      ]),
      control({ "2026-11-18": [["landing", [[keyA, 1]], 1]] }),
    );
    const a = result.rows.find((r) => r.key === keyA)!;
    expect(a.whatsapp).toEqual({
      spend: 10,
      orders: 0,
      units: 0,
      cpaOrder: null,
      cpaUnit: null,
    });
  });

  it("missing destinations: totals stay, channel spend is unavailable", () => {
    const s = sources([campaign("fat", null), campaign("shi", null)]);
    s.meta.data!.accounts[0].channels = "unavailable";
    const result = report(s);
    const a = result.rows.find((r) => r.key === keyA)!;
    expect(a.total.spend).toBe(60);
    expect(a.total.cpaOrder).toBe(12);
    expect(a.landing.spend).toBeNull();
    expect(a.landing.cpaOrder).toBeNull();
    expect(a.landing.orders).toBe(4);
    expect(a.split).toBe("partial");
    expect(result.spendChannel).toBe("unavailable");
  });

  it("orders without channel mark the split partial; no iComfly marks it unavailable", () => {
    const partial = report(
      sources([campaign("fat", [{ date: "2026-11-18", whatsapp: 0, landing: 1 }])]),
      control({
        "2026-11-18": [
          ["landing", [[keyA, 1]], 1],
          ["unknown", [[keyA, 1]], 1],
        ],
      }),
    );
    expect(partial.ordersChannel).toBe("partial");
    expect(partial.unknownOrders).toBe(1);
    const a = partial.rows.find((r) => r.key === keyA)!;
    expect(a.total.orders).toBe(2);
    expect(a.split).toBe("partial");
    const none = report(
      sources([campaign("fat", null)]),
      control({ "2026-11-18": [["unknown", [[keyA, 1]], 2]] }),
    );
    expect(none.ordersChannel).toBe("unavailable");
    const row = none.rows.find((r) => r.key === keyA)!;
    expect(row.split).toBe("unavailable");
    expect(row.landing.orders).toBeNull();
    expect(row.total.orders).toBe(2);
  });

  it("a control that does not cover the range gives no orders (never guessed)", () => {
    const result = report(sources([]), {
      ...control(mix),
      from: "2026-11-19",
    });
    expect(result.ordersChannel).toBe("unavailable");
    expect(result.totals.total.orders).toBeNull();
  });

  it("unassigned spending campaigns make the products partial", () => {
    const result = report(
      sources([
        campaign("fat", [{ date: "2026-11-18", whatsapp: 0, landing: 40 }]),
        campaign("otra", [{ date: "2026-11-18", whatsapp: 0, landing: 40 }]),
      ]),
    );
    expect(result.rows.find((r) => r.key === keyA)!.partial).toBe(true);
  });
});
