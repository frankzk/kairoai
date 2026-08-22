import { describe, expect, it } from "vitest";
import {
  deriveMoovinGroup,
  moovinGroupToStatus,
  expectsSettlement,
  getTrackingFilterFromStatus,
} from "../lib/finance-orders";
import type { MoovinTrackingRow } from "../lib/finance-types";

function moovinRow(code: string, status: string): MoovinTrackingRow {
  return {
    id_package: "2553375",
    last_name: "",
    tracking_number: "",
    latest_status: status,
    latest_code: code,
    latest_group: "returned", // lo que quedó cacheado con la clasificación vieja
    latest_at: null,
    has_incident: false,
    incident_reason: "",
    delivery_address: "",
    checked_at: "2026-06-26T22:00:00Z",
    events: [],
  } as unknown as MoovinTrackingRow;
}

// Regresión: una guía cancelada ANTES de la recolección (Moovin DELETEPACKAGE /
// "Cancelado previo a recolección") nunca se movió y nunca tendrá liquidación:
// es ANULADO, no "no entregado", y NO debe caer en "Falta cuadrar".
describe("Moovin: cancelado previo a recolección -> anulado", () => {
  it("deriveMoovinGroup lo reclasifica como 'cancelled' (aunque el cache diga returned)", () => {
    expect(deriveMoovinGroup(moovinRow("DELETEPACKAGE", "Cancelado previo a recolección"))).toBe("cancelled");
  });

  it("moovinGroupToStatus(cancelled) = annulled y no espera liquidación", () => {
    const status = moovinGroupToStatus("cancelled");
    expect(status).toBe("annulled");
    expect(expectsSettlement(status)).toBe(false);
    expect(getTrackingFilterFromStatus(status)).toBe("annulled");
  });

  it("un cancelado por superar intentos SIGUE siendo devolución (returned/not_delivered)", () => {
    const group = deriveMoovinGroup(moovinRow("CANCELED", "Cancelado por superar intentos de entrega"));
    expect(group).toBe("returned");
    expect(moovinGroupToStatus(group)).toBe("not_delivered");
    expect(expectsSettlement("not_delivered")).toBe(true);
  });
});
