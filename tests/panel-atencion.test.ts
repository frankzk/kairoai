import { describe, expect, it } from "vitest";
import {
  failureFromStatus,
  joinParts,
  PanelShapeError,
  summarizeDispatch,
  summarizeIncidents,
  summarizeLeads,
} from "../lib/panel-atencion";

describe("failureFromStatus", () => {
  it("401/403 es sin acceso; lo demas, no disponible", () => {
    expect(failureFromStatus(403)).toBe("sin_acceso");
    expect(failureFromStatus(401)).toBe("sin_acceso");
    expect(failureFromStatus(500)).toBe("no_disponible");
    expect(failureFromStatus(503)).toBe("no_disponible");
    expect(failureFromStatus(400)).toBe("no_disponible");
  });
});

describe("summarizeIncidents", () => {
  const counts = { pendiente: 12, reprogramada: 5, reprog_fallida: 2, sin_contestar: 7, no_llamar: 1, resuelta: 900, perdida: 80, descartada: 30 };

  it("usa el estado actual de las metricas cuando viene", () => {
    expect(summarizeIncidents({ counts, exec: { estado: { abiertas: 27, abiertas_48h: 9 } } })).toEqual({
      open: 27,
      unattended: 12,
      over48h: 9,
    });
  });

  it("sin metricas, suma los estados no terminales", () => {
    expect(summarizeIncidents({ counts, exec: null })).toEqual({ open: 27, unattended: 12, over48h: null });
  });

  it("una respuesta sin conteos no es un cero", () => {
    expect(() => summarizeIncidents({ incidents: [], error: "x" })).toThrow(PanelShapeError);
    expect(() => summarizeIncidents(null)).toThrow(PanelShapeError);
  });
});

describe("summarizeLeads", () => {
  it("cuenta los sin llamar como el tablero (work_state, o status_source)", () => {
    const json = {
      leads: [
        { work_state: "sin_llamar", segment: "carrito" },
        { work_state: "sin_llamar", segment: "converso" },
        { work_state: "seguimiento", segment: "carrito" },
        { status_source: "auto" },
        { status_source: "manual" },
        null,
      ],
    };
    expect(summarizeLeads(json)).toEqual({ uncalled: 3, uncalledWithCart: 1 });
  });

  it("sin lista es un error, no cero leads", () => {
    expect(() => summarizeLeads({ error: "x" })).toThrow(PanelShapeError);
  });
});

describe("summarizeDispatch", () => {
  it("lee las subetapas de despacho", () => {
    expect(
      summarizeDispatch({ dispatchCounts: { all: 14, por_solicitar: 6, esperando_guia: 5, esperando_recoleccion: 3 } })
    ).toEqual({ pending: 14, toRequest: 6, waitingGuide: 5, waitingPickup: 3 });
  });

  it("sin subetapas cae al conteo por estado", () => {
    expect(summarizeDispatch({ trackingCounts: { despacho_solicitado: 4 } })).toEqual({
      pending: 4,
      toRequest: 0,
      waitingGuide: 0,
      waitingPickup: 0,
    });
    expect(() => summarizeDispatch({ rows: [] })).toThrow(PanelShapeError);
  });
});

describe("joinParts", () => {
  it("omite las partes en cero", () => {
    expect(joinParts([[3, "por solicitar"], [0, "esperando guía"], [1200, "esperando recolección"]])).toBe(
      "3 por solicitar · 1200 esperando recolección".replace("1200", new Intl.NumberFormat("es-CR").format(1200))
    );
    expect(joinParts([[0, "x"]])).toBe("");
  });
});
