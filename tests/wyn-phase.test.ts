import { describe, expect, it } from "vitest";
import { wynTransitPhase } from "@/lib/wyn-phase";
import { mergeDispatchIntoTracking } from "@/lib/dispatch";
import { getEffectiveTrackingStatus } from "@/lib/finance-orders";

describe("fase de tránsito de WYN", () => {
  it("Orden creada sigue en bodega; almacén/centro de distribución ya está en WYN; LM es reparto", () => {
    expect(wynTransitPhase("OC-1", "pending")).toBe("despacho_solicitado");
    expect(wynTransitPhase("WI-3", "en_route")).toBe("recolectado");
    expect(wynTransitPhase("WI-4", "en_route")).toBe("recolectado");
    expect(wynTransitPhase("RC-0", "en_route")).toBe("recolectado");
    expect(wynTransitPhase("RC-4", "en_route")).toBe("recolectado");
    expect(wynTransitPhase("LM-2", "en_route")).toBe("en_route");
    expect(wynTransitPhase("LM-0", "en_route")).toBe("en_route");
  });

  it("no es tránsito: entregado, devuelto, incidencia o sin dato", () => {
    expect(wynTransitPhase("PF-1", "delivered")).toBeNull();
    expect(wynTransitPhase("PF-2", "returned")).toBeNull();
    expect(wynTransitPhase("LM-7", "incident")).toBeNull();
    expect(wynTransitPhase("", "")).toBeNull();
    expect(wynTransitPhase(undefined, undefined)).toBeNull();
  });

  it("una guía de WYN en Orden creada ya no cae en En ruta", () => {
    const row = {
      source: "shopify" as const,
      boxful_status: "",
      internal_status: "pending",
      shopify_cancelled_at: null,
      shopify_financial_status: "pending",
      guide_number: "MLCR000527959SD",
      wyn_group: "",
      icomfly_estado: "Enviada",
    };
    const base = getEffectiveTrackingStatus(row, []);
    expect(base).toBe("en_route");
    expect(mergeDispatchIntoTracking(base, "despachado", { ...row, wyn_phase: "despacho_solicitado" })).toBe("despacho_solicitado");
    expect(mergeDispatchIntoTracking(base, "despachado", { ...row, wyn_phase: "recolectado" })).toBe("recolectado");
    // Sin fase (dato viejo del dataset) queda como antes.
    expect(mergeDispatchIntoTracking(base, "despachado", row)).toBe("en_route");
    // No pisa estados terminales ni incidencias.
    expect(mergeDispatchIntoTracking("delivered", "despachado", { ...row, wyn_phase: "recolectado" })).toBe("delivered");
    expect(mergeDispatchIntoTracking("incident", "despachado", { ...row, wyn_phase: "recolectado" })).toBe("incident");
  });
});
