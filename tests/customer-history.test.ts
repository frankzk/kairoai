import { describe, expect, it } from "vitest";

import {
  buildCustomerSummary,
  groupOrdersByState,
  resolveOrderState,
  resolveOrderStateLabel,
  type CustomerOrder,
} from "../lib/customer-history";

function order(partial: Partial<CustomerOrder>): CustomerOrder {
  return {
    name: "#MCRC1",
    created_at: "2026-07-20T10:00:00Z",
    total: 19900,
    currency: "CRC",
    items: [],
    address: "",
    guide: "",
    courier: "",
    state: "pending",
    state_label: "",
    state_at: null,
    has_incident: false,
    incident_reason: "",
    ...partial,
  };
}

describe("resolveOrderState", () => {
  it("cancelado en Shopify manda sobre todo lo demas", () => {
    expect(
      resolveOrderState({ cancelled: true, moovinGroup: "delivered", fulfillmentStatus: "fulfilled" })
    ).toBe("cancelled");
  });

  it("usa el ultimo evento del courier cuando existe", () => {
    expect(resolveOrderState({ cancelled: false, moovinGroup: "delivered" })).toBe("delivered");
    expect(resolveOrderState({ cancelled: false, moovinGroup: "returned" })).toBe("returned");
    expect(resolveOrderState({ cancelled: false, moovinGroup: "in_progress" })).toBe("in_transit");
  });

  it("una incidencia sigue siendo 'en camino' (puede reintentarse)", () => {
    expect(resolveOrderState({ cancelled: false, moovinGroup: "failed", hasIncident: true })).toBe(
      "in_transit"
    );
  });

  it("el courier manda sobre el fulfillment de Shopify", () => {
    // Shopify dice 'fulfilled' pero el courier ya lo devolvio.
    expect(
      resolveOrderState({ cancelled: false, moovinGroup: "returned", fulfillmentStatus: "fulfilled" })
    ).toBe("returned");
  });

  it("sin tracking cae al fulfillment / existencia de guia", () => {
    expect(resolveOrderState({ cancelled: false, fulfillmentStatus: "fulfilled" })).toBe("in_transit");
    expect(resolveOrderState({ cancelled: false, guide: "2596833" })).toBe("in_transit");
    expect(resolveOrderState({ cancelled: false, fulfillmentStatus: null })).toBe("pending");
  });
});

describe("resolveOrderStateLabel", () => {
  it("prefiere el texto literal del courier", () => {
    expect(
      resolveOrderStateLabel({ state: "in_transit", moovinStatus: "En ruta para entregar" })
    ).toBe("En ruta para entregar");
  });

  it("la incidencia gana e incluye el motivo", () => {
    expect(
      resolveOrderStateLabel({
        state: "in_transit",
        moovinStatus: "En ruta",
        hasIncident: true,
        incidentReason: "Cliente no responde",
      })
    ).toBe("Incidencia: Cliente no responde");
  });

  it("anulado no muestra estado de courier", () => {
    expect(resolveOrderStateLabel({ state: "cancelled", moovinStatus: "Entregado" })).toBe("Anulado");
  });

  it("cae a etiquetas genericas sin tracking", () => {
    expect(resolveOrderStateLabel({ state: "delivered" })).toBe("Entregado");
    expect(resolveOrderStateLabel({ state: "returned" })).toBe("Devuelto");
    expect(resolveOrderStateLabel({ state: "pending" })).toBe("Sin despachar");
  });
});

describe("buildCustomerSummary", () => {
  it("solo suma al gastado lo que se entrego", () => {
    const summary = buildCustomerSummary(
      [
        order({ name: "#1", state: "delivered", total: 20000 }),
        order({ name: "#2", state: "returned", total: 15000 }),
        order({ name: "#3", state: "cancelled", total: 30000 }),
        order({ name: "#4", state: "in_transit", total: 10000 }),
      ],
      "CRC"
    );
    expect(summary.total_spent).toBe(20000);
    expect(summary).toMatchObject({
      orders: 4,
      delivered: 1,
      returned: 1,
      cancelled: 1,
      in_transit: 1,
    });
  });

  it("cliente sin pedidos no rompe", () => {
    expect(buildCustomerSummary([], "CRC")).toMatchObject({ orders: 0, total_spent: 0, currency: "CRC" });
  });
});

describe("groupOrdersByState", () => {
  it("ordena los grupos y omite los vacios", () => {
    const groups = groupOrdersByState([
      order({ name: "#1", state: "delivered" }),
      order({ name: "#2", state: "in_transit" }),
      order({ name: "#3", state: "delivered" }),
    ]);
    expect(groups.map((g) => g.state)).toEqual(["in_transit", "delivered"]);
    expect(groups[1].orders).toHaveLength(2);
  });
});
