import { describe, expect, it } from "vitest";

// Replica de la clasificacion de incidencias de app/admin/finance/page.tsx.
// Fija el comportamiento del split "incidencia solucionable / no solucionable"
// sobre los eventos crudos de Moovin.
type MoovinEvent = { code?: string; title?: string };

function countMoovinIncidents(events: MoovinEvent[] | undefined): number {
  if (!events?.length) return 0;
  return events.filter(
    (event) =>
      String(event.code ?? "").toUpperCase() === "FAILED" ||
      String(event.title ?? "").toLowerCase().includes("incidencia en la entrega")
  ).length;
}

function countMoovinRouteAttempts(events: MoovinEvent[] | undefined): number {
  if (!events?.length) return 0;
  return events.filter((event) => {
    const title = String(event.title ?? "").toLowerCase();
    return title.includes("en ruta para") && title.includes("a lo largo del");
  }).length;
}

function classifyIncident(row?: {
  moovin_incidents?: number;
  moovin_route_attempts?: number;
}): "incident_solvable" | "incident_unsolvable" {
  const incidents = row?.moovin_incidents ?? 0;
  const routeAttempts = row?.moovin_route_attempts ?? 0;
  return incidents >= 2 && routeAttempts >= 2 ? "incident_unsolvable" : "incident_solvable";
}

const INCIDENT = { code: "FAILED", title: "Incidencia en la entrega" };
// Titulo real de Moovin: "entregar" (no "la entrega") y "dia" sin tilde.
const ROUTE = { code: "INROUTE", title: "En ruta para entregar a lo largo del dia" };
const PREPARE = { code: "PREPARE", title: "Por preparar" };

describe("countMoovinIncidents", () => {
  it("cuenta los eventos FAILED / 'incidencia en la entrega'", () => {
    expect(countMoovinIncidents([PREPARE, INCIDENT, ROUTE, INCIDENT])).toBe(2);
  });

  it("cuenta por titulo aunque el codigo no sea FAILED", () => {
    expect(countMoovinIncidents([{ code: "X", title: "Incidencia en la entrega" }])).toBe(1);
  });

  it("es 0 cuando no hay eventos", () => {
    expect(countMoovinIncidents(undefined)).toBe(0);
    expect(countMoovinIncidents([])).toBe(0);
  });
});

describe("countMoovinRouteAttempts", () => {
  it("cuenta cada salida a reparto 'a lo largo del dia'", () => {
    expect(countMoovinRouteAttempts([ROUTE, PREPARE, ROUTE, INCIDENT])).toBe(2);
  });

  it("tolera la variante con tilde y 'la entrega'", () => {
    const variant = { title: "En ruta para la entrega a lo largo del día" };
    expect(countMoovinRouteAttempts([variant])).toBe(1);
  });

  it("no cuenta otros estados en ruta", () => {
    expect(countMoovinRouteAttempts([{ title: "En ruta a la bodega" }, INCIDENT])).toBe(0);
  });
});

describe("classifyIncident", () => {
  it("solucionable: a lo sumo una incidencia en la entrega", () => {
    expect(classifyIncident({ moovin_incidents: 1, moovin_route_attempts: 1 })).toBe("incident_solvable");
    expect(classifyIncident({ moovin_incidents: 1, moovin_route_attempts: 5 })).toBe("incident_solvable");
    expect(classifyIncident({ moovin_incidents: 0, moovin_route_attempts: 0 })).toBe("incident_solvable");
  });

  it("no solucionable: 2+ incidencias en la entrega Y 2+ salidas a reparto", () => {
    expect(classifyIncident({ moovin_incidents: 2, moovin_route_attempts: 2 })).toBe("incident_unsolvable");
    expect(classifyIncident({ moovin_incidents: 3, moovin_route_attempts: 4 })).toBe("incident_unsolvable");
  });

  it("solucionable si falta cualquiera de las dos condiciones del umbral", () => {
    // 2+ incidencias pero <2 salidas a reparto.
    expect(classifyIncident({ moovin_incidents: 3, moovin_route_attempts: 1 })).toBe("incident_solvable");
    // 2+ salidas pero <2 incidencias.
    expect(classifyIncident({ moovin_incidents: 1, moovin_route_attempts: 3 })).toBe("incident_solvable");
  });

  it("solucionable cuando no hay datos de Moovin", () => {
    expect(classifyIncident(undefined)).toBe("incident_solvable");
  });
});

describe("clasificacion de extremo a extremo", () => {
  it("una entrega que fallo varias veces queda como no solucionable", () => {
    const events = [PREPARE, ROUTE, INCIDENT, ROUTE, INCIDENT];
    const row = {
      moovin_incidents: countMoovinIncidents(events),
      moovin_route_attempts: countMoovinRouteAttempts(events),
    };
    expect(row.moovin_incidents).toBe(2);
    expect(row.moovin_route_attempts).toBe(2);
    expect(classifyIncident(row)).toBe("incident_unsolvable");
  });

  it("una sola incidencia tras un intento queda como solucionable", () => {
    const events = [PREPARE, ROUTE, INCIDENT];
    const row = {
      moovin_incidents: countMoovinIncidents(events),
      moovin_route_attempts: countMoovinRouteAttempts(events),
    };
    expect(row.moovin_incidents).toBe(1);
    expect(row.moovin_route_attempts).toBe(1);
    expect(classifyIncident(row)).toBe("incident_solvable");
  });
});
