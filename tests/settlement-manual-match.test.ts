import { describe, expect, it } from "vitest";
import { settlementShopifyMatchFields, type MatchableShopifyOrder } from "../lib/finance-matching";

// El match manual y el re-emparejar automático escriben los MISMOS campos vía
// settlementShopifyMatchFields, así que los números de liquidación no cambian
// según cómo se haya vinculado la fila.
describe("settlementShopifyMatchFields", () => {
  it("sin pedido -> limpia el vínculo (sin match)", () => {
    const f = settlementShopifyMatchFields(null);
    expect(f.match_status).toBe("unmatched");
    expect(f.shopify_order_id).toBe("");
    expect(f.shopify_order_name).toBe("");
    expect(f.shopify_total).toBe(0);
    expect(f.order_items).toEqual([]);
  });

  it("con pedido -> matched + campos y items del pedido", () => {
    const order: MatchableShopifyOrder = {
      id: 123,
      name: "#MCRC16498",
      order_number: 16498,
      created_at: "2026-07-17T10:00:00Z",
      financial_status: "paid",
      fulfillment_status: "fulfilled",
      cancelled_at: null,
      total_price: "19900",
      line_items: [{ sku: "HER-1", title: "HER LOSS", quantity: 1, price: "19900" }],
    };
    const f = settlementShopifyMatchFields(order);
    expect(f.match_status).toBe("matched");
    expect(f.shopify_order_id).toBe("123");
    expect(f.shopify_order_name).toBe("#MCRC16498");
    expect(f.shopify_total).toBe(19900);
    expect(f.order_items).toEqual([{ sku: "her-1", title: "HER LOSS", quantity: 1, price: 19900 }]);
  });
});
