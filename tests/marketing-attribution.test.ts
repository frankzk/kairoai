import { describe, expect, it } from "vitest";
import { readIcomflyAdOrigin } from "../lib/icomfly-ad-origin";
import {
  buildMarketingAttribution,
  type MarketingOriginRow,
} from "../lib/marketing-attribution";
import { periodFromInput } from "../lib/marketing-dates";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
const raw = {
  utm_source: "Facebook_Instream_Video",
  channel: "facebook",
  origen: "edge_url",
  fbclid: "private-click-id",
  utm_campaign: "CBO BATANA OIL | CR---52728714386730",
  campaign_id: "52728714386730",
  utm_id: "52728714386730",
  utm_medium: "BATANA OIL_0610_CB---52728714388530",
  utm_term: "52728714388530",
  utm_content: "BATANA OIL_0610_CB (1)---52728714387730",
  ad_id: "52728714387730",
};
const order = (key: string, status = "delivered", name = `IC-W${key}`) =>
  ({
    order_key: key,
    order_name: name,
    tracking_status: status,
    guide_number: `guide-${key}`,
    created_at: "2026-11-02T12:00:00Z",
  }) as OrderProfitabilityRow;
const row = (key: string, origin: unknown = raw) =>
  ({
    icomfly_order_id: key,
    order_number: "internal-ref",
    store_web_seq: key,
    shopify_display_number: null,
    tracking_number: `guide-${key}`,
    ad_origin: origin,
  }) satisfies MarketingOriginRow;
const period = periodFromInput({ from: "2026-11-01", to: "2026-11-04" })!;
const now = new Date("2026-11-04T18:00:00Z");
describe("origen publicitario de iComfly", () => {
  it("extrae el caso real #638 conservando los ID y todos los UTM como texto", () => {
    expect(readIcomflyAdOrigin(raw)).toMatchObject({
      platform: "meta",
      campaignId: "52728714386730",
      adsetId: "52728714388530",
      adId: "52728714387730",
      campaignName: "CBO BATANA OIL | CR",
      adName: "BATANA OIL_0610_CB (1)",
      hasClick: true,
      conflicts: [],
    });
    expect(JSON.stringify(readIcomflyAdOrigin(raw))).not.toContain(
      "private-click-id",
    );
  });
  it("preserva ID de TikTok mayores que el entero seguro y evita convertirlos a número", () => {
    expect(
      readIcomflyAdOrigin({
        utm_source: "tiktok",
        utm_campaign: "Prueba---1834567890123456789",
        utm_medium: "Grupo---1834567890123456790",
        utm_content: "Video---1834567890123456791",
      }),
    ).toMatchObject({
      platform: "tiktok",
      campaignId: "1834567890123456789",
      adId: "1834567890123456791",
    });
    expect(
      readIcomflyAdOrigin({
        campaign_id: 1834567890123456789,
        utm_source: "tiktok",
      })?.campaignId,
    ).toBeNull();
  });
  it("no inventa ID a partir de nombres o macros sin resolver", () => {
    expect(
      readIcomflyAdOrigin({
        utm_source: "Facebook",
        utm_campaign: "{{campaign.id}}",
        utm_content: "Video 123456",
      }),
    ).toMatchObject({ campaignId: null, adId: null });
    expect(readIcomflyAdOrigin(null)).toBeNull();
    expect(readIcomflyAdOrigin({})).toBeNull();
  });
  it("señala IDs contradictorios en vez de elegir uno", () => {
    expect(readIcomflyAdOrigin({ ...raw, ad_id: "9999999999" })).toMatchObject({
      adId: null,
      conflicts: ["ad"],
    });
  });
});
describe("cruce de compras únicas y resultados", () => {
  it("deduplica Shopify/iComfly y devuelve resultados sobre la misma cohorte sin filtrar abiertos", () => {
    const orders = [
      order("1"),
      order("2", "returned"),
      order("3", "in_transit"),
      order("4", "annulled"),
      order("5", "pending"),
    ];
    const r = buildMarketingAttribution(
      orders,
      [row("1"), row("1"), row("2"), row("3"), row("4")],
      period,
      now,
    );
    expect(r).toMatchObject({
      totalOrders: 5,
      withUtm: 4,
      linkedCampaign: 4,
      withoutUtm: 1,
      conflicts: 0,
      ambiguous: 0,
    });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({
      orders: 4,
      delivered: 1,
      failed: 1,
      open: 1,
      annulled: 1,
      deliveryRate: 0.5,
    });
    expect(JSON.stringify(r)).not.toContain("guide-");
    expect(JSON.stringify(r)).not.toContain("IC-W");
  });
  it("cruza Shopify por número explícito o guía única sin sumar un envío como otra compra", () => {
    const r = buildMarketingAttribution(
      [
        order("1", "delivered", "#MCRC12345"),
        order("2", "pending", "#MCRC54321"),
      ],
      [
        { ...row("88"), shopify_display_number: "#MCRC12345" },
        { ...row("99"), tracking_number: "guide-2" },
      ],
      period,
      now,
    );
    expect(r.linkedCampaign).toBe(2);
  });
  it("no cruza guías repetidas ni nombres de campaña repetidos sin ID", () => {
    const r = buildMarketingAttribution(
      [
        { ...order("1"), guide_number: "same" },
        { ...order("2"), guide_number: "same" },
      ],
      [
        { ...row("99"), tracking_number: "same" },
        row("1", {
          utm_source: "facebook",
          utm_campaign: "CBO BATANA OIL | CR",
        }),
      ],
      period,
      now,
    );
    expect(r.linkedCampaign).toBe(0);
    expect(r.withUtm).toBe(1);
  });
  it("deja fuera conflictos, múltiples orígenes y fechas fuera del período", () => {
    const r = buildMarketingAttribution(
      [
        order("1"),
        order("2"),
        { ...order("3"), created_at: "2026-10-31T05:00:00Z" },
      ],
      [
        row("1", { ...raw, campaign_id: "8888888" }),
        row("2"),
        row("2", { ...raw, utm_source: "Instagram_Feed" }),
        row("3"),
      ],
      period,
      now,
    );
    expect(r).toMatchObject({
      totalOrders: 2,
      linkedCampaign: 0,
      conflicts: 1,
      ambiguous: 1,
    });
  });
  it("no fabrica 0% sin operaciones cerradas y distingue ausencia de UTM", () => {
    expect(
      buildMarketingAttribution(
        [order("1", "pending")],
        [row("1")],
        period,
        now,
      ).groups[0].deliveryRate,
    ).toBeNull();
    expect(
      buildMarketingAttribution([order("1")], [], period, now),
    ).toMatchObject({ totalOrders: 1, withUtm: 0, withoutUtm: 1, groups: [] });
  });
});
