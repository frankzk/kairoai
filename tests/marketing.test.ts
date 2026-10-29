import { describe, expect, it } from "vitest";
import { buildMarketingSummary, costaRicaDate, marketingMonth } from "../lib/marketing";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
import type { BusinessExpense } from "../lib/finance-types";

function order(patch: Partial<OrderProfitabilityRow> = {}): OrderProfitabilityRow {
  return {
    order_key: "one", order_name: "IC-W1", guide_number: "", customer_name: "Privado",
    source: "shopify", shopify_cancelled_at: null, shopify_financial_status: "pending",
    tracking_status: "pending", tracking_badge_status: "pending", tracking_label: "Pendiente",
    settlement_status: "", settlement_files: [], settlement_count: 0,
    settlement_charged_costs: 0, settlement_cod_commission: 0, settlement_card_commission: 0,
    settlement_delivery_cost: 0, settlement_pick_pack_cost: 0, settlement_packaging_cost: 0,
    amount_to_liquidate: 0, expected_cod: 1000, order_value: 1000, product_cost: 0,
    contribution_margin: 0, missing_cost_skus: [],
    items: [{ sku: "A", title: "Producto A", quantity: 1, price: 1000 }],
    items_summary: "A", cash_status: "sin_caja", issue_count: 0,
    created_at: "2026-10-10T12:00:00Z", days_since_order: 21, delivered_on: null,
    ...patch,
  };
}

function expense(patch: Partial<BusinessExpense> = {}): BusinessExpense {
  return {
    id: 1, store_id: 1, type: "ads", expense_date: "2026-10-10", month: "2026-10",
    platform: "Meta", category: "", description: "", amount: 100, currency: "CRC",
    notes: "", created_at: "", updated_at: "", ...patch,
  };
}

const now = new Date("2026-11-02T12:00:00Z");
const build = (orders: OrderProfitabilityRow[] = [], expenses: BusinessExpense[] = []) =>
  buildMarketingSummary({ orders, expenses, month: "2026-10", now });

describe("marketing cohorts", () => {
  it("uses Costa Rica month boundaries and rejects impossible months", () => {
    expect(costaRicaDate(new Date("2026-11-01T05:59:59Z"))).toBe("2026-10-31");
    expect(marketingMonth("2026-13")).toBeNull();
    expect(marketingMonth("2026-2")).toBeNull();
    const result = build([
      order({ created_at: "2026-10-01T05:59:59Z" }),
      order({ created_at: "2026-10-01T06:00:00Z" }),
      order({ created_at: "2026-11-01T05:59:59Z" }),
      order({ created_at: "2026-11-01T06:00:00Z" }),
      order({ created_at: null }),
    ]);
    expect(result.totals.generated).toBe(2);
    expect(result.quality.withoutDate).toBe(1);
    expect(result.weeks.reduce((sum, week) => sum + week.generated, 0)).toBe(2);
  });

  it("keeps open and cancelled orders in the delivery denominator", () => {
    const result = build([
      order({ tracking_status: "delivered", guide_number: "G1" }),
      order({ tracking_status: "returned", guide_number: "G2" }),
      order({ tracking_status: "annulled" }),
      order({ created_at: "2026-10-30T12:00:00Z" }),
    ]);
    expect(result.totals).toMatchObject({ generated: 4, withGuide: 2, delivered: 1, failed: 1, annulled: 1, open: 1, deliveryRate: 0.25 });
    expect(result.quality.recentOpen).toBe(1);
    expect(result.quality.deliveredWithoutSettlement).toBe(1);
  });

  it("distinguishes missing spend from zero and undefined ratios", () => {
    expect(build([order()]).totals).toMatchObject({ registeredAdSpend: null, costPerGenerated: null, partialBalance: null });
    expect(build([order()], [expense({ amount: 0 })]).totals.costPerGenerated).toBe(0);
    expect(build([], [expense()]).totals.costPerGenerated).toBeNull();
    expect(build().totals.deliveryRate).toBeNull();
    expect(build([order()]).totals).toMatchObject({ settlementNet: null, productCost: null, recordedMargin: null });
  });

  it("never adds other stores or currencies to CRC spend", () => {
    const result = build([order()], [
      expense(), expense({ store_id: 2, amount: 900 }),
      expense({ currency: "USD", amount: 25 }),
      expense({ expense_date: "2026-09-30", amount: 700 }),
    ]);
    expect(result.totals.registeredAdSpend).toBe(100);
    expect(result.quality.foreignExpenses).toBe(1);
    expect(result.channels).toEqual([{ name: "Meta", spend: 100, records: 1 }]);
    expect(result.totals.costPerGenerated).toBeNull();
    expect(result.totals.partialBalance).toBeNull();
  });

  it("excludes duplicated liquidation money and withholds the partial balance", () => {
    const result = build([
      order({ tracking_status: "delivered", settlement_count: 1, amount_to_liquidate: 800, product_cost: 200 }),
      order({ settlement_count: 2, amount_to_liquidate: 1600 }),
    ], [expense()]);
    expect(result.totals).toMatchObject({ settled: 1, settlementNet: 800, productCost: 200, recordedMargin: 600, partialBalance: null });
    expect(result.quality.duplicateSettlements).toBe(1);
  });

  it("withholds margin when delivered products have no complete cost", () => {
    const result = build([order({ tracking_status: "delivered", settlement_count: 1, amount_to_liquidate: 800, missing_cost_skus: ["A"] })], [expense()]);
    expect(result.quality.missingCosts).toBe(1);
    expect(result.totals.recordedMargin).toBeNull();
    expect(result.totals.partialBalance).toBeNull();
    expect(build([order({ tracking_status: "delivered", settlement_count: 1, items: [] })]).quality.missingCosts).toBe(1);
  });

  it("counts each SKU once per order while summing all its units", () => {
    const result = build([order({ tracking_status: "delivered", items: [
      { sku: "A", title: "A", quantity: 2, price: 100 },
      { sku: "a", title: "A", quantity: 1, price: 100 },
      { sku: "B", title: "B", quantity: 1, price: 100 },
    ] })]);
    expect(result.products[0]).toMatchObject({ orders: 1, units: 3, delivered: 1 });
    expect(result.products).toHaveLength(2);
    const text = JSON.stringify(result);
    expect(text).not.toContain("Privado");
    expect(text).not.toContain("IC-W1");
  });
});
