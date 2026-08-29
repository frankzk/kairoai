import { describe, expect, it } from "vitest";
import {
  buildTrend,
  dayKey,
  pctResueltas,
  startOfLocalToday,
  type BuildTrendInput,
} from "../lib/incidents-trend";

// Sabado 29/08/2026, 14:00 hora CR (UTC-6) = 20:00 UTC.
const AHORA = Date.parse("2026-08-29T20:00:00Z");
const enCR = (dia: string, hora = "12:00") => `${dia}T${hora}:00-06:00`;

function input(partial: Partial<BuildTrendInput> = {}): BuildTrendInput {
  return {
    created: [],
    resolved: [],
    reprogramadas: [],
    firstMgmt: [],
    nowMs: AHORA,
    days: 7,
    ...partial,
  };
}

describe("dayKey / startOfLocalToday", () => {
  it("agrupa por el dia LOCAL, no por el dia UTC", () => {
    // 29/08 20:00 CR son las 02:00 UTC del 30, pero sigue siendo el 29 en CR.
    expect(dayKey(Date.parse("2026-08-30T02:00:00Z"))).toBe("2026-08-29");
    expect(dayKey(Date.parse("2026-08-29T06:00:00Z"))).toBe("2026-08-29");
    // Un minuto antes ya es el dia anterior.
    expect(dayKey(Date.parse("2026-08-29T05:59:00Z"))).toBe("2026-08-28");
  });

  it("la medianoche local de hoy cae en el dia de hoy", () => {
    expect(dayKey(startOfLocalToday(AHORA))).toBe("2026-08-29");
  });
});

describe("buildTrend", () => {
  it("devuelve un punto por dia aunque no haya movimiento", () => {
    const serie = buildTrend(input());
    expect(serie).toHaveLength(7);
    expect(serie.map((d) => d.date)).toEqual([
      "2026-08-23",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
    ]);
    expect(serie.every((d) => d.generadas === 0)).toBe(true);
  });

  it("cuenta las nuevas en el dia en que nacieron", () => {
    const serie = buildTrend(
      input({
        created: [
          { created_at: enCR("2026-08-25", "09:00"), status: "pendiente" },
          { created_at: enCR("2026-08-25", "23:30"), status: "resuelta" },
          { created_at: enCR("2026-08-27"), status: "perdida" },
        ],
      })
    );
    const mar = serie.find((d) => d.date === "2026-08-25")!;
    expect(mar.generadas).toBe(2);
    expect(mar.resueltas_de_las_nuevas).toBe(1);
    expect(serie.find((d) => d.date === "2026-08-27")!.generadas).toBe(1);
  });

  it("separa los dos relojes: un dia puede tener 1 nueva y 2 resueltas", () => {
    // El caso que no se entendia en pantalla. Las 2 resueltas son paquetes
    // viejos entregados ese domingo; la nueva del domingo sigue abierta.
    const serie = buildTrend(
      input({
        created: [{ created_at: enCR("2026-08-23"), status: "pendiente" }],
        resolved: [
          { created_at: enCR("2026-08-23", "10:00") },
          { created_at: enCR("2026-08-23", "16:00") },
        ],
      })
    );
    const dom = serie.find((d) => d.date === "2026-08-23")!;
    expect(dom.generadas).toBe(1);
    expect(dom.resueltas).toBe(2);
    // El % mira SOLO la cohorte: la nueva del domingo no se entrego.
    expect(pctResueltas(dom.resueltas_de_las_nuevas, dom.generadas)).toBe(0);
  });

  it("la 1a gestion sale en las filas diarias, no solo en los totales", () => {
    // Esta es la que fallaba: los datos existian y la columna salia vacia.
    const nacio = Date.parse(enCR("2026-08-26", "08:00"));
    const serie = buildTrend(
      input({
        created: [{ created_at: enCR("2026-08-26", "08:00"), status: "pendiente" }],
        firstMgmt: [
          { createdMs: nacio, diffMs: 2 * 3_600_000 },
          { createdMs: nacio, diffMs: 4 * 3_600_000 },
        ],
      })
    );
    const mie = serie.find((d) => d.date === "2026-08-26")!;
    expect(mie.primera_gestion_horas).toBe(3);
    // Un dia sin llamadas queda en null, no en 0: son cosas distintas.
    expect(serie.find((d) => d.date === "2026-08-27")!.primera_gestion_horas).toBeNull();
  });

  it("agrupa la 1a gestion por el dia en que NACIO, no por el de la llamada", () => {
    const nacio = Date.parse(enCR("2026-08-24", "08:00"));
    const serie = buildTrend(
      input({
        // Llamada 48h despues: el dato pertenece al 24, no al 26.
        firstMgmt: [{ createdMs: nacio, diffMs: 48 * 3_600_000 }],
      })
    );
    expect(serie.find((d) => d.date === "2026-08-24")!.primera_gestion_horas).toBe(48);
    expect(serie.find((d) => d.date === "2026-08-26")!.primera_gestion_horas).toBeNull();
  });

  it("ignora fechas invalidas en vez de romper la serie", () => {
    const serie = buildTrend(
      input({
        created: [
          { created_at: "no es una fecha", status: "pendiente" },
          { created_at: enCR("2026-08-28"), status: "pendiente" },
        ],
      })
    );
    expect(serie.find((d) => d.date === "2026-08-28")!.generadas).toBe(1);
    expect(serie.reduce((a, d) => a + d.generadas, 0)).toBe(1);
  });
});

describe("pctResueltas", () => {
  it("nunca pasa de 100 ni divide por cero", () => {
    expect(pctResueltas(5, 45)).toBe(11);
    expect(pctResueltas(45, 45)).toBe(100);
    expect(pctResueltas(0, 0)).toBe(0);
    expect(pctResueltas(3, 0)).toBe(0);
  });
});
