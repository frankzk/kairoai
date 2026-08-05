import { describe, expect, it } from "vitest";

import {
  FORZA_PREPARE_CODE,
  getForzaPrepareAt,
  getMoovinPrepareAt,
  getPreparedAt,
  MOOVIN_PREPARE_CODE,
} from "../lib/finance-orders";

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

describe("getForzaPrepareAt", () => {
  // Forza guarda una plantilla fija de 5 eventos: los no alcanzados vienen con
  // date=null. Este es el shape real de una guia en transito.
  const forzaEvents = [
    { code: FORZA_PREPARE_CODE, date: "2026-01-14T08:46:53.000Z" },
    { code: "RECIBIDO_POR_FORZA", date: "2026-01-14T15:02:10.000Z" },
    { code: "EN_INSTALACIONES", date: "2026-01-15T09:00:00.000Z" },
    { code: "EN_RUTA", date: null },
    { code: "ENTREGADO", date: null },
  ];

  it("devuelve la fecha del evento CREADO", () => {
    expect(getForzaPrepareAt(forzaEvents)).toBe("2026-01-14T08:46:53.000Z");
  });

  it("no confunde el ciclo de Moovin con el de Forza", () => {
    expect(getForzaPrepareAt([{ code: "PREPARE", date: "2026-07-29T00:11:40Z" }])).toBeNull();
    expect(getMoovinPrepareAt(forzaEvents)).toBeNull();
  });

  it("devuelve null si CREADO todavia no tiene fecha", () => {
    expect(getForzaPrepareAt([{ code: FORZA_PREPARE_CODE, date: null }])).toBeNull();
  });
});

describe("getPreparedAt", () => {
  it("resuelve la guia de Moovin (CR)", () => {
    expect(getPreparedAt([{ code: "PREPARE", date: "2026-07-29T00:11:40Z" }], undefined)).toBe(
      "2026-07-29T00:11:40Z"
    );
  });

  it("resuelve la guia de Forza (HN), que antes salia vacia", () => {
    expect(getPreparedAt(undefined, [{ code: "CREADO", date: "2026-01-14T08:46:53.000Z" }])).toBe(
      "2026-01-14T08:46:53.000Z"
    );
  });

  it("si por algun motivo llegaran ambos, gana el mas antiguo", () => {
    expect(
      getPreparedAt(
        [{ code: "PREPARE", date: "2026-07-29T00:11:40Z" }],
        [{ code: "CREADO", date: "2026-07-28T08:00:00Z" }]
      )
    ).toBe("2026-07-28T08:00:00Z");
  });

  it("null cuando ningun courier tiene tracking consultado", () => {
    expect(getPreparedAt(undefined, undefined)).toBeNull();
    expect(getPreparedAt([], [])).toBeNull();
  });
});
