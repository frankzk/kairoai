import { describe, expect, it } from "vitest";
import { getKpiWindows } from "../lib/kpi-windows";
const CR = "America/Costa_Rica";
const NOW = new Date("2026-11-06T15:30:45.250Z"); // 09:30 CR, 10:30 Lima
const iso = (n: number | null) =>
  n == null ? null : new Date(n).toISOString();
describe("comparativos de calendario a la misma hora", () => {
  it("Hoy compara hasta exactamente la misma hora de ayer, con segundos y milisegundos", () => {
    const w = getKpiWindows("today", NOW, undefined, CR);
    expect(iso(w.curStart)).toBe("2026-11-06T06:00:00.000Z");
    expect(iso(w.curEnd)).toBe("2026-11-06T15:30:45.250Z");
    expect(iso(w.prevStart)).toBe("2026-11-05T06:00:00.000Z");
    expect(iso(w.prevEnd)).toBe("2026-11-05T15:30:45.250Z");
    expect(w.cutoffLabel).toBe("Hasta las 09:30");
    expect(w.compareLabel).toContain("misma hora");
    expect(w.comparisonDetail).toContain(CR);
  });
  it.each([
    [
      "7d",
      "2026-10-31T06:00:00.000Z",
      "2026-10-24T06:00:00.000Z",
      "2026-10-30T15:30:45.250Z",
    ],
    [
      "30d",
      "2026-10-08T06:00:00.000Z",
      "2026-09-08T06:00:00.000Z",
      "2026-10-07T15:30:45.250Z",
    ],
  ] as const)(
    "%s conserva bloques completos de calendario y corta ambos a la misma hora",
    (range, start, prevStart, prevEnd) => {
      const w = getKpiWindows(range, NOW, undefined, CR);
      expect(iso(w.curStart)).toBe(start);
      expect(iso(w.prevStart)).toBe(prevStart);
      expect(iso(w.prevEnd)).toBe(prevEnd);
      expect(w.curEnd - w.curStart).toBe(w.prevEnd! - w.prevStart!);
    },
  );
  it("Mes usa mismo dia/hora del mes anterior y no se desborda al siguiente mes", () => {
    const w = getKpiWindows("month", NOW, undefined, CR);
    expect(iso(w.prevStart)).toBe("2026-10-01T06:00:00.000Z");
    expect(iso(w.prevEnd)).toBe("2026-10-06T15:30:45.250Z");
    const missing = getKpiWindows(
      "month",
      new Date("2026-03-31T15:30:00Z"),
      undefined,
      CR,
    );
    expect(missing.prevStart).toBeNull();
    expect(missing.prevEnd).toBeNull();
    expect(missing.compareLabel).toContain("sin día equivalente");
    expect(iso(missing.curEnd)).toBe("2026-03-31T15:30:00.000Z");
    expect(
      iso(
        getKpiWindows("month", new Date("2028-03-29T15:30:00Z"), undefined, CR)
          .prevEnd,
      ),
    ).toBe("2028-02-29T15:30:00.000Z");
  });
  it("un rango que incluye hoy se corta en ambos periodos, incluso si termina en el futuro", () => {
    const w = getKpiWindows(
      "custom",
      NOW,
      { start: "2026-11-01", end: "2026-11-06" },
      CR,
    );
    expect(iso(w.curEnd)).toBe(NOW.toISOString());
    expect(iso(w.prevStart)).toBe("2026-10-26T06:00:00.000Z");
    expect(iso(w.prevEnd)).toBe("2026-10-31T15:30:45.250Z");
    const week = getKpiWindows(
      "custom",
      NOW,
      { start: "2026-11-02", end: "2026-11-08" },
      CR,
    );
    expect(iso(week.prevStart)).toBe("2026-10-26T06:00:00.000Z");
    expect(iso(week.prevEnd)).toBe("2026-10-30T15:30:45.250Z");
    const future = getKpiWindows(
      "custom",
      NOW,
      { start: "2026-11-10", end: "2026-11-15" },
      CR,
    );
    expect(future.curEnd).toBe(future.curStart);
    expect(future.prevEnd).toBeNull();
  });
  it("ayer y rangos cerrados comparan dias completos", () => {
    const y = getKpiWindows("yesterday", NOW, undefined, CR);
    expect(iso(y.curEnd)).toBe("2026-11-06T06:00:00.000Z");
    expect(iso(y.prevEnd)).toBe("2026-11-05T06:00:00.000Z");
    expect(y.cutoffLabel).toBeUndefined();
    const w = getKpiWindows(
      "custom",
      NOW,
      { start: "2026-11-01", end: "2026-11-05" },
      CR,
    );
    expect(iso(w.curEnd)).toBe("2026-11-06T06:00:00.000Z");
    expect(iso(w.prevStart)).toBe("2026-10-27T06:00:00.000Z");
    expect(iso(w.prevEnd)).toBe("2026-11-01T06:00:00.000Z");
  });
  it("los cortes son de la tienda aunque UTC ya tenga otra fecha", () => {
    const w = getKpiWindows(
      "today",
      new Date("2026-11-07T03:15:00Z"),
      undefined,
      CR,
    );
    expect(iso(w.prevEnd)).toBe("2026-11-06T03:15:00.000Z");
    expect(iso(w.curStart)).toBe("2026-11-06T06:00:00.000Z");
    const h = getKpiWindows("today", NOW, undefined, "America/Tegucigalpa");
    expect(h.prevEnd).toBe(getKpiWindows("today", NOW, undefined, CR).prevEnd);
  });
  it("cambios DST comparan horas de pared, no segundos transcurridos desde medianoche", () => {
    const w = getKpiWindows(
      "today",
      new Date("2026-03-29T08:30:00Z"),
      undefined,
      "Europe/Rome",
    ); // 10:30 del dia de 23 h
    expect(iso(w.prevEnd)).toBe("2026-03-28T09:30:00.000Z");
    const m = getKpiWindows(
      "month",
      new Date("2026-03-30T08:30:00Z"),
      undefined,
      "Europe/Rome",
    );
    expect(m.prevEnd).toBeNull(); // febrero no tiene dia 30
    const valid = getKpiWindows(
      "month",
      new Date("2026-04-10T08:30:00Z"),
      undefined,
      "Europe/Rome",
    );
    expect(iso(valid.prevEnd)).toBe("2026-03-10T09:30:00.000Z");
    const absent = getKpiWindows(
      "today",
      new Date("2026-03-30T00:30:00Z"),
      undefined,
      "Europe/Rome",
    ); // ayer 02:30 no existio
    expect(absent.prevEnd).toBeNull();
    expect(absent.compareLabel).toContain("cambio horario");
  });
});
