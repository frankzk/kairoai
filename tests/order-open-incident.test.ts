import { describe, expect, it } from "vitest";
import { buildOpenIncidentIndex, findOpenIncident, type OrderOpenIncident } from "../lib/order-open-incident";

function incident(overrides: Partial<OrderOpenIncident> = {}): OrderOpenIncident {
  return {
    id: 4968,
    source: "cargoexpreso",
    status: "reprogramada",
    category: "demora_entrega",
    detail: "Sin movimiento del courier hace 11 dias",
    reprogramada_para: "2026-10-14",
    guide_number: "BH262231336-1",
    order_name: "#MIRH20584",
    updated_at: "2026-10-14T12:52:24.892Z",
    ...overrides,
  };
}

describe("novedad abierta de un pedido", () => {
  it("se encuentra por la guia", () => {
    const index = buildOpenIncidentIndex([incident()]);
    expect(findOpenIncident(index, { guide_number: "bh262231336-1", order_name: "#MIRH1" })?.id).toBe(4968);
  });

  it("si la guia cambio (reenvio), se encuentra por el pedido", () => {
    const index = buildOpenIncidentIndex([incident()]);
    expect(
      findOpenIncident(index, { guide_number: "BH262299999-1", order_name: "", shopify_order_name: "#MIRH20584" })?.id
    ).toBe(4968);
    expect(findOpenIncident(index, { guide_number: "BH262299999-1", order_name: "MIRH20584" })?.id).toBe(4968);
  });

  it("las resueltas, perdidas y descartadas no se muestran", () => {
    const index = buildOpenIncidentIndex([
      incident({ id: 1, status: "resuelta" }),
      incident({ id: 2, status: "perdida", guide_number: "FD1", order_name: "#MIRH2" }),
      incident({ id: 3, status: "descartada", guide_number: "FD3", order_name: "#MIRH3" }),
    ]);
    expect(findOpenIncident(index, { guide_number: "BH262231336-1" })).toBeNull();
    expect(findOpenIncident(index, { guide_number: "FD1" })).toBeNull();
  });

  it("un pedido sin guia ni nombre no se cruza con nada", () => {
    const index = buildOpenIncidentIndex([incident({ guide_number: "", order_name: "" })]);
    expect(findOpenIncident(index, { guide_number: "", order_name: "" })).toBeNull();
  });

  it("si hay dos, gana la tocada mas recientemente", () => {
    const index = buildOpenIncidentIndex([
      incident({ id: 1, updated_at: "2026-10-10T00:00:00Z" }),
      incident({ id: 2, status: "pendiente", updated_at: "2026-10-13T00:00:00Z" }),
    ]);
    expect(findOpenIncident(index, { guide_number: "BH262231336-1" })?.id).toBe(2);
  });
});
