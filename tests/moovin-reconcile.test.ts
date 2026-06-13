import { describe, expect, it } from "vitest";
import { reconcileMoovin } from "../lib/moovin-reconcile";

const moovin = (group: string, opts: { incident?: boolean; status?: string } = {}) => ({
  latest_group: group,
  latest_status: opts.status ?? group,
  has_incident: opts.incident ?? false,
});

describe("reconcileMoovin", () => {
  it("sin datos de Moovin no genera discrepancia", () => {
    expect(reconcileMoovin("en_route", undefined)).toBeNull();
    expect(reconcileMoovin("en_route", moovin(""))).toBeNull();
  });

  it("Moovin entrego pero el sistema no lo registra", () => {
    const d = reconcileMoovin("en_route", moovin("delivered"))!;
    expect(d.type).toBe("moovin_delivered_unrecorded");
    expect(d.severity).toBe("medium");
  });

  it("coincidencia entregado/entregado: sin discrepancia", () => {
    expect(reconcileMoovin("delivered", moovin("delivered"))).toBeNull();
  });

  it("Moovin devolvio y el sistema no lo refleja", () => {
    const d = reconcileMoovin("en_route", moovin("returned"))!;
    expect(d.type).toBe("moovin_returned");
    expect(d.severity).toBe("high");
  });

  it("devolucion ya reflejada como no entregado: sin discrepancia", () => {
    expect(reconcileMoovin("not_delivered", moovin("returned"))).toBeNull();
  });

  it("incidencia activa en pedido en ruta", () => {
    const d = reconcileMoovin("en_route", moovin("failed", { incident: true, status: "Incidencia en la entrega" }))!;
    expect(d.type).toBe("moovin_incident");
    expect(d.severity).toBe("high");
    expect(d.message).toContain("Incidencia en la entrega");
  });

  it("incidencia en pedido ya no entregado no se reabre", () => {
    expect(reconcileMoovin("not_delivered", moovin("failed", { incident: true }))).toBeNull();
  });

  it("sistema entregado pero Moovin aun en proceso", () => {
    const d = reconcileMoovin("delivered", moovin("in_progress"))!;
    expect(d.type).toBe("system_delivered_moovin_pending");
    expect(d.severity).toBe("medium");
  });

  it("anulado con devolucion Moovin no genera discrepancia", () => {
    expect(reconcileMoovin("annulled", moovin("returned"))).toBeNull();
  });
});
