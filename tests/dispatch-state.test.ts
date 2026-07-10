import { describe, expect, it } from "vitest";
import { isMoovinPickedUp, mergeDispatchIntoTracking, resolveDispatchState } from "../lib/dispatch";
import type { MoovinTrackingRow, IcomflyOrderRecord } from "../lib/finance-types";

function moovin(over: Partial<MoovinTrackingRow> = {}): MoovinTrackingRow {
  return {
    id_package: "",
    last_name: "",
    tracking_number: "",
    latest_status: "",
    latest_code: "",
    latest_group: "in_progress",
    latest_at: null,
    has_incident: false,
    incident_reason: "",
    delivery_address: "",
    events: [],
    checked_at: "",
    ...over,
  };
}

function icomfly(over: Partial<IcomflyOrderRecord> = {}): IcomflyOrderRecord {
  return {
    store_id: 71,
    icomfly_order_id: "1",
    order_number: "SHOP-X",
    shopify_display_number: "#MCRC1",
    status: "",
    carrier_name: "Moovin",
    tracking_number: "",
    shipped_at: null,
    icomfly_created_at: null,
    dispatch_state: "pendiente",
    is_standby: false,
    confirmed_by_user_id: null,
    confirmed_by_name: "",
    confirmed_by_email: "",
    confirmed_at: null,
    confirmed_by_staff_id: null,
    requested_by_user_id: null,
    requested_by_name: "",
    requested_by_email: "",
    requested_at: null,
    requested_by_staff_id: null,
    guide_final_at: null,
    guide_final_source: "",
    raw_attribution: {},
    synced_at: "",
    ...over,
  };
}

describe("isMoovinPickedUp", () => {
  it("undefined cuando no hay row de Moovin", () => {
    expect(isMoovinPickedUp(undefined)).toBeUndefined();
  });

  it("true para grupos delivered / failed / returned (ya hubo movimiento)", () => {
    expect(isMoovinPickedUp(moovin({ latest_group: "delivered" }))).toBe(true);
    expect(isMoovinPickedUp(moovin({ latest_group: "failed" }))).toBe(true);
    expect(isMoovinPickedUp(moovin({ latest_group: "returned" }))).toBe(true);
  });

  it("false cuando sigue en el almacen (Recolección Solicitada / Por preparar)", () => {
    expect(isMoovinPickedUp(moovin({ latest_status: "Recolección Solicitada" }))).toBe(false);
    expect(isMoovinPickedUp(moovin({ latest_status: "Por preparar", latest_code: "PREPARE" }))).toBe(false);
  });

  it("true cuando ya salió del almacen (Sede de Moovin / En ruta)", () => {
    expect(isMoovinPickedUp(moovin({ latest_status: "Sede de Moovin" }))).toBe(true);
    expect(isMoovinPickedUp(moovin({ latest_status: "En ruta para entregar", latest_code: "INROUTE" }))).toBe(true);
  });
});

describe("resolveDispatchState", () => {
  it("Moovin manda: 'Recolección Solicitada' => despacho_solicitado aunque iComfly diga despachado", () => {
    const rec = icomfly({ dispatch_state: "despachado" });
    const state = resolveDispatchState(rec, moovin({ latest_status: "Recolección Solicitada" }), "2547531");
    expect(state).toBe("despacho_solicitado");
  });

  it("'Sede de Moovin' => recolectado (ya recogido, aún en la red)", () => {
    const rec = icomfly({ dispatch_state: "despacho_solicitado" });
    expect(resolveDispatchState(rec, moovin({ latest_status: "Sede de Moovin" }), "2547807")).toBe("recolectado");
  });

  it("'En ruta para entregar' => en_route", () => {
    expect(
      resolveDispatchState(undefined, moovin({ latest_status: "En ruta para entregar a lo largo del día", latest_code: "INROUTE" }), "G")
    ).toBe("en_route");
  });

  it("Moovin terminal (entregado/incidencia) => despachado (el estado final lo maneja otra capa)", () => {
    expect(resolveDispatchState(undefined, moovin({ latest_group: "delivered" }), "G")).toBe("despachado");
    expect(resolveDispatchState(undefined, moovin({ latest_group: "failed" }), "G")).toBe("despachado");
  });

  it("rescata pedidos con guía Moovin sin match en iComfly", () => {
    const state = resolveDispatchState(undefined, moovin({ latest_status: "Recolección Solicitada" }), "2548059");
    expect(state).toBe("despacho_solicitado");
  });

  it("sin dato de Moovin cae al estado de iComfly (sin regresión)", () => {
    expect(resolveDispatchState(icomfly({ dispatch_state: "despachado" }), undefined, "G1")).toBe("despachado");
    expect(resolveDispatchState(icomfly({ dispatch_state: "despacho_solicitado" }), undefined, "")).toBe("despacho_solicitado");
    expect(resolveDispatchState(icomfly({ dispatch_state: "pendiente" }), undefined, "")).toBe("pendiente");
  });

  it("null cuando no hay ni pedido de iComfly ni guía", () => {
    expect(resolveDispatchState(undefined, undefined, "")).toBeNull();
  });
});

describe("mergeDispatchIntoTracking", () => {
  const ok = { shopify_cancelled_at: null, shopify_financial_status: "paid" };
  const cancelled = { shopify_cancelled_at: "2026-06-20T00:00:00Z", shopify_financial_status: "voided" };

  it("la fase de Moovin pisa el base 'en_route' / 'pending'", () => {
    expect(mergeDispatchIntoTracking("en_route", "despacho_solicitado", ok)).toBe("despacho_solicitado");
    expect(mergeDispatchIntoTracking("pending", "despacho_solicitado", ok)).toBe("despacho_solicitado");
    expect(mergeDispatchIntoTracking("en_route", "recolectado", ok)).toBe("recolectado");
    expect(mergeDispatchIntoTracking("en_route", "en_route", ok)).toBe("en_route");
  });

  it("despachado/pendiente (sin fase de transito) NO crean estado nuevo: cae al base", () => {
    expect(mergeDispatchIntoTracking("en_route", "despachado", ok)).toBe("en_route");
    expect(mergeDispatchIntoTracking("pending", "pendiente", ok)).toBe("pending");
  });

  it("no pisa estados terminales (entregado/no entregado/incidencia/reintento)", () => {
    expect(mergeDispatchIntoTracking("delivered", "recolectado", ok)).toBe("delivered");
    expect(mergeDispatchIntoTracking("not_delivered", "despacho_solicitado", ok)).toBe("not_delivered");
    expect(mergeDispatchIntoTracking("incident", "despacho_solicitado", ok)).toBe("incident");
    expect(mergeDispatchIntoTracking("en_route_retry", "recolectado", ok)).toBe("en_route_retry");
  });

  it("no pisa pedidos anulados", () => {
    expect(mergeDispatchIntoTracking("en_route", "recolectado", cancelled)).toBe("en_route");
    expect(mergeDispatchIntoTracking("annulled", null, ok)).toBe("annulled");
  });

  it("sin estado de despacho devuelve el base", () => {
    expect(mergeDispatchIntoTracking("en_route", null, ok)).toBe("en_route");
  });
});
