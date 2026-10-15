// Moovin a veces revierte una entrega: marca "Entregado" y despues el paquete
// vuelve a la sede, hay una incidencia y la guia termina "Cancelado". Paso con
// 8 guias entre marzo y julio (ver la migracion 0037). Y a veces manda un AVISO
// despues de entregar ("Preecoordinacion enviada" a 25 paquetes el 01/06), que
// no mueve el paquete ni revierte nada.
//
// Se prueba de punta a punta lo que guarda la sincronizacion: fetchMoovinTracking
// con la respuesta del Server Action simulada.

import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveLatestMoovinEvent, fetchMoovinTracking, parseMoovinResponse } from "../lib/moovin";

type Evento = [date: string, status: string, title: string];

function respuesta(eventos: Evento[]): string {
  const listStatus = eventos.map(([date, status, title]) => ({ date, status, title, description: "", comments: [] }));
  return `1:${JSON.stringify({ serialNumber: "x", listStatus })}\n`;
}

function simularMoovin(eventos: Evento[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(respuesta(eventos), { status: 200 })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Historial real de la guia 2542452 (#MCRC12618), del mas viejo al mas nuevo.
const ENTREGADO: Evento = ["2026-06-26T22:52:00Z", "DELIVERED", "Entregado por el Moover"];
const REVERSION: Evento[] = [
  ["2026-06-26T23:08:38Z", "INMOOVIN", "Sede de Moovin"],
  ["2026-06-26T23:16:14Z", "INROUTE", "En ruta para entregar a lo largo del día"],
  ["2026-06-26T23:17:31Z", "FAILED", "Incidencia en la entrega"],
];
const CANCELADO: Evento = ["2026-06-26T23:21:03Z", "CANCEL", "Cancelado"];
const AVISO: Evento = ["2026-06-01T15:00:00Z", "PRECOORDINATIONSEND", "Preecoordinación enviada"];

describe("entrega revertida por Moovin", () => {
  it("termina como no entregada, con la fecha de la cancelacion", async () => {
    simularMoovin([ENTREGADO, ...REVERSION, CANCELADO]);
    const t = await fetchMoovinTracking("2542452", "Perez");
    expect(t.latest_status).toBe("Cancelado");
    expect(t.latest_group).toBe("returned");
    expect(t.latest_at).toBe("2026-06-26T23:21:03Z");
    expect(t.has_incident).toBe(false);
  });

  it("leida en medio de la reversion es una incidencia activa, no una entrega", async () => {
    simularMoovin([ENTREGADO, ...REVERSION]);
    const t = await fetchMoovinTracking("2542452", "Perez");
    expect(t.latest_group).toBe("failed");
    expect(t.has_incident).toBe(true);
  });
});

describe("aviso posterior a la entrega", () => {
  const entregadoAntes: Evento = ["2026-05-30T20:00:00Z", "DELIVERED", "Entregado por el Moover"];

  it("no revierte la entrega", async () => {
    simularMoovin([entregadoAntes, AVISO]);
    const t = await fetchMoovinTracking("2500000", "Perez");
    expect(t.latest_status).toBe("Entregado por el Moover");
    expect(t.latest_group).toBe("delivered");
    // La fecha es la de la entrega: de ella se cuenta la segunda lectura.
    expect(t.latest_at).toBe("2026-05-30T20:00:00Z");
    expect(t.has_incident).toBe(false);
  });

  it("tampoco la revierte el mensaje de campana", () => {
    const { events } = parseMoovinResponse(
      respuesta([entregadoAntes, ["2026-06-02T10:00:00Z", "CAMPAIGNMESSAGE", "Mensaje de Campaña enviado "]])
    )!;
    expect(effectiveLatestMoovinEvent(events)?.code).toBe("DELIVERED");
  });

  it("no tapa un movimiento real que vino despues de la entrega", () => {
    const { events } = parseMoovinResponse(
      respuesta([entregadoAntes, ["2026-05-31T09:00:00Z", "INMOOVIN", "Sede de Moovin"], AVISO])
    )!;
    expect(effectiveLatestMoovinEvent(events)?.code).toBe("INMOOVIN");
  });
});

describe("sin entrega", () => {
  it("el estado es el evento mas reciente, aunque sea un aviso", () => {
    const { events } = parseMoovinResponse(
      respuesta([["2026-05-31T09:00:00Z", "INMOOVIN", "Sede de Moovin"], AVISO])
    )!;
    expect(effectiveLatestMoovinEvent(events)?.code).toBe("PRECOORDINATIONSEND");
  });

  it("sin eventos no hay estado", () => {
    expect(effectiveLatestMoovinEvent([])).toBeNull();
  });
});
