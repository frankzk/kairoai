// Lo que cambia en Kairo cuando Forza se lee con el historial completo: la
// novedad entra con el motivo de Forza, Gestion cuenta los intentos reales, y
// una devolucion deja de ser "Entregado". Ver tests/forza-historial.test.ts.

import { describe, expect, it } from "vitest";
import { interpretarHistorialForza } from "../lib/forza-historial";
import { detectForzaIncident, forzaCategory } from "../lib/incidents-detect";
import { countForzaIncidents, esDevolucionForza, forzaGroupToStatus } from "../lib/finance-orders";
import { courierYaNoReintenta } from "../lib/incidents-reprog";
import { forzaHitos, senalForza } from "../lib/forza-novedades";
import { syncForzaGuides, type ForzaSyncDeps } from "../lib/forza-sync";
import type { ForzaTracking } from "../lib/forza";
import type { ForzaTrackingRow } from "../lib/finance-types";
import type { ShopifyOrderSummary } from "../lib/finance-orders";

const NOW = "2026-10-16T22:00:00.000Z";

const hito = (date: string, stageId: number, title: string, description = title, clasification = "") => ({
  date,
  stageId,
  title,
  description,
  clasification,
});
const IDA = [
  hito("2026-10-15 15:06:18Z", 1, "Solicitado"),
  hito("2026-10-15 16:36:00Z", 2, "Recolectado"),
  hito("2026-10-16 04:26:40Z", 10, "En Inventario"),
  hito("2026-10-16 05:35:14Z", 4, "En ruta"),
];

function fila(milestones: ReturnType<typeof hito>[], over: Partial<ForzaTrackingRow> = {}): ForzaTrackingRow {
  const h = interpretarHistorialForza(milestones)!;
  return {
    store_id: 2,
    guide_number: "FD00000001",
    tracking_number: "FD00000001",
    latest_status: "",
    latest_code: "",
    latest_group: h.group,
    latest_at: (h.ultimaFalla ?? h.events[0]).date,
    has_incident: h.group === "failed",
    incident_reason: h.motivo,
    delivery_address: "",
    receiver_name: "",
    events: h.events,
    historial: true,
    checked_at: NOW,
    ...over,
  };
}

const pedido = (over: Partial<ShopifyOrderSummary> = {}) =>
  ({ id: "gid://shopify/Order/1", name: "#MIRH00001", created_at: "2026-10-15T12:00:00Z", cancelled_at: null, total_price: 890, phone: "", customer_name: "", ...over }) as ShopifyOrderSummary;

describe("forzaCategory: la causa sale del motivo de Forza", () => {
  it.each([
    ["Destinatario no localizado", "cliente_no_responde"],
    ["No hay nadie en destino", "cliente_no_responde"],
    ["Destinatario rechaza paquete · Forza: Paquete cumple con los intentos de entrega, se procede a devolución", "cliente_rechaza"],
    ["Tiempo en inventario excedido en Exc", "cliente_no_responde"],
    ["Datos de dirección de entrega incorrectos · Forza: Dest.Número de teléfono invalido", "direccion_incorrecta"],
    // El motivo no dice nada: manda la nota del call center.
    ["Destinatario solicita otra fecha de entrega · Forza: Destinatario no responde las llamadas. Se programa visita.", "cliente_no_responde"],
    ["Incidencias operativas · Forza: Su pedido ha sido reprogramado", "fallo_entrega"],
    ["Volvio a la bodega de Forza sin entregarse (Forza no registro el motivo)", "fallo_entrega"],
  ])("%s -> %s", (motivo, causa) => {
    expect(forzaCategory(motivo)).toBe(causa);
  });
});

describe("detectForzaIncident con el historial", () => {
  const conIncidencia = [
    ...IDA,
    hito("2026-10-16 08:07:35Z", 45, "Incidencia en ruta", "Destinatario no localizado", "Intento de entrega fallida"),
    hito("2026-10-16 12:59:14Z", 50, "Incidencia Validada", "Destinatario no responde las llamadas. se gestiona visita."),
  ];

  it("la incidencia entra el mismo dia, con el motivo de Forza (antes: dos dias despues, deducida)", () => {
    const c = detectForzaIncident(fila(conIncidencia), undefined, pedido(), NOW)!;
    expect(c).toMatchObject({
      source: "forza",
      category: "cliente_no_responde",
      detail: "Destinatario no localizado · Forza: Destinatario no responde las llamadas. se gestiona visita.",
      last_tracking_group: "failed",
      last_failure_at: "2026-10-16T14:07:35.000Z",
    });
  });

  it("un pedido de mas de 60 dias no abre novedad aunque tenga una incidencia", () => {
    expect(detectForzaIncident(fila(conIncidencia), undefined, pedido({ created_at: "2026-08-01T12:00:00Z" }), NOW)).toBeNull();
  });

  it("una guia anulada no es novedad", () => {
    const anulada = fila([hito("2026-10-15 15:06:18Z", 1, "Solicitado"), hito("2026-10-15 18:00:00Z", 7, "Anulado")]);
    expect(detectForzaIncident(anulada, undefined, pedido(), NOW)).toBeNull();
  });
});

