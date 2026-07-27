import { describe, expect, it } from "vitest";
import {
  aggregateShopifyDraftCarts,
  decideClosedShopifyCartLead,
  decideOpenShopifyCartLead,
  type ShopifyCartLeadSnapshot,
} from "../lib/shopify-draft-carts";
import {
  mapShopifyDraftOrder,
  type ShopifyDraftCart,
} from "../lib/shopify-draft-orders";
import { leadBoardStage } from "../lib/leads";

function draft(partial: Partial<ShopifyDraftCart> = {}): ShopifyDraftCart {
  return {
    id: "100",
    name: "#D100",
    customerName: "Ana Cliente",
    phone: "6123-4567",
    email: "ana@example.com",
    products: "1x Producto A",
    itemCount: 1,
    total: 19900,
    currency: "CRC",
    status: "open",
    invoiceUrl: "https://example.myshopify.com/invoice/100",
    createdAt: "2026-07-25T10:00:00Z",
    updatedAt: "2026-07-25T10:00:00Z",
    ...partial,
  };
}

function snapshot(
  partial: Partial<ShopifyCartLeadSnapshot> = {}
): ShopifyCartLeadSnapshot {
  return {
    id: 1,
    phone: "50661234567",
    name: "Ana Cliente",
    category: "open",
    status: "nuevo",
    statusSource: "auto",
    autoReason: null,
    hasOrder: false,
    hasCartSignal: false,
    firstSeenAt: "2026-07-20T10:00:00Z",
    lastInteractionAt: "2026-07-24T10:00:00Z",
    icomflyCartSignal: false,
    shopifyCartOpen: false,
    shopifyDraftCartCount: 0,
    shopifyDraftUpdatedAt: null,
    cartValue: null,
    cartItemCount: null,
    cartSummary: null,
    ...partial,
  };
}

describe("aggregateShopifyDraftCarts", () => {
  it("deduplica por tienda y telefono, conserva todos los borradores y el mas reciente", () => {
    const result = aggregateShopifyDraftCarts(
      [
        draft(),
        draft({
          id: "101",
          name: "#D101",
          products: "2x Producto B",
          itemCount: 2,
          total: 25000,
          updatedAt: "2026-07-26T10:00:00Z",
        }),
      ],
      "mireva-cr"
    );

    expect(result.skippedNoPhone).toBe(0);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      phone: "50661234567",
      total: 44900,
      itemCount: 3,
    });
    expect(result.groups[0].latest.name).toBe("#D101");
    expect(result.groups[0].drafts).toHaveLength(2);
  });

  it("normaliza Honduras de forma independiente y omite telefonos invalidos", () => {
    const result = aggregateShopifyDraftCarts(
      [
        draft({ id: "hn", phone: "+504 9123-4567" }),
        draft({ id: "bad", phone: "123" }),
      ],
      "mireva-hn"
    );
    expect(result.groups[0].phone).toBe("50491234567");
    expect(result.skippedNoPhone).toBe(1);
  });
});

describe("mapShopifyDraftOrder", () => {
  it("extrae cliente, telefono, productos e invoice_url del Borrador", () => {
    const mapped = mapShopifyDraftOrder({
      id: 55,
      name: "#D55",
      status: "open",
      total_price: "890.00",
      currency: "HNL",
      invoice_url: "https://shop.example/invoices/55",
      created_at: "2026-07-26T10:00:00Z",
      updated_at: "2026-07-26T11:00:00Z",
      customer: {
        first_name: "Daniel",
        last_name: "Lopez",
        phone: "+504 9123-4567",
      },
      line_items: [{ title: "Producto HN", quantity: 2 }],
    });

    expect(mapped).toMatchObject({
      id: "55",
      name: "#D55",
      customerName: "Daniel Lopez",
      phone: "+504 9123-4567",
      products: "2x Producto HN",
      itemCount: 2,
      total: 890,
      currency: "HNL",
      invoiceUrl: "https://shop.example/invoices/55",
    });
  });
});

describe("Shopify draft cart lead transitions", () => {
  const group = aggregateShopifyDraftCarts([draft()], "mireva-cr").groups[0];

  it("crea un lead nuevo directamente en Carrito", () => {
    const decision = decideOpenShopifyCartLead(null, group);
    expect(decision.status).toBe("carrito_abandonado");
    expect(decision.shopifyCartOpen).toBe(true);
    expect(decision.hasCartSignal).toBe(true);
    expect(decision.historyNote).toContain("#D100");
  });

  it("no pisa una gestion manual", () => {
    const current = snapshot({
      status: "no_responde",
      statusSource: "manual",
      autoReason: "gestion de asesora",
    });
    const decision = decideOpenShopifyCartLead(current, group);
    expect(decision.status).toBe("no_responde");
    expect(decision.statusSource).toBe("manual");
    expect(decision.shopifyCartOpen).toBe(true);
  });

  it("un borrador nuevo reabre un ganado automatico sin borrar has_order", () => {
    const current = snapshot({
      category: "won",
      status: "pedido_generado",
      hasOrder: true,
      shopifyCartOpen: false,
    });
    const decision = decideOpenShopifyCartLead(current, group);
    expect(decision.status).toBe("carrito_abandonado");
    expect(decision.category).toBe("open");
    expect(decision.hasOrder).toBe(true);
  });

  it("una sincronizacion repetida no genera otro evento", () => {
    const current = snapshot({
      status: "carrito_abandonado",
      shopifyCartOpen: true,
      shopifyDraftUpdatedAt: group.latest.updatedAt,
    });
    const decision = decideOpenShopifyCartLead(current, group);
    expect(decision.status).toBe("carrito_abandonado");
    expect(decision.historyNote).toBeNull();
  });

  it("al cerrar Shopify conserva la senal de Icomfly", () => {
    const current = snapshot({
      status: "carrito_abandonado",
      shopifyCartOpen: true,
      icomflyCartSignal: true,
      hasCartSignal: true,
      cartValue: 100,
      cartItemCount: 1,
      cartSummary: "Carrito de Icomfly",
    });
    const decision = decideClosedShopifyCartLead(current);
    expect(decision.status).toBe("carrito_abandonado");
    expect(decision.hasCartSignal).toBe(true);
    expect(decision.cartSummary).toBe("Carrito de Icomfly");
  });

  it("al cerrar Shopify devuelve un reabierto con pedido a Ganados", () => {
    const current = snapshot({
      category: "open",
      status: "carrito_abandonado",
      hasOrder: true,
      shopifyCartOpen: true,
    });
    const decision = decideClosedShopifyCartLead(current);
    expect(decision.category).toBe("won");
    expect(decision.status).toBe("pedido_generado");
    expect(decision.hasCartSignal).toBe(false);
  });
});

describe("leadBoardStage", () => {
  it("muestra un Borrador abierto en Carritos sin cambiar el status manual", () => {
    expect(
      leadBoardStage({ status: "no_responde", shopify_cart_open: true })
    ).toBe("carrito");
    expect(
      leadBoardStage({ status: "no_responde", shopify_cart_open: false })
    ).toBe("seguimiento");
  });
});
