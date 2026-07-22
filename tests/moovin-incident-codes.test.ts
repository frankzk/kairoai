import { describe, expect, it } from "vitest";
import { classifyMoovinGroup } from "../lib/moovin";
import { detectMoovinIncident } from "../lib/incidents-detect";
import type { MoovinTrackingRow } from "../lib/finance-types";

// Regresión: Moovin reporta las incidencias de GESTIÓN ("Problemas en gestión /
// Estado: Abierto" en su panel) con códigos propios REVIEW ("paquete en
// revisión") y CHANGECONTACTPOINT ("cambio de información en el punto de
// entrega"), NO como FAILED. Antes quedaban como "en tránsito sin clasificar ->
// en_route" y nunca generaban novedad. Deben clasificarse como incidencia.
describe("classifyMoovinGroup — incidencias de gestión", () => {
  it("REVIEW -> failed", () => {
    expect(classifyMoovinGroup("REVIEW", "paquete en revisión")).toBe("failed");
  });
  it("CHANGECONTACTPOINT -> failed", () => {
    expect(classifyMoovinGroup("CHANGECONTACTPOINT", "cambio de información en el punto de entrega")).toBe("failed");
  });
  it("códigos de tránsito normales siguen in_progress", () => {
    expect(classifyMoovinGroup("INROUTE", "En ruta")).toBe("in_progress");
    expect(classifyMoovinGroup("COORDINATE", "Coordinado")).toBe("in_progress");
  });
  it("estados finales/cancelados no cambian", () => {
    expect(classifyMoovinGroup("DELIVERED", "Entregado")).toBe("delivered");
    expect(classifyMoovinGroup("FAILED", "Incidencia en la entrega")).toBe("failed");
    expect(classifyMoovinGroup("XX", "Cancelado por Moovin")).toBe("returned");
  });
});

describe("detectMoovinIncident — una gestión REVIEW/CHANGECONTACTPOINT es novedad", () => {
  function trackingRow(group: string, code: string, title: string): MoovinTrackingRow {
    return {
      id_package: "2586380",
      last_name: "Perez",
      tracking_number: "",
      latest_status: title,
      latest_code: code,
      latest_group: group,
      latest_at: "2026-07-21T22:47:00.000Z",
      has_incident: group === "failed",
      incident_reason: "Cliente no contesta",
      delivery_address: "",
      checked_at: "2026-07-21T22:50:00.000Z",
      events: [
        { code, group, title, description: "", date: "2026-07-21T22:47:00.000Z", note: "Cliente no contesta" },
      ],
    } as unknown as MoovinTrackingRow;
  }

  it("REVIEW genera candidato de novedad (categoría cliente_no_responde por el motivo)", () => {
    const candidate = detectMoovinIncident(trackingRow("failed", "REVIEW", "paquete en revisión"), undefined, 1);
    expect(candidate).not.toBeNull();
    expect(candidate?.guide_number).toBe("2586380");
    expect(candidate?.category).toBe("cliente_no_responde");
  });

  it("CHANGECONTACTPOINT genera candidato de novedad", () => {
    const candidate = detectMoovinIncident(
      trackingRow("failed", "CHANGECONTACTPOINT", "cambio de información en el punto de entrega"),
      undefined,
      1
    );
    expect(candidate).not.toBeNull();
  });
});
