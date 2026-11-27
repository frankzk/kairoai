import { describe, expect, it } from "vitest";
import {
  mergeAdOrigins,
  readIcomflyAdOrigin,
  resolveOriginCampaign,
} from "../lib/icomfly-ad-origin";
import {
  mergeTrafficAds,
  orderTrafficSource,
  sourceShownEmpty,
  TRAFFIC_SOURCES,
  TRAFFIC_SOURCE_LABEL,
} from "../lib/marketing-traffic-source";
import { matchChannelsToOrders } from "../lib/marketing-channel-orders";
import type { MarketingOriginRow } from "../lib/marketing-attribution";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
import type { WhatsappAdCheck } from "../lib/icomfly-whatsapp-ad";

const platform = (value: Record<string, unknown>) =>
  readIcomflyAdOrigin(value)?.platform ?? null;

describe("plataforma de la UTM (readIcomflyAdOrigin)", () => {
  // Real utm_source values of Meta ads: the ad set name, with an fbclid.
  const adSetNames = [
    "vascu glow_0611_ed",
    "biviri compresor_1011_cb",
    "fat_burn_shorts_2407_b",
    "thyroid support",
    "car_wash_water_gun - copia 2",
  ];
  it("an ad set name as utm_source with fbclid is Meta", () => {
    for (const utm_source of adSetNames) {
      expect(platform({ utm_source, fbclid: "IwZXh0bgNhZW0BMABh" })).toBe(
        "meta",
      );
      // Without the click id nothing says Meta: still "other".
      expect(platform({ utm_source })).toBe("other");
    }
  });
  it("Meta placement names count as Meta with fbclid; «others» without it stays other", () => {
    for (const utm_source of [
      "facebook_mobile_feed",
      "instagram_stories",
      "whatsapp_status",
      "threads_feed",
      "messenger_inbox",
      "an",
      "others",
    ])
      expect(platform({ utm_source, fbclid: "x" })).toBe("meta");
    // Names that already said Meta keep saying it without fbclid.
    for (const utm_source of ["facebook_mobile_feed", "Instagram_Reels", "an"])
      expect(platform({ utm_source })).toBe("meta");
    expect(platform({ utm_source: "others" })).toBe("other");
  });
  it("click ids are the fallback: ttclid TikTok, gclid / gbraid / wbraid Google", () => {
    expect(platform({ utm_source: "promo noviembre", ttclid: "t" })).toBe(
      "tiktok",
    );
    for (const click of ["gclid", "gbraid", "wbraid"])
      expect(platform({ utm_source: "promo noviembre", [click]: "g" })).toBe(
        "google",
      );
    // A click id alone (no utm_source) gives its platform too.
    expect(readIcomflyAdOrigin({ fbclid: "x" })).toMatchObject({
      platform: "meta",
      hasClick: true,
    });
    expect(readIcomflyAdOrigin({ gbraid: "x" })).toMatchObject({
      platform: "google",
      hasClick: true,
    });
    // Click ids of two platforms: no guess.
    expect(platform({ utm_source: "promo", fbclid: "x", gclid: "y" })).toBe(
      "other",
    );
  });
  it("the source text wins over the click id; «-sitelink» is ignored", () => {
    expect(platform({ utm_source: "tiktok", fbclid: "x" })).toBe("tiktok");
    expect(platform({ utm_source: "google", fbclid: "x" })).toBe("google");
    expect(platform({ utm_source: "facebook", gclid: "x" })).toBe("meta");
    expect(platform({ utm_source: "google-sitelink" })).toBe("google");
    expect(platform({ utm_source: "an-sitelink" })).toBe("meta");
    expect(platform({ utm_source: "tt-sitelink" })).toBe("tiktok");
    // "tiktok" / "google" inside an ad set name lose to the fbclid.
    expect(platform({ utm_source: "estilo tiktok_0611", fbclid: "x" })).toBe(
      "meta",
    );
    expect(platform({ utm_source: "estilo tiktok_0611" })).toBe("tiktok");
    expect(platform({ utm_source: "chatgpt.com" })).toBe("other");
    expect(platform({ utm_campaign: "promo", channel: "tiktok" })).toBe("tiktok");
  });
  it("platform fix flows through campaign resolution and merging", () => {
    const meta = readIcomflyAdOrigin({
      utm_source: "vascu glow_0611_ed",
      fbclid: "x",
      utm_campaign: "VASCU---120230000000000001",
    })!;
    expect(meta).toMatchObject({
      platform: "meta",
      campaignId: "120230000000000001",
    });
    // A catalog naming the same campaign on TikTok is now a conflict.
    expect(
      resolveOriginCampaign(meta, [
        { platform: "tiktok", accountId: "1", campaignId: "120230000000000001" },
      ]).conflicts,
    ).toEqual(["platform"]);
    expect(
      resolveOriginCampaign(meta, [
        { platform: "meta", accountId: "1", campaignId: "120230000000000001" },
      ]),
    ).toMatchObject({ platform: "meta", conflicts: [] });
    expect(mergeAdOrigins([meta, meta]).origin?.platform).toBe("meta");
  });
});

