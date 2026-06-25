import { describe, expect, it } from "vitest";
import {
  classifyBoxfulStatusText,
  classifyIncident,
  countMoovinIncidents,
  countMoovinRouteAttempts,
  deriveMoovinGroup,
  getEffectiveTrackingStatus,
  getTrackingFilterFromStatus,
  getTrackingStatusLabel,
  isPendingLike,
  moovinGroupToStatus,
} from "../lib/order-tracking";

// Eventos crudos de Moovin (forma de MoovinTrackingRow["events"]).
const INCIDENT = { code: "FAILED", group: "failed", title: "Incidencia en la entrega", description: "", date: null, note: "" };
// Titulo real de Moovin: "entregar" (no "la entrega") y "dia" sin tilde.
const ROUTE = { code: "INROUTE", group: "in_progress", title: "En ruta para entregar a lo largo del dia", description: "", date: null, note: "" };
const PREPARE = { code: "PREPARE", group: "in_progress", title: "Por preparar", description: "", date: null, note: "" };

// Pedido Moovin minimo para la maquina de estados.
function moovinOrder(over: Record<string, unknown> = {}) {
  return {
    source: "shopify" as const,
    guide_number: "G1",
    boxful_status: "",
    internal_status: "pending",
    shopify_cancelled_at: null,
    shopify_financial_status: "paid",
    moovin_group: "in_progress",
    moovin_incidents: 0,
    moovin_route_attempts: 0,
    ...over,
  };
}

describe("countMoovinIncidents", () => {
  it("cuenta los eventos FAILED / 'incidencia en la entrega'", () => {
    expect(countMoovinIncidents([PREPARE, INCIDENT, ROUTE, INCIDENT])).toBe(2);
  });
  it("cuenta por titulo aunque el codigo no sea FAILED", () => {
    expect(countMoovinIncidents([{ ...PREPARE, code: "X", title: "Incidencia en la entrega" }])).toBe(1);
  });
  it("es 0 sin eventos", () => {
    expect(countMoovinIncidents(undefined)).toBe(0);
    expect(countMoovinIncidents([])).toBe(0);
  });
});

describe("countMoovinRouteAttempts", () => {
  it("cuenta cada salida a reparto 'a lo largo del dia'", () => {
    expect(countMoovinRouteAttempts([ROUTE, PREPARE, ROUTE, INCIDENT])).toBe(2);
  });
  it("tolera la variante con tilde y 'la entrega'", () => {
    expect(countMoovinRouteAttempts([{ ...ROUTE, title: "En ruta para la entrega a lo largo del día" }])).toBe(1);
  });
  it("no cuenta otros estados en ruta", () => {
    expect(countMoovinRouteAttempts([{ ...ROUTE, title: "En ruta a la bodega" }, INCIDENT])).toBe(0);
  });
});

describe("classifyIncident", () => {
  it("solucionable: a lo sumo una incidencia en la entrega", () => {
    expect(classifyIncident({ moovin_incidents: 1, moovin_route_attempts: 1 })).toBe("incident_solvable");
    expect(classifyIncident({ moovin_incidents: 1, moovin_route_attempts: 5 })).toBe("incident_solvable");
    expect(classifyIncident({ moovin_incidents: 0, moovin_route_attempts: 0 })).toBe("incident_solvable");
  });
  it("no solucionable: 2+ incidencias Y 2+ salidas a reparto", () => {
    expect(classifyIncident({ moovin_incidents: 2, moovin_route_attempts: 2 })).toBe("incident_unsolvable");
    expect(classifyIncident({ moovin_incidents: 3, moovin_route_attempts: 4 })).toBe("incident_unsolvable");
  });
  it("solucionable si falta cualquiera de las dos condiciones", () => {
    expect(classifyIncident({ moovin_incidents: 3, moovin_route_attempts: 1 })).toBe("incident_solvable");
    expect(classifyIncident({ moovin_incidents: 1, moovin_route_attempts: 3 })).toBe("incident_solvable");
  });
  it("solucionable sin datos de Moovin", () => {
    expect(classifyIncident(undefined)).toBe("incident_solvable");
  });
});

describe("getTrackingFilterFromStatus", () => {
  it("divide la incidencia segun la fila", () => {
    expect(getTrackingFilterFromStatus("incident", { moovin_incidents: 1, moovin_route_attempts: 1 })).toBe("incident_solvable");
    expect(getTrackingFilterFromStatus("incident", { moovin_incidents: 2, moovin_route_attempts: 2 })).toBe("incident_unsolvable");
  });
  it("incidencia sin fila cae en solucionable", () => {
    expect(getTrackingFilterFromStatus("incident")).toBe("incident_solvable");
  });
  it("mapea el resto de estados", () => {
    expect(getTrackingFilterFromStatus("returned")).toBe("not_delivered");
    expect(getTrackingFilterFromStatus("en_route_retry")).toBe("en_route_retry");
    expect(getTrackingFilterFromStatus("delivered")).toBe("delivered");
  });
});

