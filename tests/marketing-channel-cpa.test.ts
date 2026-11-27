import { describe, expect, it } from "vitest";
import { buildMarketingSummary } from "../lib/marketing";
import {
  campaignChannelSpend,
  campaignNameSaysWhatsapp,
  filterCpaRows,
  sumCpaSources,
  itemUnits,
  metaDestinationChannel,
  originChannel,
  productChannelCpa,
  saleOriginChannel,
  SALE_CHANNEL_LABEL,
  SALE_CHANNELS,
  SALE_ORIGINS,
  SALE_ORIGIN_LABEL,
  type ChannelCpaRow,
  type ChannelOrderGroup,
} from "../lib/marketing-channel-cpa";
import {
  attachChannelMix,
  matchChannelsToOrders,
  rowChannel,
  rowSaleOrigin,
} from "../lib/marketing-channel-orders";
import { orderSubOrigin } from "../lib/marketing-order-facts";
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

describe("origen dentro del canal", () => {
  const base = {
    shopifyNumber: null,
    labels: [] as string[],
    salesChannel: null,
    creator: null,
  };
  it("WhatsApp: bot, Conector IA, asesora y MANUAL sin creador", () => {
    expect(orderSubOrigin({ ...base, labels: ["Venta por bot"] })).toBe("bot");
    expect(orderSubOrigin({ ...base, labels: ["VENTA POR BOT"] })).toBe("bot");
    expect(orderSubOrigin({ ...base, salesChannel: "WhatsApp" })).toBe("bot");
    expect(orderSubOrigin({ ...base, creator: "Conector IA" })).toBe(
      "conector_ia",
    );
    expect(orderSubOrigin({ ...base, creator: "  conector ia " })).toBe(
      "conector_ia",
    );
    // The bot signals win over the creator, as in `orderOrigin`.
    expect(
      orderSubOrigin({ ...base, salesChannel: "whatsapp", creator: "Conector IA" }),
    ).toBe("bot");
    expect(
      orderSubOrigin({ ...base, labels: ["Venta por bot"], creator: "Leonor" }),
    ).toBe("bot");
    expect(orderSubOrigin({ ...base, creator: "Leonor" })).toBe("asesora");
    expect(
      orderSubOrigin({ ...base, creator: "Leonor", orderNumber: "MANUAL-7" }),
    ).toBe("asesora");
    expect(
      orderSubOrigin({ ...base, creator: "Conector IA", orderNumber: "MANUAL-7" }),
    ).toBe("conector_ia");
    expect(orderSubOrigin({ ...base, orderNumber: "MANUAL-1-ABCDE" })).toBe(
      "manual",
    );
    expect(orderSubOrigin({ ...base, orderNumber: " manual-9" })).toBe(
      "manual",
    );
  });
  it("Página web: formulario, carrito recuperado y Shopify", () => {
    expect(orderSubOrigin(base)).toBe("formulario");
    expect(orderSubOrigin({ ...base, orderNumber: "#1790" })).toBe(
      "formulario",
    );
    expect(orderSubOrigin({ ...base, labels: ["Retomó la compra"] })).toBe(
      "formulario",
    );
    expect(
      orderSubOrigin({
        ...base,
        labels: ["Carrito abandonado recuperado", "Venta por bot"],
        creator: "Leonor",
        orderNumber: "MANUAL-3",
      }),
    ).toBe("carrito");
    expect(
      orderSubOrigin({
        ...base,
        shopifyNumber: "#MCRC1",
        labels: ["Venta por bot"],
        creator: "Conector IA",
      }),
    ).toBe("shopify");
  });
  it("each origin belongs to one channel; 'otro' to none", () => {
    for (const channel of SALE_CHANNELS)
      for (const origin of SALE_ORIGINS[channel])
        expect(saleOriginChannel(origin)).toBe(
          origin === "otro" ? null : channel,
        );
    expect(SALE_CHANNEL_LABEL.landing).toBe("Página web");
  });
  it("classifies origin rows: iComfly, saved Shopify and upsell originals", () => {
    const icomfly = { shopify_display_number: null };
    expect(rowSaleOrigin(row("a", { ...icomfly, creator: "Conector IA" }))).toBe(
      "conector_ia",
    );
    // The bot splits by the WhatsApp ad of the chat (27/11/2026).
    expect(
      rowSaleOrigin(row("a", { ...icomfly, sales_channel: "whatsapp" })),
    ).toBe("bot_sin_revisar");
    const ad = { hasAd: true, adId: "120247519549990424" } as never;
    const organic = { hasAd: false, adId: null } as never;
    expect(
      rowSaleOrigin(
        row("a", { ...icomfly, sales_channel: "whatsapp", whatsappAd: ad }),
      ),
    ).toBe("bot_anuncio");
    expect(
      rowSaleOrigin(
        row("a", {
          ...icomfly,
          labels: [{ name: "Venta por bot" }],
          whatsappAd: organic,
        }),
      ),
    ).toBe("bot_organico");
    expect(
      rowSaleOrigin(
        row("a", { ...icomfly, sales_channel: "whatsapp", whatsappAd: null }),
      ),
    ).toBe("bot_sin_revisar");
    // Only the bot splits: an asesora's order with an ad stays asesora.
    expect(
      rowSaleOrigin(row("a", { ...icomfly, creator: "Leonor", whatsappAd: ad })),
    ).toBe("asesora");
    expect(rowSaleOrigin(row("a", { ...icomfly, creator: "Leonor" }))).toBe(
      "asesora",
    );
    expect(
      rowSaleOrigin(row("a", { ...icomfly, order_number: "MANUAL-9" })),
    ).toBe("manual");
    expect(rowSaleOrigin(row("a", { ...icomfly, order_number: "#55" }))).toBe(
      "formulario",
    );
    expect(
      rowSaleOrigin(
        row("a", {
          ...icomfly,
          labels: [{ name: "Carrito abandonado recuperado" }],
        }),
      ),
    ).toBe("carrito");
    expect(rowSaleOrigin(row("#MCRC1"))).toBe("shopify");
    // Saved Shopify rows are Shopify whatever they carry.
    for (const originSource of ["shopify_saved", "shopify_archive"] as const)
      expect(
        rowSaleOrigin(
          row("#1001", { originSource, sales_channel: "whatsapp" }),
        ),
      ).toBe("shopify");
    // An upsell row carries the replacement's name in its numbers: the
    // original's own numbers decide.
    const upsell = {
      originSource: "upsell_original" as const,
      shopify_display_number: "IC-900",
      order_number: "IC-900",
    };
    expect(rowSaleOrigin(row("IC-900", { ...upsell, creator: "Leonor" }))).toBe(
      "asesora",
    );
    expect(rowChannel(row("IC-900", { ...upsell, creator: "Leonor" }))).toBe(
      "whatsapp",
    );
    expect(
      rowSaleOrigin(
        row("IC-900", { ...upsell, originalOrderNumber: "MANUAL-4" }),
      ),
    ).toBe("manual");
    expect(
      rowSaleOrigin(
        row("IC-900", { ...upsell, originalShopifyNumber: "#MCRC9" }),
      ),
    ).toBe("shopify");
    expect(rowSaleOrigin(row("IC-900", upsell))).toBe("formulario");
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
    ).toEqual({ total: 40, landing: 30, whatsapp: 10, unknown: 0, inferred: 0 });
  });
  it("TikTok is all Landing", () => {
    expect(
      campaignChannelSpend({ daily }, "tiktok", "2026-11-18", "2026-11-19"),
    ).toEqual({ total: 40, landing: 40, whatsapp: 0, unknown: 0, inferred: 0 });
  });
  it("a day without rows uses the campaign's share; no rows at all stays unknown", () => {
    expect(
      campaignChannelSpend({ daily }, "meta", "2026-11-18", "2026-11-19"),
    ).toEqual({ total: 40, landing: 0, whatsapp: 0, unknown: 40, inferred: 0 });
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
    ).toEqual({ total: 40, landing: 0, whatsapp: 40, unknown: 0, inferred: 0 });
    expect(
      campaignChannelSpend(
        {
          daily,
          channelSpend: [{ date: "2026-11-18", whatsapp: 10, landing: 30 }],
        },
        "meta",
        "2026-11-18",
        "2026-11-19",
      ),
    ).toEqual({ total: 40, landing: 30, whatsapp: 10, unknown: 0, inferred: 0 });
    expect(
      campaignChannelSpend({}, "meta", "2026-11-18", "2026-11-19"),
    ).toBeNull();
  });

  it("without destination, a campaign named WhatsApp counts as WhatsApp (inferred); never Página web by name", () => {
    for (const name of ["WSP | Magnesio Citrato", "WSP BATANA OIL | CR", "ABO WSP", "wpp colágeno", "WhatsApp - Omega"])
      expect(
        campaignChannelSpend({ daily, name }, "meta", "2026-11-18", "2026-11-19"),
      ).toEqual({ total: 40, landing: 0, whatsapp: 40, unknown: 0, inferred: 40 });
    for (const name of ["WEB | Magnesio", "Landing Batana", "Fat Burn", "", undefined])
      expect(
        campaignChannelSpend({ daily, name }, "meta", "2026-11-18", "2026-11-19"),
      ).toMatchObject({ landing: 0, whatsapp: 0, unknown: 40, inferred: 0 });
    // A read destination always wins over the name.
    expect(
      campaignChannelSpend(
        { daily, name: "WSP | Magnesio", channelSpend: [{ date: "2026-11-18", whatsapp: 0, landing: 5 }] },
        "meta",
        "2026-11-18",
        "2026-11-19",
      ),
    ).toEqual({ total: 40, landing: 40, whatsapp: 0, unknown: 0, inferred: 0 });
    // TikTok is never read by name.
    expect(
      campaignChannelSpend({ daily, name: "WSP" }, "tiktok", "2026-11-18", "2026-11-19"),
    ).toMatchObject({ landing: 40, inferred: 0 });
  });
  it("only clear WhatsApp names", () => {
    for (const name of ["WSP | Magnesio Citrato", "WSP BATANA OIL", "Magnesio WSP", "WA | Batana", "wa - batana", "[WPP] Omega", "Whats App Colágeno"])
      expect(campaignNameSaysWhatsapp(name)).toBe(true);
    for (const name of ["Wasabi", "WAX | Depil", "Batana WA", "Washington", "WSPX", "WSP vs WEB", "WSP landing", null])
      expect(campaignNameSaysWhatsapp(name)).toBe(false);
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
    expect(channels.get("#1")).toEqual({
      channel: "landing",
      origin: "shopify",
      source: "organico",
    });
    expect(channels.get("IC-50")).toEqual({
      channel: "whatsapp",
      origin: "bot_sin_revisar",
      source: "sin_dato",
    });
    expect(channels.get("IC-51")).toEqual({
      channel: "whatsapp",
      origin: "asesora",
      source: "sin_dato",
    });
    expect(channels.has("#2")).toBe(false);
    const mixed = attachChannelMix(days(), orders, channels, period, now);
    expect(mixed[0].mix).toEqual(
      expect.arrayContaining<ChannelOrderGroup>([
        ["landing", [["sku:a", 2]], 1, "shopify", "organico"],
        [
          "whatsapp",
          [
            ["sku:a", 1],
            ["sku:b", 1],
          ],
          1,
          "bot_sin_revisar",
          "sin_dato",
        ],
      ]),
    );
    // Annulled IC-52 is excluded; #2 has no iComfly row → unknown, no origin.
    expect(mixed[1].mix).toEqual(
      expect.arrayContaining<ChannelOrderGroup>([
        ["whatsapp", [["sku:b", 3]], 1, "asesora", "sin_dato"],
        ["unknown", [["sku:a", 1]], 1],
      ]),
    );
    expect(mixed[1].mix).toHaveLength(2);
  });
  it("groups split by origin and stay anonymous", () => {
    const same = [
      order("IC-60", "2026-11-18", [{ sku: "A", title: "Fat Burn", quantity: 1 }]),
      order("IC-61", "2026-11-18", [{ sku: "A", title: "Fat Burn", quantity: 1 }]),
      order("IC-62", "2026-11-18", [{ sku: "A", title: "Fat Burn", quantity: 1 }]),
    ];
    const channels = matchChannelsToOrders(
      same,
      ["IC-60", "IC-61", "IC-62"].map((name, i) =>
        row(name, {
          shopify_display_number: null,
          order_number: name.slice(3),
          creator: i === 2 ? "Conector IA" : null,
          sales_channel: i === 2 ? null : "whatsapp",
        }),
      ),
    );
    const [day] = attachChannelMix(days(), same, channels, period, now);
    expect(day.mix).toEqual([
      ["whatsapp", [["sku:a", 1]], 2, "bot_sin_revisar", "sin_dato"],
      ["whatsapp", [["sku:a", 1]], 1, "conector_ia", "sin_dato"],
    ]);
    // Only channel, lines, count, origin and source leave the server.
    const text = JSON.stringify(day.mix);
    for (const secret of ["IC-60", "IC-61", "IC-62", "Conector IA"])
      expect(text).not.toContain(secret);
  });
  it("upsell replacements keep the channel and origin of the original order", () => {
    const upsell = { originSource: "upsell_original" as const };
    const channels = matchChannelsToOrders(orders, [
      row("IC-50", {
        shopify_display_number: null,
        order_number: "50",
        creator: "Leonor",
      }),
      row("IC-50", upsell),
    ]);
    expect(channels.get("IC-50")).toEqual({
      channel: "landing",
      origin: "formulario",
      source: "organico",
    });
    // The original was a bot sale: the replacement (typed by an asesora)
    // stays a bot sale, not Shopify for carrying its name in the numbers.
    const bot = matchChannelsToOrders(orders, [
      row("IC-50", {
        shopify_display_number: null,
        order_number: "50",
        creator: "Leonor",
      }),
      row("IC-50", { ...upsell, sales_channel: "whatsapp" }),
    ]);
    expect(bot.get("IC-50")).toEqual({
      channel: "whatsapp",
      origin: "bot_sin_revisar",
      source: "sin_dato",
    });
  });
  it("same rank: channel kept with origin 'otro' on origin disagreement; dropped on channel disagreement", () => {
    const icomfly = { shopify_display_number: null, order_number: "50" };
    const otro = matchChannelsToOrders(orders, [
      row("IC-50", { ...icomfly, sales_channel: "whatsapp" }),
      row("IC-50", { ...icomfly, creator: "Leonor" }),
    ]);
    expect(otro.get("IC-50")).toEqual({
      channel: "whatsapp",
      origin: "otro",
      source: "sin_dato",
    });
    const agree = matchChannelsToOrders(orders, [
      row("IC-50", { ...icomfly, creator: "Leonor" }),
      row("IC-50", { ...icomfly, creator: "María" }),
    ]);
    expect(agree.get("IC-50")).toEqual({
      channel: "whatsapp",
      origin: "asesora",
      source: "sin_dato",
    });
    const clash = matchChannelsToOrders(orders, [
      row("IC-50", { ...icomfly, creator: "Leonor" }),
      row("IC-50", { ...icomfly }),
    ]);
    expect(clash.has("IC-50")).toBe(false);
    // iComfly rows win over saved Shopify rows.
    const ranked = matchChannelsToOrders(orders, [
      row("IC-50", { originSource: "shopify_saved" }),
      row("IC-50", { ...icomfly, creator: "Leonor" }),
    ]);
    expect(ranked.get("IC-50")).toEqual({
      channel: "whatsapp",
      origin: "asesora",
      source: "sin_dato",
    });
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
      ["landing", [[keyA, 2]], 2, "formulario"],
      ["landing", [[keyA, 2]], 1, "carrito"],
      ["whatsapp", [[keyA, 1]], 1, "bot"],
      ["whatsapp", [[keyB, 1]], 1, "conector_ia"],
      ["whatsapp", [[keyB, 1]], 1, "asesora"],
    ] as ChannelOrderGroup[],
    "2026-11-19": [
      [
        "landing",
        [
          [keyA, 1],
          [keyB, 2],
        ],
        1,
        "formulario",
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

  it("breaks the orders of each channel down by origin, without spend", () => {
    const result = report(
      sources([
        campaign("fat", [{ date: "2026-11-18", whatsapp: 10, landing: 30 }]),
        campaign("shi", [{ date: "2026-11-18", whatsapp: 40, landing: 0 }]),
      ]),
    );
    const a = result.rows.find((r) => r.key === keyA)!;
    expect(a.origins!.landing).toEqual([
      { origin: "formulario", orders: 3, units: 5, share: 0.75 },
      { origin: "carrito", orders: 1, units: 2, share: 0.25 },
      { origin: "shopify", orders: 0, units: 0, share: 0 },
    ]);
    // The payload carries the legacy "bot" (before 27/11/2026): it reads as
    // "Bot · sin revisar"; the ad split shows with 0.
    expect(a.origins!.whatsapp).toEqual([
      { origin: "bot_anuncio", orders: 0, units: 0, share: 0 },
      { origin: "bot_organico", orders: 0, units: 0, share: 0 },
      { origin: "bot_sin_revisar", orders: 1, units: 1, share: 1 },
      { origin: "conector_ia", orders: 0, units: 0, share: 0 },
      { origin: "asesora", orders: 0, units: 0, share: 0 },
      { origin: "manual", orders: 0, units: 0, share: 0 },
    ]);
    const b = result.rows.find((r) => r.key === keyB)!;
    expect(
      b.origins!.whatsapp.filter((o) => o.orders).map((o) => o.origin),
    ).toEqual(["conector_ia", "asesora"]);
    // Origins carry no spend or CPA of their own.
    expect(Object.keys(a.origins!.landing[0]).sort()).toEqual([
      "orders",
      "origin",
      "share",
      "units",
    ]);
    // Totals by origin add up to the channel totals, for rows and totals.
    const sums = (row: ChannelCpaRow) => {
      for (const channel of SALE_CHANNELS) {
        const list = row.origins![channel];
        expect(list.reduce((n, o) => n + o.orders, 0)).toBe(
          row[channel].orders,
        );
        expect(list.reduce((n, o) => n + o.units, 0)).toBeCloseTo(
          row[channel].units!,
        );
        if (row[channel].orders)
          expect(list.reduce((n, o) => n + (o.share ?? 0), 0)).toBeCloseTo(1);
      }
    };
    for (const row of [...result.rows, result.totals]) sums(row);
    expect(result.totals.origins!.whatsapp.map((o) => o.orders)).toEqual([
      0, 0, 1, 1, 1, 0,
    ]);
  });

  it("the bot split by WhatsApp ad; old payloads with 'bot' still render", () => {
    const result = report(
      sources([campaign("fat", [{ date: "2026-11-18", whatsapp: 10, landing: 0 }])]),
      control({
        "2026-11-18": [
          ["whatsapp", [[keyA, 1]], 3, "bot_anuncio"],
          ["whatsapp", [[keyA, 2]], 1, "bot_organico"],
          ["whatsapp", [[keyA, 1]], 1, "bot_sin_revisar"],
          // A payload cached before 27/11/2026.
          ["whatsapp", [[keyA, 1]], 1, "bot"],
        ],
      }),
    );
    const a = result.rows.find((r) => r.key === keyA)!;
    expect(a.whatsapp.orders).toBe(6);
    expect(a.origins!.whatsapp.slice(0, 3)).toEqual([
      { origin: "bot_anuncio", orders: 3, units: 3, share: 0.5 },
      { origin: "bot_organico", orders: 1, units: 2, share: 1 / 6 },
      { origin: "bot_sin_revisar", orders: 2, units: 2, share: 2 / 6 },
    ]);
    expect(a.origins!.whatsapp.some((o) => o.origin === "bot")).toBe(false);
    expect(SALE_ORIGIN_LABEL.bot_anuncio).toBe("Bot · desde anuncio");
    expect(SALE_ORIGIN_LABEL.bot_organico).toBe("Bot · orgánico");
    expect(SALE_ORIGIN_LABEL.bot_sin_revisar).toBe("Bot · sin revisar");
    // Once every bot order is checked, "sin revisar" is not listed.
    const checked = report(
      sources([campaign("fat", [{ date: "2026-11-18", whatsapp: 10, landing: 0 }])]),
      control({ "2026-11-18": [["whatsapp", [[keyA, 1]], 1, "bot_anuncio"]] }),
    );
    expect(
      checked.rows.find((r) => r.key === keyA)!.origins!.whatsapp.map((o) => o.origin),
    ).toEqual(["bot_anuncio", "bot_organico", "conector_ia", "asesora", "manual"]);
  });

  it("origin 'otro', old payloads and unknown channels", () => {
    const result = report(
      sources([campaign("fat", [{ date: "2026-11-18", whatsapp: 0, landing: 1 }])]),
      control({
        "2026-11-18": [
          ["whatsapp", [[keyA, 1]], 2, "otro"],
          // From before the origin existed: counted in the channel as "otro".
          ["whatsapp", [[keyA, 1]], 1],
          // An origin of the other channel never moves the order.
          ["landing", [[keyA, 1]], 1, "bot"],
          ["whatsapp", [[keyA, 1]], 1, "manual"],
          ["unknown", [[keyA, 1]], 4],
        ],
      }),
    );
    const a = result.rows.find((r) => r.key === keyA)!;
    expect(a.whatsapp.orders).toBe(4);
    expect(a.origins!.whatsapp.at(-1)).toEqual({
      origin: "otro",
      orders: 3,
      units: 3,
      share: 0.75,
    });
    expect(a.origins!.whatsapp.find((o) => o.origin === "manual")!.orders).toBe(
      1,
    );
    expect(a.origins!.landing.at(-1)).toMatchObject({ origin: "otro", orders: 1 });
    // Unknown-channel orders count in the total, not in any origin.
    expect(a.total.orders).toBe(9);
    const inOrigins = SALE_CHANNELS.flatMap((c) => a.origins![c]).reduce(
      (n, o) => n + o.orders,
      0,
    );
    expect(inOrigins).toBe(5);
    // Without channel there is no breakdown either.
    const none = report(
      sources([campaign("fat", null)]),
      control({ "2026-11-18": [["unknown", [[keyA, 1]], 2]] }),
    );
    expect(none.rows.find((r) => r.key === keyA)!.origins).toBeNull();
    expect(none.totals.origins).toBeNull();
  });

  it("breaks the orders down by traffic source, per product and in the totals", () => {
    const result = report(
      sources([campaign("fat", [{ date: "2026-11-18", whatsapp: 10, landing: 30 }])]),
      control({
        "2026-11-18": [
          ["landing", [[keyA, 2]], 2, "formulario", "meta"],
          ["landing", [[keyA, 1]], 1, "formulario", "organico"],
          [
            "landing",
            [
              [keyA, 1],
              [keyB, 1],
            ],
            1,
            "carrito",
            "google",
          ],
          ["whatsapp", [[keyA, 1]], 3, "bot_anuncio", "meta"],
          ["whatsapp", [[keyB, 2]], 1, "asesora", "sin_dato"],
          ["whatsapp", [[keyB, 1]], 1, "conector_ia", "tiktok"],
          ["unknown", [[keyA, 1]], 2],
        ],
      }),
    );
    const a = result.rows.find((r) => r.key === keyA)!;
    // Meta, TikTok and Orgánico always; the rest only with orders.
    expect(a.sources).toEqual([
      { source: "meta", orders: 5, units: 7, share: 5 / 7 },
      { source: "tiktok", orders: 0, units: 0, share: 0 },
      { source: "google", orders: 1, units: 1, share: 1 / 7 },
      { source: "organico", orders: 1, units: 1, share: 1 / 7 },
    ]);
    const b = result.rows.find((r) => r.key === keyB)!;
    expect(b.sources!.map((c) => [c.source, c.orders, c.units])).toEqual([
      ["meta", 0, 0],
      ["tiktok", 1, 1],
      ["google", 1, 1],
      ["organico", 0, 0],
      ["sin_dato", 1, 2],
    ]);
    // Totals: every order with channel once (unknown channel stays out).
    expect(result.totals.sources!.map((c) => [c.source, c.orders, c.units])).toEqual([
      ["meta", 5, 7],
      ["tiktok", 1, 1],
      ["google", 1, 2],
      ["organico", 1, 1],
      ["sin_dato", 1, 2],
    ]);
    // Sources add up to the orders and units of both channels; no spend.
    for (const row of [...result.rows, result.totals]) {
      const list = row.sources!;
      expect(list.reduce((n, c) => n + c.orders, 0)).toBe(
        row.landing.orders! + row.whatsapp.orders!,
      );
      expect(list.reduce((n, c) => n + c.units, 0)).toBeCloseTo(
        row.landing.units! + row.whatsapp.units!,
      );
      expect(list.reduce((n, c) => n + (c.share ?? 0), 0)).toBeCloseTo(1);
      expect(Object.keys(list[0]).sort()).toEqual([
        "orders",
        "share",
        "source",
        "units",
      ]);
    }
    // The search keeps working and the filtered summary adds sources up.
    const found = filterCpaRows(result.rows, "shilaj");
    expect(found.map((r) => r.key)).toEqual([keyB]);
    expect(sumCpaSources(found)).toEqual(b.sources);
    const both = sumCpaSources(result.rows)!;
    // An order with both products counts in each (google: 1 + 1).
    expect(both.find((c) => c.source === "google")).toEqual({
      source: "google",
      orders: 2,
      units: 2,
      share: 2 / 10,
    });
    expect(sumCpaSources([{ sources: null }, b])).toBeNull();
    expect(sumCpaSources([])).toBeNull();
  });

  it("payloads without source keep both channels and show no source detail", () => {
    // A payload cached before 27/11/2026: origins, no source.
    const old = report(
      sources([campaign("fat", [{ date: "2026-11-18", whatsapp: 10, landing: 30 }])]),
    );
    const a = old.rows.find((r) => r.key === keyA)!;
    expect(a.origins).not.toBeNull();
    expect(a.sources).toBeNull();
    expect(old.totals.sources).toBeNull();
    // In a payload that has sources, a group without one counts as sin dato.
    const mixed = report(
      sources([campaign("fat", [{ date: "2026-11-18", whatsapp: 10, landing: 30 }])]),
      control({
        "2026-11-18": [
          ["landing", [[keyA, 1]], 1, "formulario", "organico"],
          ["whatsapp", [[keyA, 1]], 1, "asesora"],
          ["whatsapp", [[keyA, 1]], 1, "asesora", "nueva" as never],
        ],
      }),
    );
    expect(
      mixed.rows.find((r) => r.key === keyA)!.sources!.map((c) => [c.source, c.orders]),
    ).toEqual([
      ["meta", 0],
      ["tiktok", 0],
      ["organico", 1],
      ["sin_dato", 2],
    ]);
    // No orders at all: the source detail shows its zeros.
    const empty = report(sources([]), control({}));
    expect(empty.totals.sources).toEqual([
      { source: "meta", orders: 0, units: 0, share: null },
      { source: "tiktok", orders: 0, units: 0, share: null },
      { source: "organico", orders: 0, units: 0, share: null },
    ]);
    // Without channel there is no source detail either.
    const none = report(
      sources([campaign("fat", null)]),
      control({ "2026-11-18": [["unknown", [[keyA, 1]], 2]] }),
    );
    expect(none.totals.sources).toBeNull();
  });

  it("CPA is null with 0 orders and no cost is invented", () => {
    const result = report(
      sources([
        campaign("fat", [
          { date: "2026-11-18", whatsapp: 10, landing: 30 },
          { date: "2026-11-19", whatsapp: 0, landing: 20 },
        ]),
      ]),
      control({ "2026-11-18": [["landing", [[keyA, 1]], 1, "formulario"]] }),
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

  it("partial destinations: known spend split, the rest «sin destino», CPA per channel ≈ on the known part", () => {
    const named = (id: string, name: string, split: Parameters<typeof campaign>[1]) => ({
      ...campaign(id, split),
      name,
    });
    // fat: 60 split 10 WhatsApp / 50 web; a deleted campaign of the same
    // product (no destination, no WhatsApp in the name) spent 60 too.
    const s = sources([
      campaign("fat", [
        { date: "2026-11-18", whatsapp: 10, landing: 30 },
        { date: "2026-11-19", whatsapp: 0, landing: 20 },
      ]),
      named("fat-old", "Fat Burn | Eliminada", null),
    ]);
    const mapped: MarketingSettings = {
      ...settings,
      mappings: [
        ...settings.mappings,
        { ...settings.mappings[0], campaign_id: "fat-old" },
      ],
    };
    const result = productChannelCpa({ summary, sources: s, settings: mapped, control: control(mix), fx, ...period });
    const a = result.rows.find((r) => r.key === keyA)!;
    // The product total does not change.
    expect(a.total).toMatchObject({ spend: 120, orders: 5, cpaOrder: 24 });
    expect(a.landing).toMatchObject({ spend: 50, orders: 4, cpaOrder: 12.5 });
    expect(a.whatsapp).toMatchObject({ spend: 10, orders: 1, cpaOrder: 10 });
    expect(a.unknownSpend).toBe(60);
    expect(a.unknownCampaigns).toBe(1);
    expect(a.inferredSpend).toBe(0);
    expect(a.split).toBe("partial");
    expect(a.spendNote).toMatch(/^USD\s?60,00 sin destino \(1 campaña sin destino leído en Meta\)/);
    expect(result.spendChannel).toBe("partial");
    // The totals row keeps every campaign's total and shows the same split.
    expect(result.totals.total.spend).toBe(120);
    expect(result.totals.unknownSpend).toBe(60);
    expect(result.totals.landing.spend).toBe(50);
  });

  it("a campaign named WhatsApp without destination is WhatsApp ≈, marked as inferred", () => {
    const s = sources([
      campaign("fat", [{ date: "2026-11-18", whatsapp: 0, landing: 30 }]),
      { ...campaign("shi", null), name: "WSP | Magnesio Citrato" },
    ]);
    const result = report(s);
    const b = result.rows.find((r) => r.key === keyB)!;
    expect(b.whatsapp).toMatchObject({ spend: 60, orders: 2, cpaOrder: 30 });
    expect(b.landing).toMatchObject({ spend: 0 });
    expect(b.inferredSpend).toBe(60);
    expect(b.unknownSpend).toBe(0);
    expect(b.split).toBe("partial");
    expect(b.spendNote).toMatch(/WhatsApp incluye USD\s?60,00 por el nombre de la campaña/);
    expect(result.spendInferred).toBe(true);
    expect(result.spendChannel).toBe("ok");
    const a = result.rows.find((r) => r.key === keyA)!;
    expect(a.split).toBe("ok");
    expect(a.spendNote).toBe("");
  });

  it("a product with no destination at all still shows «Sin desglose»", () => {
    const s = sources([
      campaign("fat", null),
      campaign("shi", [{ date: "2026-11-18", whatsapp: 1, landing: 1 }]),
    ]);
    const result = report(s);
    const a = result.rows.find((r) => r.key === keyA)!;
    expect(a.total.spend).toBe(60);
    expect(a.landing.spend).toBeNull();
    expect(a.whatsapp.spend).toBeNull();
    expect(a.whatsapp.cpaOrder).toBeNull();
    expect(a.unknownSpend).toBe(60);
    expect(a.spendNote).toBe("Meta no dio el destino de 1 campaña: sin desglose");
    expect(result.spendChannel).toBe("partial");
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

describe("búsqueda por producto", () => {
  const rowsOf = (names: string[]) => names.map((name) => ({ name }));
  it("encuentra por partes del nombre, sin tildes ni mayúsculas", async () => {
    const { filterCpaRows } = await import("../lib/marketing-channel-cpa");
    const rows = rowsOf(["Colágeno Hidrolizado + Biotina", "Magnesio Citrato 500 mg", "Omega 3 Premium"]);
    expect(filterCpaRows(rows, "colageno bio").map((r) => r.name)).toEqual(["Colágeno Hidrolizado + Biotina"]);
    expect(filterCpaRows(rows, "  MAGNESIO ").map((r) => r.name)).toEqual(["Magnesio Citrato 500 mg"]);
    expect(filterCpaRows(rows, "")).toBe(rows);
    expect(filterCpaRows(rows, "batana")).toEqual([]);
  });

  it("suma el origen de los productos filtrados y recalcula el % del canal", async () => {
    const { sumCpaOrigins } = await import("../lib/marketing-channel-cpa");
    const o = (origin: string, orders: number, units = orders) => ({ origin, orders, units, share: null });
    const row = (landing: ReturnType<typeof o>[], whatsapp: ReturnType<typeof o>[]) =>
      ({ origins: { landing, whatsapp } }) as unknown as Parameters<typeof sumCpaOrigins>[0][number];
    const sum = sumCpaOrigins([
      row([o("formulario", 3), o("carrito", 1), o("shopify", 0)], [o("bot", 2), o("conector_ia", 0), o("asesora", 1), o("manual", 0)]),
      row([o("formulario", 1), o("carrito", 0), o("shopify", 0)], [o("bot", 1), o("conector_ia", 1), o("asesora", 0), o("manual", 0), o("otro", 1)]),
    ])!;
    expect(sum.landing.map((c) => [c.origin, c.orders, c.share])).toEqual([
      ["formulario", 4, 0.8],
      ["carrito", 1, 0.2],
      ["shopify", 0, 0],
    ]);
    // Old cells with "bot" add up as "Bot · sin revisar".
    expect(sum.whatsapp.map((c) => [c.origin, c.orders])).toEqual([
      ["bot_anuncio", 0],
      ["bot_organico", 0],
      ["bot_sin_revisar", 3],
      ["conector_ia", 1],
      ["asesora", 1],
      ["manual", 0],
      ["otro", 1],
    ]);
    expect(sumCpaOrigins([{ origins: null }])).toBeNull();
    expect(sumCpaOrigins([])).toBeNull();
  });
});

describe("MANUAL sin creador creados desde Kairo", () => {
  // 19–26/11/2026: los 10 "MANUAL-…" que iComfly guardó sin creador tenían
  // recibo de Kairo (lead_icomfly_receipts): eran del botón de Leads.
  const manual = {
    shopify_display_number: null,
    order_number: "MANUAL-1795623308573-IWHR2",
    labels: [],
    creator: null,
  };
  it("con recibo de Kairo cuentan como «Desde Leads en Kairo»", () => {
    expect(rowSaleOrigin(row("a", { ...manual, kairoLead: true }))).toBe(
      "conector_ia",
    );
  });
  it("sin recibo siguen como «Manual sin creador»", () => {
    expect(rowSaleOrigin(row("a", { ...manual }))).toBe("manual");
    expect(rowSaleOrigin(row("a", { ...manual, kairoLead: false }))).toBe(
      "manual",
    );
  });
  it("el recibo no cambia otros orígenes", () => {
    expect(
      rowSaleOrigin(
        row("a", { ...manual, order_number: "#1795", kairoLead: true }),
      ),
    ).toBe("formulario");
  });
});