describe("Gestion con el historial", () => {
  const devuelta = fila([
    ...IDA,
    hito("2026-10-16 08:07:35Z", 45, "Incidencia en ruta", "Destinatario no localizado"),
    hito("2026-10-16 12:59:14Z", 50, "Incidencia Validada", "Se gestiona devolución"),
    hito("2026-10-16 15:42:16Z", 8, "Paquete Retornado para Reproceso"),
    hito("2026-10-17 05:09:59Z", 4, "En ruta"),
    hito("2026-10-17 07:44:28Z", 45, "Incidencia en ruta", "Destinatario no localizado"),
    hito("2026-10-17 16:41:56Z", 8, "Paquete Retornado para Reproceso"),
    hito("2026-10-20 16:26:19Z", 14, "Devuelto"),
  ]);

  it("cuenta un intento por salida, no cada aviso de Forza", () => {
    expect(countForzaIncidents(devuelta.events)).toBe(2);
  });

  it("la devolucion es 'No entregado' y el anulado 'Anulado'", () => {
    expect(devuelta.latest_group).toBe("returned");
    expect(forzaGroupToStatus("returned")).toBe("not_delivered");
    expect(forzaGroupToStatus("cancelled")).toBe("annulled");
  });

  it("la regla del 'Entregado sin nombre' solo aplica a lo leido con los 5 hitos", () => {
    const entregada = fila([...IDA, hito("2026-10-16 13:04:12Z", 5, "Entregado", "")]);
    expect(entregada.latest_group).toBe("delivered");
    expect(esDevolucionForza(entregada)).toBe(false);
    expect(esDevolucionForza({ ...entregada, historial: false })).toBe(true);
  });
});

describe("nuevo envio con Forza", () => {
  // Con los intentos reales: 24 de 31 devoluciones tuvieron 3 o mas visitas.
  it("se cobra cuando Forza devuelve, no al segundo intento", () => {
    expect(courierYaNoReintenta("forza", 3, false)).toBe(false);
    expect(courierYaNoReintenta("forza", 2, true)).toBe(true);
  });
});

describe("las demoras siguen saliendo de los hitos", () => {
  it("forzaHitos lee las etapas del historial por su codigo", () => {
    const h = forzaHitos(fila(IDA).events);
    expect(h.creado).toBe(Date.parse("2026-10-15T21:06:18.000Z"));
    expect(h.ruta).toBe(Date.parse("2026-10-16T11:35:14.000Z"));
    expect(h.instalaciones).toBe(Date.parse("2026-10-16T10:26:40.000Z"));
  });

  it("una guia que Forza no recolecta en 48 horas sigue siendo demora", () => {
    const solicitada = fila([hito("2026-10-13 10:00:00Z", 1, "Solicitado")]);
    expect(senalForza(solicitada.events, "2026-10-13T12:00:00Z", NOW)?.category).toBe("demora_entrega");
  });
});

describe("syncForzaGuides con el historial", () => {
  it("no suma los intentos que Kairo dedujo antes: los del historial son los reales", async () => {
    const deducido = {
      code: "INTENTO_FALLIDO",
      group: "failed",
      title: "Intento de entrega fallido",
      description: "Salio a ruta el 16/10 y volvio a la bodega de Forza (deducido por Kairo)",
      date: "2026-10-17T16:41:56.000Z",
      note: "2026-10-16T05:35:14.000Z",
    };
    const h = interpretarHistorialForza([...IDA, hito("2026-10-16 08:07:35Z", 45, "Incidencia en ruta", "Destinatario no localizado")])!;
    const tracking: ForzaTracking = {
      ok: true,
      http_status: 200,
      guide_number: "FD00000001",
      tracking_number: "FD00000001",
      latest_status: "Intento de entrega fallido",
      latest_status_code: "INCIDENCIA_EN_RUTA",
      latest_group: "failed",
      latest_at: h.ultimaFalla!.date,
      delivery_address: "",
      receiver_name: "",
      has_incident: true,
      incident_reason: h.motivo,
      events: h.events,
      historial: true,
    };
    let guardado: ForzaTrackingRow["events"] = [];
    let marca: boolean | undefined;
    const deps: ForzaSyncDeps = {
      fetch: async () => tracking,
      save: async (rows) => {
        guardado = rows[0].events;
        marca = rows[0].historial;
      },
      previous: async () => new Map([["FD00000001", [deducido]]]),
    };
    await syncForzaGuides(["FD00000001"], 2, { now: NOW }, deps);
    expect(guardado.filter((e) => e.code === "INTENTO_FALLIDO")).toHaveLength(0);
    expect(guardado.filter((e) => e.group === "failed")).toHaveLength(1);
    expect(marca).toBe(true);
  });
});
