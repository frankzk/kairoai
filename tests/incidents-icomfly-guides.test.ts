import { describe, expect, it } from "vitest";
import { contactPatch, withIcomflyGuides } from "@/lib/incidents-run";
import type { ShopifyOrderSummary } from "@/lib/finance-orders";

const order = (o: Partial<ShopifyOrderSummary>): ShopifyOrderSummary =>
  ({
    id: "1",
    order_number: 0,
    name: "",
    customer_name: "",
    last_name: "",
    phone: null,
    products: "",
    total: "",
    total_price: 0,
    currency: "CRC",
    financial_status: "pending",
    fulfillment_status: null,
    cancelled_at: null,
    note: "",
    note_attributes: [],
    tracking_number: "",
    tracking_company: "",
    created_at: "2026-10-25T00:00:00Z",
    line_items: [],
    ...o,
  }) as ShopifyOrderSummary;

describe("withIcomflyGuides", () => {
  it("una guia WYN asignada en iComfly apunta al pedido de Shopify sin guia", () => {
    const shopify = order({ id: "gid-26964", name: "#MCRC26964", customer_name: "Vianney castillo", phone: "+50664101452" });
    const icomfly = order({ id: "icomfly-738180", name: "#MCRC26964", tracking_number: "MLCR000352775SD" });
    const map = withIcomflyGuides(new Map(), [shopify], [icomfly]);
    expect(map.get("MLCR000352775SD")).toBe(shopify);
  });

  it("si el pedido no esta en Shopify usa el de iComfly", () => {
    const icomfly = order({ id: "icomfly-9", name: "#MCRC99999", customer_name: "Ana", tracking_number: "MLCR1SD" });
    const map = withIcomflyGuides(new Map(), [], [icomfly]);
    expect(map.get("MLCR1SD")?.id).toBe("icomfly-9");
  });

  it("no pisa una guia que ya estaba indexada", () => {
    const first = order({ id: "a", name: "#A", tracking_number: "G1" });
    const map = new Map([["G1", first]]);
    withIcomflyGuides(map, [], [order({ id: "b", name: "#B", tracking_number: "G1" })]);
    expect(map.get("G1")?.id).toBe("a");
  });
});

describe("contactPatch", () => {
  it("llena solo lo vacio", () => {
    const patch = contactPatch(
      { customer_name: "", customer_phone: "", order_name: "", shopify_order_id: "" },
      order({ id: "gid-1", name: "#MCRC1", customer_name: "Ana", phone: "8888" }),
    );
    expect(patch).toEqual({ customer_name: "Ana", customer_phone: "8888", order_name: "#MCRC1", shopify_order_id: "gid-1" });
  });

  it("no pisa lo que ya escribio la asesora", () => {
    const patch = contactPatch(
      { customer_name: "Ana R.", customer_phone: "7777", order_name: "#MCRC1", shopify_order_id: "x" },
      order({ id: "gid-1", name: "#MCRC1", customer_name: "Ana", phone: "8888" }),
    );
    expect(patch).toBeNull();
  });

  it("ignora 'Sin nombre'", () => {
    const patch = contactPatch(
      { customer_name: "", customer_phone: "1", order_name: "#X" },
      order({ name: "#X", customer_name: "Sin nombre" }),
    );
    expect(patch).toBeNull();
  });
});
