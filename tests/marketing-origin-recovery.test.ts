import { describe, expect, it } from "vitest";
import {
  readIcomflyAdOrigin,
  shopifyAdOrigin,
  mergeAdOrigins,
  resolveOriginCampaign,
} from "../lib/icomfly-ad-origin";
import { buildMarketingAttribution } from "../lib/marketing-attribution";
import { periodFromInput } from "../lib/marketing-dates";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
const raw = {
  utm_source: "Facebook_Feed",
  utm_campaign: "CBO NAD+ | CR---123456789",
  utm_medium: "Group---234567890",
  utm_content: "Ad---345678901",
};
const origin = () => readIcomflyAdOrigin(raw)!;
const catalog = [
  { platform: "meta" as const, accountId: "999", campaignId: "123456789" },
];
describe("evidencia compatible de origen publicitario", () => {
  it("reconoce ID numéricos en UTM sin redondearlos y detecta contradicciones", () => {
    expect(
      readIcomflyAdOrigin({
        utm_campaign: "1834567890123456789",
        utm_content: "1834567890123456791",
      }),
    ).toMatchObject({
      campaignId: "1834567890123456789",
      adId: "1834567890123456791",
    });
    expect(
      readIcomflyAdOrigin({ utm_campaign: "123456789", utm_id: "999999999" })
        ?.conflicts,
    ).toEqual(["campaign"]);
  });
  it("decodifica únicamente atributos publicitarios guardados sin leer notas ni datos personales", () => {
    const decoded = shopifyAdOrigin([
      { name: "utm_campaign", value: "CBO+NAD%2B+%7C+CR---123456789" },
      { name: "email", value: "private" },
      { name: "notes", value: "utm_id=123456789" },
    ]);
    expect(decoded).toEqual({ utm_campaign: raw.utm_campaign });
    expect(readIcomflyAdOrigin(raw)?.campaignName).toContain("NAD+");
  });
  it("une el mismo anuncio aunque cambien codificación, placement o campos vacíos", () => {
    const saved = readIcomflyAdOrigin({
      ...shopifyAdOrigin([
        { name: "utm_campaign", value: "CBO+NAD%2B+%7C+CR---123456789" },
      ]),
      utm_source: "Instagram_Feed",
    })!;
    const r = mergeAdOrigins([origin(), saved]);
    expect(r.ambiguous).toBe(false);
    expect(r.origin).toMatchObject({
      platform: "meta",
      campaignId: "123456789",
      adId: "345678901",
      conflicts: [],
    });
  });
  it("descarta IDs o plataformas contradictorias en vez de escoger la fuente más conveniente", () => {
    expect(
      mergeAdOrigins([origin(), { ...origin(), adId: "999999999" }]).ambiguous,
    ).toBe(true);
    expect(
      mergeAdOrigins([origin(), { ...origin(), platform: "tiktok" }]).ambiguous,
    ).toBe(true);
    expect(
      mergeAdOrigins([origin(), { ...origin(), conflicts: ["campaign"] }])
        .origin?.conflicts,
    ).toEqual(["campaign"]);
  });
  it("solo resuelve una plataforma desconocida con un ID verificado en una cuenta única", () => {
    const unknown = readIcomflyAdOrigin({
      utm_source: "NAD",
      utm_campaign: "123456789",
    })!;
    expect(resolveOriginCampaign(unknown, catalog).platform).toBe("meta");
    expect(resolveOriginCampaign(unknown, []).platform).toBe("other");
    expect(
      resolveOriginCampaign(unknown, [
        ...catalog,
        { ...catalog[0], accountId: "888" },
      ]).platform,
    ).toBe("other");
    expect(
      resolveOriginCampaign({ ...unknown, platform: "tiktok" }, catalog)
        .conflicts,
    ).toContain("platform");
    expect(
      resolveOriginCampaign(
        readIcomflyAdOrigin({ ttclid: "opaque-click" })!,
        catalog,
      ).campaignId,
    ).toBeNull();
  });
  it("recupera un pedido una sola vez y mantiene el denominador de resultados cerrados", () => {
    const orders = ["delivered", "returned", "in_transit"].map((status, i) => ({
      order_key: String(i),
      order_name: "MCRC" + i,
      guide_number: "g" + i,
      tracking_status: status,
      created_at: "2026-10-10T12:00:00Z",
    })) as OrderProfitabilityRow[];
    const rows = orders.flatMap((o, i) =>
      [raw, { utm_source: "NAD", utm_campaign: "123456789" }].map(
        (ad_origin) => ({
          icomfly_order_id: String(i),
          order_number: o.order_name,
          shopify_display_number: o.order_name,
          store_web_seq: null,
          tracking_number: o.guide_number,
          ad_origin,
        }),
      ),
    );
    const r = buildMarketingAttribution(
      orders,
      rows,
      periodFromInput("2026-10")!,
      new Date("2026-11-04"),
      catalog,
    );
    expect(r).toMatchObject({
      totalOrders: 3,
      linkedCampaign: 3,
      ambiguous: 0,
    });
    expect(r.groups[0]).toMatchObject({
      orders: 3,
      delivered: 1,
      failed: 1,
      open: 1,
      deliveryRate: 0.5,
    });
  });
});
