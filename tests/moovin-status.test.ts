import { describe, expect, it, vi } from "vitest";
import { moovinTransitPhase } from "../lib/moovin-status";

// Cada estado de Moovin cae en su bucket de tránsito según el mapeo acordado:
//   Despacho solicitado: Registrado · Por preparar · Recolección solicitada ·
//     Recolección programada a lo largo del día
//   Recolectado: Recolectado · Precoordinación confirmada · Preecoordinación
//     enviada · Sede de Moovin · En sede local
//   En ruta: Coordinado · En ruta para entregar a lo largo del día
describe("moovinTransitPhase — mapeo por título", () => {
  const cases: Array<[string, string | null]> = [
    ["Registrado", "despacho_solicitado"],
    ["Por preparar", "despacho_solicitado"],
    ["Recolección solicitada", "despacho_solicitado"],
    ["Recolección programada a lo largo del día", "despacho_solicitado"],
    ["Recolectado", "recolectado"],
    ["Precoordinación confirmada", "recolectado"],
    ["Preecoordinación enviada", "recolectado"],
    ["Sede de Moovin", "recolectado"],
    ["En sede local", "recolectado"],
    ["Coordinado", "en_route"],
    ["En ruta para entregar a lo largo del día", "en_route"],
  ];
  for (const [title, expected] of cases) {
    it(`"${title}" => ${expected}`, () => {
      expect(moovinTransitPhase({ latest_status: title, latest_group: "in_progress" })).toBe(expected);
    });
  }
});

describe("moovinTransitPhase — mapeo por código", () => {
  const cases: Array<[string, string]> = [
    ["PREPARE", "despacho_solicitado"],
    ["PICKUP", "despacho_solicitado"],
    ["INMOOVIN", "recolectado"],
    ["RECIEVEDDELEGATED", "recolectado"],
    ["COORDINATE", "en_route"],
    ["INROUTE", "en_route"],
  ];
  for (const [code, expected] of cases) {
    it(`${code} => ${expected}`, () => {
      expect(moovinTransitPhase({ latest_code: code, latest_group: "in_progress" })).toBe(expected);
    });
  }
});

describe("moovinTransitPhase — bordes de clasificación", () => {
  it("distingue 'Recolectado' (recolectado) de 'Recolección solicitada' (despacho)", () => {
    expect(moovinTransitPhase({ latest_status: "Recolectado" })).toBe("recolectado");
    expect(moovinTransitPhase({ latest_status: "Recolección solicitada" })).toBe("despacho_solicitado");
  });

  it("distingue 'Precoordinación' (recolectado) de 'Coordinado' (en_route)", () => {
    expect(moovinTransitPhase({ latest_status: "Precoordinación confirmada" })).toBe("recolectado");
    expect(moovinTransitPhase({ latest_status: "Coordinado" })).toBe("en_route");
  });

  it("estados finales / cancelados => null (los clasifica otra capa)", () => {
    expect(moovinTransitPhase({ latest_group: "delivered", latest_code: "DELIVERED" })).toBeNull();
    expect(moovinTransitPhase({ latest_group: "returned" })).toBeNull();
    expect(moovinTransitPhase({ latest_code: "CANCELED", latest_status: "Cancelado" })).toBeNull();
    expect(moovinTransitPhase({ latest_status: "Cancelado" })).toBeNull();
  });

  it("sin dato de estado => null", () => {
    expect(moovinTransitPhase({})).toBeNull();
    expect(moovinTransitPhase({ latest_group: "in_progress" })).toBeNull();
  });

  it("estado en tránsito no catalogado => en_route con warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(moovinTransitPhase({ latest_status: "Estado Rarísimo Nuevo", latest_group: "in_progress" })).toBe("en_route");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