describe("fuente del tráfico de un pedido (orderTrafficSource)", () => {
  it("an ad or UTM gives its platform, whatever the origin", () => {
    expect(orderTrafficSource("formulario", { platform: "meta" })).toBe("meta");
    expect(orderTrafficSource("formulario", { platform: "tiktok" })).toBe(
      "tiktok",
    );
    expect(orderTrafficSource("carrito", { platform: "google" })).toBe(
      "google",
    );
    expect(orderTrafficSource("formulario", { platform: "other" })).toBe(
      "otra",
    );
    expect(orderTrafficSource("formulario", { platform: null })).toBe("otra");
    expect(orderTrafficSource("bot_anuncio", { platform: "meta" })).toBe(
      "meta",
    );
    // Team-created orders that carry an ad keep it.
    expect(orderTrafficSource("asesora", { platform: "meta" })).toBe("meta");
    expect(orderTrafficSource("conector_ia", { platform: "tiktok" })).toBe(
      "tiktok",
    );
  });
  it("without ad or UTM: web and bot without ad are organic; the rest is sin dato", () => {
    for (const origin of [
      "formulario",
      "carrito",
      "shopify",
      "bot_organico",
    ] as const)
      expect(orderTrafficSource(origin, null)).toBe("organico");
    for (const origin of [
      "bot_sin_revisar",
      "bot",
      "conector_ia",
      "asesora",
      "manual",
      "otro",
    ] as const)
      expect(orderTrafficSource(origin, null)).toBe("sin_dato");
    expect(orderTrafficSource("bot_anuncio", undefined)).toBe("meta");
    expect(orderTrafficSource("formulario", "ambiguous")).toBe("sin_dato");
  });
  it("merges the ad origins of the rows of one order", () => {
    expect(mergeTrafficAds([])).toBeNull();
    expect(mergeTrafficAds([null, undefined])).toBeNull();
    expect(mergeTrafficAds([null, { platform: "meta" }])).toEqual({
      platform: "meta",
    });
    expect(
      mergeTrafficAds([{ platform: "other" }, { platform: "meta" }]),
    ).toEqual({ platform: "meta" });
    expect(mergeTrafficAds([{ platform: "other" }, { platform: null }])).toEqual(
      { platform: "other" },
    );
    expect(
      mergeTrafficAds([{ platform: "meta" }, { platform: "tiktok" }]),
    ).toBe("ambiguous");
  });
  it("fixed order and labels; Meta, TikTok and Orgánico always shown", () => {
    expect(TRAFFIC_SOURCES).toEqual([
      "meta",
      "tiktok",
      "google",
      "otra",
      "organico",
      "sin_dato",
    ]);
    expect(TRAFFIC_SOURCE_LABEL.meta).toBe("Meta (Facebook / Instagram)");
    expect(TRAFFIC_SOURCE_LABEL.organico).toBe("Orgánico / directo");
    expect(TRAFFIC_SOURCE_LABEL.sin_dato).toBe("Sin dato de fuente");
    expect(TRAFFIC_SOURCES.filter(sourceShownEmpty)).toEqual([
      "meta",
      "tiktok",
      "organico",
    ]);
  });
});

