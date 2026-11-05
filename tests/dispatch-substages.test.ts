import { describe, expect, it } from "vitest";
import {
  getDispatchSubstage,
  parseDispatchSubstage,
} from "../lib/dispatch-substages";
import { mergeDispatchIntoTracking } from "../lib/dispatch";

describe("subetapas operativas de despacho", () => {
  it("Confirmada y Pedido Pagado sin guia salen de Pendientes sin inventar una solicitud", () => {
    for (const icomfly_estado of [
      "Confirmada",
      "Confirmado",
      "Pedido Pagado",
    ]) {
      const row = {
        icomfly_estado,
        guide_number: "",
        dispatch_view: "pendiente" as const,
      };
      const status = mergeDispatchIntoTracking(
        "pending",
        row.dispatch_view,
        row,
      );
      expect(status).toBe("despacho_solicitado");
      expect(getDispatchSubstage(status, row)).toBe("por_solicitar");
      expect(row.dispatch_view).toBe("pendiente");
    }
  });
  it("una solicitud real sin guia espera guia, incluso si conserva el estado Confirmada", () => {
    expect(
      getDispatchSubstage("despacho_solicitado", { icomfly_estado: "Enviada" }),
    ).toBe("esperando_guia");
    expect(
      getDispatchSubstage("despacho_solicitado", {
        icomfly_estado: "Confirmada",
        dispatch_view: "despacho_solicitado",
      }),
    ).toBe("esperando_guia");
    expect(
      getDispatchSubstage("despacho_solicitado", {
        icomfly_estado: "Confirmada",
        dispatch_requested_by: "Asesora",
      }),
    ).toBe("esperando_guia");
  });
  it("guia con recoleccion pendiente se distingue del movimiento real y los terminales", () => {
    expect(
      getDispatchSubstage("despacho_solicitado", {
        guide_number: "G1",
        icomfly_estado: "Enviada",
      }),
    ).toBe("esperando_recoleccion");
    for (const status of [
      "pending",
      "recolectado",
      "en_route",
      "delivered",
      "not_delivered",
      "incident",
      "annulled",
    ]) {
      expect(
        getDispatchSubstage(status, {
          guide_number: "G1",
          icomfly_estado: "Confirmada",
        }),
      ).toBeNull();
    }
    expect(
      mergeDispatchIntoTracking("en_route", "despachado", {
        icomfly_estado: "Confirmada",
      }),
    ).toBe("en_route");
    expect(
      mergeDispatchIntoTracking("pending", "recolectado", {
        icomfly_estado: "Confirmada",
      }),
    ).toBe("recolectado");
  });
  it("los valores de filtro desconocidos no ocultan pedidos", () => {
    expect(parseDispatchSubstage("por_solicitar")).toBe("por_solicitar");
    expect(parseDispatchSubstage("inventado")).toBe("all");
    expect(parseDispatchSubstage(null)).toBe("all");
  });
});
