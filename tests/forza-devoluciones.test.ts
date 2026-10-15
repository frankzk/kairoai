// Devoluciones de Forza (Honduras) que entraban como entregas.
//
// POR QUE ESTE TEST EXISTE: Forza registra la devolucion a la bodega de Mireva
// como "Entregado", sin nombre de quien recibe. Kairo lo tomaba como entrega y
// Honduras quedo con 0 no entregados desde julio y 89,6% de "entrega efectiva"
// en septiembre (la real ronda 55%). Y "No entregado" contiene la palabra
// "entregado": con el orden viejo de la clasificacion tambien contaba como
// entrega.

import { describe, expect, it } from "vitest";
import { classifyForzaGroup } from "../lib/forza";
import { deriveForzaGroup, esDevolucionForza, forzaGroupToStatus } from "../lib/finance-orders";
import type { ForzaTrackingRow } from "../lib/finance-types";

const evento = (title: string, description: string, date: string) => ({ code: title.toUpperCase(), group: "", title, description, date, note: "" });

function guia(eventos: ForzaTrackingRow["events"], latest_group = "delivered"): ForzaTrackingRow {
  return {
    store_id: 2,
    guide_number: "HN123",
    tracking_number: "HN123",
    latest_status: "Entregado",
    latest_code: "ENTREGADO",
    latest_group,
    latest_at: "2026-09-20T15:00:00Z",
    has_incident: false,
    incident_reason: "",
    delivery_address: "Col. Centro, San Pedro Sula",
    receiver_name: "Cliente",
    events: eventos,
    checked_at: "2026-09-21T00:00:00Z",
  };
}

const ida = [
  evento("Creado", "Mireva", "2026-09-05T15:00:00Z"),
  evento("Recibido por Forza", "Mireva", "2026-09-05T18:00:00Z"),
  evento("En instalaciones", "TEGUCIGALPA", "2026-09-06T10:00:00Z"),
];

describe("clasificación de textos de Forza", () => {
  it("lo negativo gana aunque el texto diga 'entregado'", () => {
    expect(classifyForzaGroup("No entregado")).toBe("failed");
    expect(classifyForzaGroup("Devuelto, entregado a remitente")).toBe("returned");
    expect(classifyForzaGroup("Devolución entregada")).toBe("returned");
  });
  it("una entrega sigue siendo entrega", () => {
    expect(classifyForzaGroup("Entregado Mario")).toBe("delivered");
    expect(classifyForzaGroup("En Ruta SAN PEDRO SULA")).toBe("in_progress");
    expect(classifyForzaGroup("Reproceso")).toBe("in_progress");
  });
});

describe("un 'Entregado' sin nombre es una devolución", () => {
  it("con nombre de quien recibe: entrega", () => {
    const g = guia([...ida, evento("En Ruta", "SAN PEDRO SULA", "2026-09-07T09:00:00Z"), evento("Entregado", "Mario", "2026-09-07T14:00:00Z")]);
    expect(esDevolucionForza(g)).toBe(false);
    expect(forzaGroupToStatus(deriveForzaGroup(g))).toBe("delivered");
  });

  it("sin nombre (volvió a la bodega): no entregado", () => {
    const g = guia([
      ...ida,
      evento("En instalaciones", "", "2026-09-08T10:00:00Z"),
      evento("En Ruta", "TEGUCIGALPA", "2026-09-15T09:00:00Z"),
      evento("Entregado", "", "2026-09-16T14:00:00Z"),
    ]);
    expect(esDevolucionForza(g)).toBe(true);
    expect(forzaGroupToStatus(deriveForzaGroup(g))).toBe("not_delivered");
  });

  it("mira la ÚLTIMA entrega registrada", () => {
    const g = guia([...ida, evento("Entregado", "", "2026-09-07T14:00:00Z"), evento("Entregado", "Ana", "2026-09-08T14:00:00Z")]);
    expect(esDevolucionForza(g)).toBe(false);
  });

  it("solo aplica a una guía cerrada como entregada, y sin historial no inventa nada", () => {
    expect(esDevolucionForza(guia([...ida, evento("Entregado", "", "2026-09-07T14:00:00Z")], "in_progress"))).toBe(false);
    expect(esDevolucionForza(guia([]))).toBe(false);
    expect(deriveForzaGroup(guia([]))).toBe("delivered");
    expect(deriveForzaGroup(undefined)).toBe("");
  });
});
