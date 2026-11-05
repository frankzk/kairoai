import { describe, expect, it } from "vitest";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
import type { MarketingOriginRow } from "../lib/marketing-attribution";
import { marketingPeriod } from "../lib/marketing-dates";
import {
  buildPaceSlots,
  buildRealOrderDays,
  matchOriginsToOrders,
} from "../lib/marketing-real-orders";

const meta = {
  utm_source: "Facebook_Mobile_Feed",
  utm_campaign: "CBO MAGNESIUM | CR---120200000000001",
  campaign_id: "120200000000001",
  utm_content: "MAG (1)---120200000000777",
  ad_id: "120200000000777",
};
const order = (
  key: string,
  created: string,
  items: Array<{ sku: string; title?: string }> = [{ sku: "MAG" }],
  status = "delivered",
) =>
  ({
    order_key: key,
    order_name: `IC-W${key}`,
    tracking_status: status,
    guide_number: `guide-${key}`,
    created_at: created,
    items: items.map((item) => ({
      title: item.title ?? item.sku,
      quantity: 1,
      ...item,
    })),
  }) as unknown as OrderProfitabilityRow;
const row = (key: string, origin: unknown = meta) =>
  ({
    icomfly_order_id: key,
    order_number: "x",
    store_web_seq: key,
    shopify_display_number: null,
    tracking_number: `guide-${key}`,
    ad_origin: origin,
  }) satisfies MarketingOriginRow;
const period = marketingPeriod("2026-11-03", "2026-11-04")!;
const now = new Date("2026-11-05T20:35:00Z");

describe("pedidos reales por día", () => {
  it("excludes annulled orders, links UTM orders and splits the rest by product", () => {
    const orders = [
      order("1", "2026-11-03T15:00:00Z"),
      order("2", "2026-11-03T16:00:00Z", [{ sku: "MAG" }], "annulled"),
      order("3", "2026-11-03T17:00:00Z", [
        { sku: "MAG" },
        { sku: "HER.LOSS" },
        { sku: "mag" },
      ]),
      order("4", "2026-11-03T18:00:00Z", []),
      order("5", "2026-11-03T19:00:00Z"),
      order("6", "2026-11-03T20:00:00Z"),
      order("7", "2026-11-03T21:00:00Z", [{ sku: "MAG" }], "annulled"),
    ];
    const origins = matchOriginsToOrders(orders, [
      row("1"),
      row("5", { ...meta, campaign_id: "120200000000001" }),
      row("5", {
        ...meta,
        campaign_id: "120200000000002",
        utm_campaign: "Otra---120200000000002",
      }),
      row("6", { utm_source: "google", utm_campaign: "x" }),
      row("7"),
    ]);
    expect(origins.get("5")).toBe("ambiguous");
    const [day3, day4] = buildRealOrderDays(orders, origins, period, now);
    expect(day3).toEqual({
      date: "2026-11-03",
      created: 7,
      real: 5,
      withCampaign: 1,
      byCampaign: { "meta:120200000000001": 1 },
      byAd: { "meta:120200000000777": 1 },
      // Order 3 is a combo: 0.5 each; 5 (ambiguous) and 6 (google) are unlinked.
      unlinkedBySku: { "sku:mag": 2.5, "sku:her.loss": 0.5 },
      unlinkedNoProduct: 1,
    });
    expect(day4).toMatchObject({ date: "2026-11-04", created: 0, real: 0 });
  });

  it("treats every order as unlinked without origins", () => {
    const [day] = buildRealOrderDays(
      [order("1", "2026-11-03T15:00:00Z")],
      null,
      period,
      now,
    );
    expect(day).toMatchObject({
      real: 1,
      withCampaign: 0,
      byCampaign: {},
      unlinkedBySku: { "sku:mag": 1 },
    });
  });

  it("uses Costa Rica day boundaries (06:00Z)", () => {
    const days = buildRealOrderDays(
      [
        order("1", "2026-11-04T05:59:59Z"),
        order("2", "2026-11-04T06:00:00Z"),
        order("3", "2026-11-03T05:59:59Z"),
      ],
      null,
      period,
      now,
    );
    expect(days.map((d) => [d.date, d.created])).toEqual([
      ["2026-11-03", 1],
      ["2026-11-04", 1],
    ]);
  });

  it("links a TikTok campaign UTM that has no ad id", () => {
    const orders = [order("1", "2026-11-03T15:00:00Z")];
    const origins = matchOriginsToOrders(orders, [
      row("1", {
        utm_source: "tiktok",
        utm_campaign: "CBO HER---1859065142442017",
        campaign_id: "1859065142442017",
      }),
    ]);
    const [day] = buildRealOrderDays(orders, origins, period, now);
    expect(day.byCampaign).toEqual({ "tiktok:1859065142442017": 1 });
    expect(day.byAd).toEqual({});
  });
});

describe("ritmo por tramos de 15 minutos", () => {
  it("indexes slots from 00:00 CR and covers today plus 7 previous days", () => {
    const pace = buildPaceSlots(
      [
        order("1", "2026-11-05T06:14:59Z"),
        order("2", "2026-11-05T06:15:00Z"),
        order("3", "2026-11-05T20:30:00Z", [{ sku: "MAG" }], "annulled"),
        order("4", "2026-11-05T21:00:00Z"),
        order("5", "2026-10-29T06:00:00Z"),
        order("6", "2026-10-29T05:59:00Z"),
      ],
      "2026-11-05",
      now,
    );
    expect(pace.slotMinutes).toBe(15);
    expect(pace.days.map((d) => d.date)).toEqual([
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    const today = pace.days[7];
    expect(today.created).toHaveLength(96);
    expect(today.created[0]).toBe(1);
    expect(today.created[1]).toBe(1);
    expect(today.created[58]).toBe(1);
    expect(today.real[58]).toBe(0);
    // 21:00Z is after `now` (20:35Z): not counted yet.
    expect(today.created.reduce((a, b) => a + b, 0)).toBe(3);
    expect(pace.days[0].created[0]).toBe(1);
  });
});