describe("getEffectiveTrackingStatus", () => {
  it("Moovin manda: grupo failed => incident", () => {
    expect(getEffectiveTrackingStatus(moovinOrder({ moovin_group: "failed" }), [])).toBe("incident");
  });
  it("en ruta con 1+ incidencia => reintento", () => {
    expect(getEffectiveTrackingStatus(moovinOrder({ moovin_group: "in_progress", moovin_incidents: 1 }), [])).toBe("en_route_retry");
  });
  it("en ruta sin incidencias => en_route", () => {
    expect(getEffectiveTrackingStatus(moovinOrder({ moovin_group: "in_progress", moovin_incidents: 0 }), [])).toBe("en_route");
  });
  it("sin Moovin ni guia y cancelado en Shopify => annulled", () => {
    const row = moovinOrder({ moovin_group: undefined, guide_number: "", shopify_cancelled_at: "2026-06-01", source: "shopify" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("annulled");
  });
  it("sin Moovin pero con guia => en_route", () => {
    const row = moovinOrder({ moovin_group: undefined, guide_number: "G9" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("en_route");
  });

  // Reclasificacion por el texto del estado de Boxful (columna "Estado"/M): los
  // estados que NO son transito salen del cajon de sastre "En ruta".
  it("Boxful 'Guía cancelada' => annulled", () => {
    const row = moovinOrder({ moovin_group: undefined, source: "boxful", guide_number: "G1", boxful_status: "Guía cancelada" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("annulled");
  });
  it("Boxful 'Problemas en gestión' => incidencia (solucionable)", () => {
    const row = moovinOrder({ moovin_group: undefined, source: "boxful", guide_number: "G1", boxful_status: "Problemas en gestión" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("incident");
    expect(getTrackingFilterFromStatus("incident", row)).toBe("incident_solvable");
  });
  it("Boxful 'Recolectado' => recolectado (no en_route)", () => {
    const row = moovinOrder({ moovin_group: undefined, source: "boxful", guide_number: "G1", boxful_status: "Recolectado" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("recolectado");
  });
  it("Boxful 'En ruta a destino' => en_route", () => {
    const row = moovinOrder({ moovin_group: undefined, source: "boxful", guide_number: "G1", boxful_status: "En ruta a destino" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("en_route");
  });
  it("Boxful 'Registrado' => pending (guía creada, sin recolectar)", () => {
    const row = moovinOrder({ moovin_group: undefined, source: "boxful", guide_number: "G1", boxful_status: "Registrado" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("pending");
  });

  // Una senal terminal/cancelada/incidencia le gana a un "in_progress" viejo de
  // Moovin (cache que no se actualizo tras la entrega/devolucion/liquidacion).
  it("Moovin in_progress viejo + interno 'no entregado' => not_delivered", () => {
    const row = moovinOrder({ moovin_group: "in_progress", internal_status: "not_delivered", boxful_status: "No entregado" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("not_delivered");
  });
  it("Moovin in_progress viejo + Boxful 'Guía cancelada' => annulled", () => {
    const row = moovinOrder({ moovin_group: "in_progress", boxful_status: "Guía cancelada" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("annulled");
  });
  it("Moovin in_progress + Boxful 'Recolectado' => recolectado (dato mas granular)", () => {
    const row = moovinOrder({ moovin_group: "in_progress", boxful_status: "Recolectado" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("recolectado");
  });
  it("liquidacion entregada le gana a un in_progress viejo de Moovin", () => {
    const row = moovinOrder({ moovin_group: "in_progress" });
    const traces = [{ settlement_status: "Entregado", internal_status: "delivered" }];
    expect(getEffectiveTrackingStatus(row, traces)).toBe("delivered");
  });
  it("reintento de Moovin manda sobre un 'Recolectado' viejo de Boxful", () => {
    const row = moovinOrder({ moovin_group: "in_progress", moovin_incidents: 1, boxful_status: "Recolectado" });
    expect(getEffectiveTrackingStatus(row, [])).toBe("en_route_retry");
  });
});

describe("getTrackingStatusLabel", () => {
  const base = { internal_status: "pending", boxful_status: "" };
  it("etiqueta la incidencia segun la clasificacion", () => {
    expect(getTrackingStatusLabel({ ...base, moovin_incidents: 1, moovin_route_attempts: 1 }, [], "incident")).toBe("Incidencia solucionable");
    expect(getTrackingStatusLabel({ ...base, moovin_incidents: 2, moovin_route_attempts: 2 }, [], "incident")).toBe("Incidencia no solucionable");
  });
  it("reintento muestra el conteo cuando hay 2+ incidencias", () => {
    expect(getTrackingStatusLabel({ ...base, moovin_incidents: 3, moovin_route_attempts: 0 }, [], "en_route_retry")).toBe("Reintento (3)");
  });
});

describe("moovinGroupToStatus / isPendingLike / deriveMoovinGroup", () => {
  it("mapea grupos de Moovin", () => {
    expect(moovinGroupToStatus("failed")).toBe("incident");
    expect(moovinGroupToStatus("returned")).toBe("not_delivered");
    expect(moovinGroupToStatus(undefined)).toBe("");
  });
  it("ambas incidencias cuentan como pendiente operativo", () => {
    expect(isPendingLike("incident")).toBe(true);
    expect(isPendingLike("delivered")).toBe(false);
  });
  it("deriveMoovinGroup rescata cancelaciones e incidencias del cache", () => {
    expect(deriveMoovinGroup({ latest_code: "CANCELED", latest_status: "Cancelado", latest_group: "in_progress", has_incident: false } as never)).toBe("returned");
    expect(deriveMoovinGroup({ latest_code: "INROUTE", latest_status: "En ruta", latest_group: "in_progress", has_incident: true } as never)).toBe("failed");
  });
});

describe("clasificacion de extremo a extremo", () => {
  it("una entrega que fallo varias veces queda como no solucionable", () => {
    const events = [PREPARE, ROUTE, INCIDENT, ROUTE, INCIDENT];
    const row = {
      moovin_incidents: countMoovinIncidents(events),
      moovin_route_attempts: countMoovinRouteAttempts(events),
    };
    expect(row).toEqual({ moovin_incidents: 2, moovin_route_attempts: 2 });
    expect(classifyIncident(row)).toBe("incident_unsolvable");
  });
  it("una sola incidencia tras un intento queda como solucionable", () => {
    const events = [PREPARE, ROUTE, INCIDENT];
    const row = {
      moovin_incidents: countMoovinIncidents(events),
      moovin_route_attempts: countMoovinRouteAttempts(events),
    };
    expect(row).toEqual({ moovin_incidents: 1, moovin_route_attempts: 1 });
    expect(classifyIncident(row)).toBe("incident_solvable");
  });
});

describe("classifyBoxfulStatusText", () => {
  it("mapea los estados de la columna 'Estado' de Boxful", () => {
    expect(classifyBoxfulStatusText("Entregado")).toBe("delivered");
    expect(classifyBoxfulStatusText("No entregado")).toBe("not_delivered");
    expect(classifyBoxfulStatusText("Guía cancelada")).toBe("annulled");
    expect(classifyBoxfulStatusText("Problemas en gestión")).toBe("incident");
    expect(classifyBoxfulStatusText("Recolectado")).toBe("recolectado");
    expect(classifyBoxfulStatusText("En ruta a destino")).toBe("en_route");
    expect(classifyBoxfulStatusText("Registrado")).toBe("pending");
  });
  it("tolera mayúsculas y la variante sin tilde ('gestion', 'Guia')", () => {
    expect(classifyBoxfulStatusText("PROBLEMAS EN GESTION")).toBe("incident");
    expect(classifyBoxfulStatusText("Guia cancelada")).toBe("annulled");
  });
  it("texto vacío o desconocido => '' (cae a las otras señales)", () => {
    expect(classifyBoxfulStatusText("")).toBe("");
    expect(classifyBoxfulStatusText("Algo raro")).toBe("");
  });
});

describe("recolectado como estado propio", () => {
  it("getTrackingFilterFromStatus mapea recolectado a su filtro", () => {
    expect(getTrackingFilterFromStatus("recolectado")).toBe("recolectado");
  });
  it("recolectado cuenta como pendiente operativo (transito activo)", () => {
    expect(isPendingLike("recolectado")).toBe(true);
  });
  it("la etiqueta usa el texto de Boxful o 'Recolectado' por defecto", () => {
    expect(
      getTrackingStatusLabel({ internal_status: "pending", boxful_status: "Recolectado" }, [], "recolectado")
    ).toBe("Recolectado");
    expect(
      getTrackingStatusLabel({ internal_status: "pending", boxful_status: "" }, [], "recolectado")
    ).toBe("Recolectado");
  });
});
