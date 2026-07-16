import { describe, expect, it } from "vitest";
import {
  isMoovinCollected,
  isMoovinPickedUp,
  mergeDispatchIntoTracking,
  resolveDispatchState,
} from "../lib/dispatch";
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
  it("Moovin manda: 'Recolección Solicitada' => solicitado aunque iComfly diga despachado", () => {
    const rec = icomfly({ dispatch_state: "despachado" });
    const state = resolveDispatchState(rec, moovin({ latest_status: "Recolección Solicitada" }), "2547531");
    expect(state).toBe("solicitado");
  });

  it("'Sede de Moovin' => recolectado", () => {
    const rec = icomfly({ dispatch_state: "despacho_solicitado" });
    expect(resolveDispatchState(rec, moovin({ latest_status: "Sede de Moovin" }), "2547807")).toBe("collected");
  });

  it("reconoce variantes reales del hito recolectado", () => {
    expect(isMoovinCollected(moovin({ latest_status: "Recolectado" }))).toBe(true);
    expect(isMoovinCollected(moovin({ latest_status: "Recogido por Moovin" }))).toBe(true);
    expect(isMoovinCollected(moovin({ latest_status: "En ruta para entregar" }))).toBe(false);
  });

  it("rescata pedidos con guía Moovin sin match en iComfly", () => {
    const state = resolveDispatchState(undefined, moovin({ latest_status: "Recolección Solicitada" }), "2548059");
    expect(state).toBe("solicitado");
  });

  it("sin dato de Moovin cae al estado de iComfly (sin regresión)", () => {
    expect(resolveDispatchState(icomfly({ dispatch_state: "despachado" }), undefined, "G1")).toBe("despachado");
    expect(resolveDispatchState(icomfly({ dispatch_state: "despacho_solicitado" }), undefined, "")).toBe("solicitado");
    expect(resolveDispatchState(icomfly({ dispatch_state: "pendiente" }), undefined, "")).toBe("pendiente");
  });

  it("null cuando no hay ni pedido de iComfly ni guía", () => {
    expect(resolveDispatchState(undefined, undefined, "")).toBeNull();
  });

  it("standby override solo en el limbo 'solicitado'", () => {
    const standbyRec = icomfly({ dispatch_state: "despacho_solicitado", is_standby: true });
    // sin recoger + standby => standby
    expect(resolveDispatchState(standbyRec, moovin({ latest_status: "Recolección Solicitada" }), "G")).toBe("standby");
    // ya recogido => recolectado (el flag de standby no aplica)
    expect(resolveDispatchState(standbyRec, moovin({ latest_status: "Sede de Moovin" }), "G")).toBe("collected");
  });
});

describe("mergeDispatchIntoTracking", () => {
  const ok = { shopify_cancelled_at: null, shopify_financial_status: "paid" };
  const cancelled = { shopify_cancelled_at: "2026-06-20T00:00:00Z", shopify_financial_status: "voided" };

  it("solicitado pisa el engañoso 'en_route' / 'pending'", () => {
    expect(mergeDispatchIntoTracking("en_route", "solicitado", ok)).toBe("despacho_solicitado");
    expect(mergeDispatchIntoTracking("pending", "solicitado", ok)).toBe("despacho_solicitado");
  });

  it("standby interno se muestra como despacho solicitado", () => {
    expect(mergeDispatchIntoTracking("en_route", "standby", ok)).toBe("despacho_solicitado");
  });

  it("recolectado crea un estado operativo visible", () => {
    expect(mergeDispatchIntoTracking("en_route", "collected", ok)).toBe("collected");
    expect(mergeDispatchIntoTracking("pending", "collected", ok)).toBe("collected");
  });

  it("despachado (ya recogido) NO crea estado nuevo: cae al base", () => {
    expect(mergeDispatchIntoTracking("en_route", "despachado", ok)).toBe("en_route");
  });

  it("no pisa estados terminales (entregado/no entregado/incidencia/reintento)", () => {
    expect(mergeDispatchIntoTracking("delivered", "solicitado", ok)).toBe("delivered");
    expect(mergeDispatchIntoTracking("not_delivered", "solicitado", ok)).toBe("not_delivered");
    expect(mergeDispatchIntoTracking("incident", "solicitado", ok)).toBe("incident");
    expect(mergeDispatchIntoTracking("en_route_retry", "solicitado", ok)).toBe("en_route_retry");
  });

  it("no pisa pedidos anulados", () => {
    expect(mergeDispatchIntoTracking("en_route", "solicitado", cancelled)).toBe("en_route");
    expect(mergeDispatchIntoTracking("annulled", null, ok)).toBe("annulled");
  });

  it("sin estado de despacho devuelve el base", () => {
    expect(mergeDispatchIntoTracking("en_route", null, ok)).toBe("en_route");
    expect(mergeDispatchIntoTracking("pending", "pendiente", ok)).toBe("pending");
  });
});
