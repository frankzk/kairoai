// El costo de entrega del cierre mensual, abierto en dos.
//
// El flete se paga aunque el paquete vuelva, asi que la linea "Costo de
// entrega" siempre sumo entregados y no entregados juntos. Eso es correcto
// contablemente (la plata salio), pero dejaba invisible cuanto cuesta la
// no-entrega: en junio 2026 eran ~35% de la linea.

import { describe, expect, it } from "vitest";
import { buildMonthlyCloseRows, type OrderProfitabilityRow } from "../lib/finance-orders";

function pedido(over: Partial<OrderProfitabilityRow> = {}): OrderProfitabilityRow {
  return {
    order_key: "k",
    order_name: "#MCRC1",
    guide_number: "2600000",
    customer_name: "Cliente",
    source: "boxful",
    shopify_cancelled_at: null,
    shopify_financial_status: "paid",
    tracking_status: "delivered",
    tracking_badge_status: "delivered",
    tracking_label: "Entregado",
    settlement_status: "liquidado",
    settlement_files: [],
    settlement_count: 1,
    settlement_charged_costs: 0,
    settlement_cod_commission: 0,
    settlement_card_commission: 0,
    settlement_delivery_cost: 0,
    settlement_pick_pack_cost: 0,
    settlement_packaging_cost: 0,
    amount_to_liquidate: 0,
    expected_cod: 0,
    order_value: 0,
    product_cost: 0,
    contribution_margin: 0,
    missing_cost_skus: [],
    items: [],
    items_summary: "",
    cash_status: "cobrado",
    issue_count: 0,
    created_at: "2026-06-15T12:00:00Z",
    days_since_order: 0,
    delivered_on: null,
    ...over,
  };
}

function junio(orders: OrderProfitabilityRow[]) {
  const row = buildMonthlyCloseRows(orders, []).find((r) => r.month === "2026-06");
  if (!row) throw new Error("no se armo el mes 2026-06");
  return row;
}

describe("costo de entrega partido en dos", () => {
  it("separa el flete de lo entregado del de lo que no llego", () => {
    const row = junio([
      pedido({ tracking_status: "delivered", settlement_delivery_cost: 3_000 }),
      pedido({ tracking_status: "delivered", settlement_delivery_cost: 3_500 }),
      pedido({ tracking_status: "not_delivered", settlement_delivery_cost: 3_000 }),
    ]);

    expect(row.boxful_delivery_cost_delivered).toBe(6_500);
    expect(row.boxful_delivery_cost_failed).toBe(3_000);
  });

  it("las dos partes suman siempre el total de la linea", () => {
    const row = junio([
      pedido({ tracking_status: "delivered", settlement_delivery_cost: 3_000 }),
      pedido({ tracking_status: "returned", settlement_delivery_cost: 2_500 }),
      pedido({ tracking_status: "annulled", settlement_delivery_cost: 1_500 }),
      pedido({ tracking_status: "en_route", settlement_delivery_cost: 1_000 }),
    ]);

    expect(row.boxful_delivery_cost_delivered + row.boxful_delivery_cost_failed).toBe(
      row.boxful_delivery_cost
    );
    expect(row.boxful_delivery_cost).toBe(8_000);
  });

  it("cuenta como flete perdido todo lo que no se entrego, no solo la devolucion", () => {
    // Devuelto, anulado que igual se despacho y uno en la calle que ya trae
    // cobro del courier: en los tres el flete se pago y no hubo venta.
    const row = junio([
      pedido({ tracking_status: "returned", settlement_delivery_cost: 2_500 }),
      pedido({ tracking_status: "annulled", settlement_delivery_cost: 1_500 }),
      pedido({ tracking_status: "en_route", settlement_delivery_cost: 1_000 }),
    ]);

    expect(row.boxful_delivery_cost_delivered).toBe(0);
    expect(row.boxful_delivery_cost_failed).toBe(5_000);
  });

  it("no toca el costo de producto, que sigue siendo solo de lo entregado", () => {
    // El producto devuelto vuelve al inventario; el flete no se recupera.
    const row = junio([
      pedido({ tracking_status: "delivered", settlement_delivery_cost: 3_000, product_cost: 2_633 }),
      pedido({ tracking_status: "not_delivered", settlement_delivery_cost: 3_000, product_cost: 0 }),
    ]);

    expect(row.product_costs).toBe(2_633);
    expect(row.boxful_delivery_cost_failed).toBe(3_000);
  });
});
