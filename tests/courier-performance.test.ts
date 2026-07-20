import { describe, expect, it } from "vitest";
import {
  buildCourierPerformanceReport,
  type TrackableOrderRow,
} from "../lib/finance-orders";

function order(
  orderNumber: number,
  overrides: Partial<TrackableOrderRow> = {}
): TrackableOrderRow {
  const orderName = `#MCRC${orderNumber}`;
  return {
    row_key: `shopify:${orderNumber}`,
    source: "shopify",
    guide_number: "",
    courier: "",
    order_name: orderName,
    customer_name: `Cliente ${orderNumber}`,
    boxful_status: "",
    internal_status: "matched",
    match_status: "matched",
    cod_amount: 19_900,
    shopify_order_name: orderName,
    shopify_order_number: orderNumber,
    shopify_financial_status: "pending",
    shopify_fulfillment_status: "fulfilled",
    shopify_cancelled_at: null,
    shopify_created_at: "2026-07-10T12:00:00Z",
    package_items: [],
    ...overrides,
  };
}

function windowFor(start: string, end: string, rangeLabel: string) {
  return {
    curStart: Date.parse(start),
    curEnd: Date.parse(end),
    rangeLabel,
  };
}

describe("courier performance report", () => {
  it("compares the July Shopify cohort without duplicating matched logistics rows", () => {
    const rows: TrackableOrderRow[] = [
      order(101),
      order(101, {
        row_key: "boxful:101",
        source: "boxful",
        guide_number: "MLCR000000101SD",
        courier: "WYN Logistics",
        wyn_group: "delivered",
      }),
      order(102, {
        guide_number: "MLCR000000102SD",
        courier: "MailAmericas CR Next Day",
        wyn_group: "returned",
      }),
      order(103, {
        guide_number: "2533103",
        courier: "Moovin",
        moovin_group: "delivered",
      }),
      order(104, {
        guide_number: "2533104",
        courier: "Moovin",
        moovin_group: "in_progress",
      }),
      order(105),
      order(106, {
        guide_number: "GUIA-EXTERNA-106",
        courier: "Transportadora nueva",
      }),
      order(107, {
        shopify_created_at: "2026-08-01T00:00:00Z",
        guide_number: "2533107",
        courier: "Moovin",
        moovin_group: "delivered",
      }),
    ];

    const report = buildCourierPerformanceReport(
      rows,
      new Map(),
      windowFor("2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z", "Mes actual")
    );
    const wyn = report.rows.find((row) => row.id === "wyn");
    const moovin = report.rows.find((row) => row.id === "moovin");

    expect(report.periodLabel).toBe("Mes actual");
    expect(report.totalShopifyOrders).toBe(6);
    expect(report.withGuide).toBe(5);
    expect(report.unassignedGuides).toBe(1);

    expect(wyn).toMatchObject({
      dispatched: 2,
      delivered: 1,
      notDelivered: 1,
      deliveryRate: 50,
    });
    expect(wyn?.statusCounts.delivered).toBe(1);
    expect(wyn?.statusCounts.not_delivered).toBe(1);

    expect(moovin).toMatchObject({
      dispatched: 2,
      delivered: 1,
      notDelivered: 0,
      deliveryRate: 50,
    });
    expect(moovin?.statusCounts.delivered).toBe(1);
    expect(moovin?.statusCounts.en_route).toBe(1);
  });

  it("does not turn unmatched courier rows into new Shopify orders", () => {
    const unmatched = order(999, {
      row_key: "boxful:unmatched",
      source: "boxful",
      guide_number: "MLCR000000999SD",
      courier: "WYN",
      shopify_order_name: "",
      shopify_order_number: null,
      wyn_group: "delivered",
    });

    const report = buildCourierPerformanceReport(
      [unmatched],
      new Map(),
      windowFor("2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z", "Mes actual")
    );

    expect(report.totalShopifyOrders).toBe(0);
    expect(report.withGuide).toBe(0);
    expect(report.rows.every((row) => row.dispatched === 0)).toBe(true);
  });

  it("uses the selected KPI window instead of the whole calendar month", () => {
    const report = buildCourierPerformanceReport(
      [
        order(201, {
          shopify_created_at: "2026-07-10T12:00:00Z",
          guide_number: "2533201",
          courier: "Moovin",
          moovin_group: "delivered",
        }),
        order(202, {
          shopify_created_at: "2026-07-11T12:00:00Z",
          guide_number: "2533202",
          courier: "Moovin",
          moovin_group: "delivered",
        }),
      ],
      new Map(),
      windowFor("2026-07-10T00:00:00Z", "2026-07-11T00:00:00Z", "Hoy")
    );

    expect(report.periodLabel).toBe("Hoy");
    expect(report.totalShopifyOrders).toBe(1);
    expect(report.rows.find((row) => row.id === "moovin")?.dispatched).toBe(1);
  });

  it("supports the full-history KPI window", () => {
    const report = buildCourierPerformanceReport(
      [
        order(301, { shopify_created_at: "2026-01-10T12:00:00Z" }),
        order(302, { shopify_created_at: "2026-07-10T12:00:00Z" }),
      ],
      new Map(),
      windowFor("2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z", "Todo el histórico")
    );

    expect(report.periodLabel).toBe("Todo el histórico");
    expect(report.totalShopifyOrders).toBe(2);
  });
});
