import { describe, expect, it } from "vitest";

import { getMoovinPrepareAt, MOOVIN_PREPARE_CODE } from "../lib/finance-orders";

describe("getMoovinPrepareAt", () => {
  it("devuelve la fecha del evento PREPARE", () => {
    const events = [
      { code: "INMOOVIN", date: "2026-07-30T09:29:00Z" },
      { code: "COLLECTPICKUP", date: "2026-07-29T14:54:00Z" },
      { code: MOOVIN_PREPARE_CODE, date: "2026-07-29T00:11:40Z" },
    ];
    expect(getMoovinPrepareAt(events)).toBe("2026-07-29T00:11:40Z");
  });

  it("no depende del orden del arreglo", () => {
    const events = [
      { code: "PREPARE", date: "2026-07-29T00:11:40Z" },
      { code: "INROUTE", date: "2026-07-30T12:00:00Z" },
    ];
    expect(getMoovinPrepareAt(events)).toBe("2026-07-29T00:11:40Z");
  });

  it("con varios PREPARE toma el mas antiguo (el ingreso real)", () => {
    const events = [
      { code: "PREPARE", date: "2026-07-30T10:00:00Z" },
      { code: "PREPARE", date: "2026-07-28T19:11:00Z" },
    ];
    expect(getMoovinPrepareAt(events)).toBe("2026-07-28T19:11:00Z");
  });

  it("devuelve null si la guia no tiene el evento", () => {
    expect(getMoovinPrepareAt([{ code: "INMOOVIN", date: "2026-07-30T09:29:00Z" }])).toBeNull();
  });

  it("tolera eventos sin fecha o con fecha invalida", () => {
    expect(getMoovinPrepareAt([{ code: "PREPARE", date: null }])).toBeNull();
    expect(getMoovinPrepareAt([{ code: "PREPARE", date: "no-es-fecha" }])).toBeNull();
    // Con uno invalido y otro valido, gana el valido.
    expect(
      getMoovinPrepareAt([
        { code: "PREPARE", date: "no-es-fecha" },
        { code: "PREPARE", date: "2026-07-28T19:11:00Z" },
      ])
    ).toBe("2026-07-28T19:11:00Z");
  });

  it("tolera events nulo, indefinido o no-arreglo", () => {
    expect(getMoovinPrepareAt(null)).toBeNull();
    expect(getMoovinPrepareAt(undefined)).toBeNull();
    expect(getMoovinPrepareAt([])).toBeNull();
  });
});
