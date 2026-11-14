import { describe, expect, it } from "vitest";
import { buildCourierComparison, partWidths } from "@/lib/panel-couriers";

describe("comparativo de transportadoras", () => {
  const report = {
    periodLabel: "Últimos 30 días",
    rows: [
      { id: "moovin", label: "Moovin", dispatched: 40, delivered: 28, notDelivered: 4, deliveryRate: 70, statusCounts: { incident_solvable: 2, incident_unsolvable: 1, en_route: 5 } },
      { id: "wyn", label: "WYN / MailAmericas", dispatched: 120, delivered: 60, notDelivered: 20, deliveryRate: 50, statusCounts: { incident_solvable: 10 } },
      { id: "forza", label: "Forza", dispatched: 0, delivered: 0, notDelivered: 0, statusCounts: {} },
    ],
  };

  it("ordena por volumen, reparte los estados y calcula las dos tasas", () => {
    const rows = buildCourierComparison(report);
    expect(rows.map((r) => r.id)).toEqual(["wyn", "moovin"]);
    expect(rows[0]).toMatchObject({
      dispatched: 120,
      parts: { delivered: 60, enCamino: 30, incidencia: 10, notDelivered: 20 },
      rate: 50,
      resolvedRate: 75,
    });
    expect(rows[1].parts).toEqual({ delivered: 28, enCamino: 5, incidencia: 3, notDelivered: 4 });
    expect(rows[1].resolvedRate).toBe(87.5);
  });

  it("las partes suman lo despachado aunque los datos vengan inconsistentes", () => {
    const [row] = buildCourierComparison({ rows: [{ id: "x", label: "X", dispatched: 10, delivered: 8, notDelivered: 5, statusCounts: { incident_solvable: 9 } }] });
    expect(row.parts).toEqual({ delivered: 8, enCamino: 0, incidencia: 0, notDelivered: 2 });
    const w = partWidths(row);
    expect(w.delivered + w.enCamino + w.incidencia + w.notDelivered).toBeCloseTo(100);
  });

  it("tolera respuestas vacías", () => {
    expect(buildCourierComparison(null)).toEqual([]);
    expect(buildCourierComparison({ rows: "x" })).toEqual([]);
  });
});
