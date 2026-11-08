import { describe, expect, it } from "vitest";
import { completarShopifyConIcomfly } from "@/lib/icomfly-pedidos";
import type { ShopifyOrderSummary } from "@/lib/finance-orders";

const pedido = (o: Partial<ShopifyOrderSummary>): ShopifyOrderSummary =>
  ({
    id: "1", order_number: 1, name: "#MCRC1", customer_name: "Ana", last_name: "", phone: null,
    products: "", total: "", total_price: 0, currency: "CRC", financial_status: "pending",
    fulfillment_status: null, cancelled_at: null, note: "", note_attributes: [], tracking_number: "",
    tracking_company: "", created_at: "2026-10-20T00:00:00Z", line_items: [], ...o,
  }) as ShopifyOrderSummary;
const rec = (o: Partial<Parameters<typeof completarShopifyConIcomfly>[1][number]>) => ({
  shopify_display_number: "#MCRC1", status: "pendiente", tracking_number: "", carrier_name: "", ...o,
});

describe("completarShopifyConIcomfly", () => {
  it("toma la guia de iComfly cuando Shopify no la tiene", () => {
    const [p] = completarShopifyConIcomfly([pedido({})], [rec({ status: "en_reparto", tracking_number: "MLCR1SD", carrier_name: "WYN" })]);
    expect(p.tracking_number).toBe("MLCR1SD");
    expect(p.tracking_company).toBe("WYN");
    expect(p.fulfillment_status).toBe("fulfilled");
  });

  it("no pisa la guia de Shopify", () => {
    const [p] = completarShopifyConIcomfly([pedido({ tracking_number: "G-SHOP" })], [rec({ tracking_number: "G-IC" })]);
    expect(p.tracking_number).toBe("G-SHOP");
  });

  it("anula el pedido cancelado en iComfly sin guia", () => {
    const [p] = completarShopifyConIcomfly([pedido({})], [rec({ status: "Cancelado", cancelled_at: "2026-10-21T10:00:00Z" })]);
    expect(p.cancelled_at).toBe("2026-10-21T10:00:00Z");
  });

  it("anulado sin fecha usa la ultima sincronizacion", () => {
    const [p] = completarShopifyConIcomfly([pedido({})], [rec({ status: "cancelado", synced_at: "2026-11-01T00:00:00Z" })]);
    expect(p.cancelled_at).toBe("2026-11-01T00:00:00Z");
  });

  it("saca los testeos sin guia", () => {
    expect(completarShopifyConIcomfly([pedido({})], [rec({ status: "Testeos" })])).toHaveLength(0);
  });

  it("no toca pedidos que solo estan en iComfly ni los que no cruzan", () => {
    const soloIc = pedido({ name: "#MCRC1", icomfly: { id: "9", estado: "testeos" } } as Partial<ShopifyOrderSummary>);
    const otro = pedido({ name: "#MCRC2" });
    const out = completarShopifyConIcomfly([soloIc, otro], [rec({ status: "testeos" })]);
    expect(out).toEqual([soloIc, otro]);
  });

  it("pendiente en iComfly queda igual", () => {
    const original = pedido({});
    const [p] = completarShopifyConIcomfly([original], [rec({ status: "modificar dirección" })]);
    expect(p).toBe(original);
  });
});