describe("fuente del tráfico por pedido (matchChannelsToOrders)", () => {
  const orders = ["IC-1", "IC-2", "IC-3", "IC-4", "IC-5", "IC-6", "IC-7", "IC-8"].map(
    (key) =>
      ({
        order_key: key,
        order_name: key,
        guide_number: "",
        created_at: "2026-11-27T16:00:00Z",
        tracking_status: "pending",
        items: [],
      }) as unknown as OrderProfitabilityRow,
  );
  const row = (
    name: string,
    extra: Partial<MarketingOriginRow> = {},
  ): MarketingOriginRow => ({
    icomfly_order_id: name,
    order_number: name.slice(3),
    shopify_display_number: null,
    store_web_seq: null,
    tracking_number: null,
    ad_origin: null,
    originSource: "icomfly",
    ...extra,
  });
  const ad = {
    hasAd: true,
    adId: "120247519549990424",
    headline: "",
    sourceUrl: "",
    hasClick: true,
    metaAccountId: null,
    campaignId: null,
    adsetId: null,
    adName: "",
    adsetName: "",
    campaignName: "",
    icomflyCampaignId: null,
  } satisfies WhatsappAdCheck;
  const organic = { ...ad, hasAd: false, adId: null };
  it("web UTM, WhatsApp ad, organic and team-created orders", () => {
    const channels = matchChannelsToOrders(orders, [
      // Web form with a Meta ad set name as source + fbclid.
      row("IC-1", {
        ad_origin: { utm_source: "thyroid support", fbclid: "x" },
      }),
      // Web form with a referral.
      row("IC-2", { ad_origin: { utm_source: "chatgpt.com" } }),
      // Web form without UTM.
      row("IC-3"),
      // Bot whose chat came from a Meta ad / not from an ad / not checked.
      row("IC-4", { sales_channel: "whatsapp", whatsappAd: ad }),
      row("IC-5", { sales_channel: "whatsapp", whatsappAd: organic }),
      row("IC-6", { sales_channel: "whatsapp" }),
      // Leads en Kairo without ad; an asesora's order whose chat had an ad.
      row("IC-7", { creator: "Conector IA" }),
      row("IC-8", { creator: "Leonor", whatsappAd: ad }),
    ]);
    expect(
      Object.fromEntries(
        Array.from(channels).map(([key, c]) => [key, [c.origin, c.source]]),
      ),
    ).toEqual({
      "IC-1": ["formulario", "meta"],
      "IC-2": ["formulario", "otra"],
      "IC-3": ["formulario", "organico"],
      "IC-4": ["bot_anuncio", "meta"],
      "IC-5": ["bot_organico", "organico"],
      "IC-6": ["bot_sin_revisar", "sin_dato"],
      "IC-7": ["conector_ia", "sin_dato"],
      "IC-8": ["asesora", "meta"],
    });
  });
  it("uses the origin Marketing resolved; rows naming two platforms are sin dato", () => {
    const channels = matchChannelsToOrders(orders.slice(0, 2), [
      row("IC-1", {
        ad_origin: { utm_source: "promo" },
        // Resolved by the verified campaign catalog.
        resolvedOrigin: {
          ...readIcomflyAdOrigin({ utm_source: "promo" })!,
          platform: "tiktok",
        },
      }),
      row("IC-2", { ad_origin: { utm_source: "tiktok" } }),
      row("IC-2", {
        ad_origin: { utm_source: "facebook" },
        originSource: "shopify_saved",
      }),
    ]);
    expect(channels.get("IC-1")?.source).toBe("tiktok");
    expect(channels.get("IC-2")?.source).toBe("sin_dato");
  });
  it("an upsell replacement keeps the ad of its original", () => {
    const channels = matchChannelsToOrders(orders.slice(0, 1), [
      row("IC-1", { creator: "Leonor" }),
      row("IC-1", {
        originSource: "upsell_original",
        originalOrderNumber: "77",
        ad_origin: { utm_source: "facebook", fbclid: "x" },
      }),
    ]);
    expect(channels.get("IC-1")).toEqual({
      channel: "landing",
      origin: "formulario",
      source: "meta",
    });
  });
});
