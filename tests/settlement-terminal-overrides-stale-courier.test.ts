import { describe, expect, it } from "vitest";
import {
  getEffectiveTrackingStatus,
  type SettlementTrace,
  type TrackableOrderRow,
} from "../lib/finance-orders";

function row(overrides: Partial<TrackableOrderRow>): TrackableOrderRow {
  return {
    row_key: "shopify-1",
    source: "boxful",
    guide_number: "2512013",
    order_name: "#MCRC10088",
    customer_name: "X",
    boxful_status: "",
    internal_status: "pending",
    match_status: "matched",
    cod_amount: 0,
    shopify_order_name: "#MCRC10088",
    shopify_order_number: 10088,
    shopify_financial_status: "paid",
    shopify_fulfillment_status: "",
    shopify_cancelled_at: null,
    shopify_created_at: "2026-05-28T10:00:00Z",
    package_items: [],
    ...overrides,
  } as TrackableOrderRow;
}

const notDeliveredTrace = [{ internal_status: "not_delivered" } as SettlementTrace];

// Regresión: un paquete YA liquidado como "No entregado" que Moovin dejó
// congelado en un estado en tránsito (in_progress) no debe seguir contando como
// pendiente/en ruta: la liquidación es un hecho cerrado y manda.
describe("liquidación terminal gana sobre courier no-terminal (stale)", () => {
  it("moovin in_progress (stale) + liquidación no_entregada -> not_delivered", () => {
    const r = row({ moovin_group: "in_progress" });
    expect(getEffectiveTrackingStatus(r, notDeliveredTrace)).toBe("not_delivered");
  });

  it("sin liquidación, moovin in_progress sigue siendo en_route (sin cambios)", () => {
    const r = row({ moovin_group: "in_progress" });
    expect(getEffectiveTrackingStatus(r, [])).toBe("en_route");
  });

  it("courier YA terminal (returned) no lo pisa la liquidación", () => {
    // moovin returned -> not_delivered de todos modos; la clave es que NO se
    // cortocircuita el flujo normal cuando el courier ya es terminal.
    const r = row({ moovin_group: "returned" });
    expect(getEffectiveTrackingStatus(r, notDeliveredTrace)).toBe("not_delivered");
  });

  it("liquidación entregada + moovin recolectado (in_progress) -> delivered", () => {
    const r = row({ moovin_group: "in_progress" });
    const deliveredTrace = [{ internal_status: "delivered" } as SettlementTrace];
    expect(getEffectiveTrackingStatus(r, deliveredTrace)).toBe("delivered");
  });
});
