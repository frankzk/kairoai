import { describe, expect, it } from "vitest";
import { getKpiWindows } from "@/lib/finance-orders";

const DAY = 24 * 60 * 60 * 1000;
// Momento fijo: 2026-07-13 15:30 local.
const NOW = new Date(2026, 6, 13, 15, 30, 0);
const DAY_START = new Date(2026, 6, 13).getTime();

describe("getKpiWindows — Ayer", () => {
  it("cubre el dia de ayer completo y compara contra anteayer", () => {
    const win = getKpiWindows("yesterday", NOW);
    expect(win.curStart).toBe(DAY_START - DAY);
    expect(win.curEnd).toBe(DAY_START); // fin exclusivo = hoy 00:00
    expect(win.prevStart).toBe(DAY_START - 2 * DAY);
    expect(win.prevEnd).toBe(DAY_START - DAY);
    expect(win.rangeLabel).toBe("Ayer");
    expect(win.compareLabel).toBe("vs. anteayer");
    expect(win.maturing).toBe(true);
  });

  it("no se solapa con Hoy", () => {
    const yesterday = getKpiWindows("yesterday", NOW);
    const today = getKpiWindows("today", NOW);
    expect(yesterday.curEnd).toBe(today.curStart);
  });
});

describe("getKpiWindows — rango custom", () => {
  it("ventana inclusiva del desde y del hasta, con previa del mismo largo", () => {
    const win = getKpiWindows("custom", NOW, { start: "2026-07-01", end: "2026-07-07" });
    const start = new Date(2026, 6, 1).getTime();
    const end = new Date(2026, 6, 8).getTime(); // 7 de julio completo (fin exclusivo)
    expect(win.curStart).toBe(start);
    expect(win.curEnd).toBe(end);
    const span = end - start;
    expect(span).toBe(7 * DAY);
    expect(win.prevStart).toBe(start - span);
    expect(win.prevEnd).toBe(start);
    expect(win.rangeLabel).toBe("01/07/2026 – 07/07/2026");
  });

  it("un solo dia funciona (start == end)", () => {
    const win = getKpiWindows("custom", NOW, { start: "2026-07-10", end: "2026-07-10" });
    expect(win.curEnd - win.curStart).toBe(DAY);
  });

  it("madura solo cuando el rango termina hace poco", () => {
    const recent = getKpiWindows("custom", NOW, { start: "2026-07-10", end: "2026-07-12" });
    expect(recent.maturing).toBe(true);
    const old = getKpiWindows("custom", NOW, { start: "2026-05-01", end: "2026-05-31" });
    expect(old.maturing).toBe(false);
  });

  it("rango invalido o incompleto cae a Todo (red de seguridad)", () => {
    for (const custom of [
      undefined,
      {},
      { start: "2026-07-01" },
      { start: "07/01/2026", end: "2026-07-07" },
      { start: "2026-07-08", end: "2026-07-01" }, // invertido
    ]) {
      const win = getKpiWindows("custom", NOW, custom);
      expect(win.rangeLabel).toBe("Todo el histórico");
      expect(win.prevStart).toBeNull();
    }
  });
});

// El 04/11/2026 "Ayer" de Gestión daba 98 pedidos y iComfly 128: el servidor
// (UTC en Vercel) cortaba los días a las 6 p. m. de Costa Rica.
describe("getKpiWindows — días en la hora de la tienda", () => {
  const CR = "America/Costa_Rica";
  // 2026-11-04 01:00 UTC = 2026-11-03 19:00 en Costa Rica.
  const noche = new Date("2026-11-04T01:00:00Z");
  it("Hoy y Ayer empiezan a la medianoche de Costa Rica (06:00 UTC)", () => {
    const hoy = getKpiWindows("today", noche, undefined, CR);
    expect(new Date(hoy.curStart).toISOString()).toBe("2026-11-03T06:00:00.000Z");
    const ayer = getKpiWindows("yesterday", noche, undefined, CR);
    expect(new Date(ayer.curStart).toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(new Date(ayer.curEnd).toISOString()).toBe("2026-11-03T06:00:00.000Z");
  });
  it("rango y mes también en la hora de la tienda", () => {
    const win = getKpiWindows("custom", noche, { start: "2026-11-03", end: "2026-11-03" }, CR);
    expect(new Date(win.curStart).toISOString()).toBe("2026-11-03T06:00:00.000Z");
    expect(new Date(win.curEnd).toISOString()).toBe("2026-11-04T06:00:00.000Z");
    const mes = getKpiWindows("month", noche, undefined, CR);
    expect(new Date(mes.curStart).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(new Date(mes.prevStart!).toISOString()).toBe("2026-10-01T06:00:00.000Z");
    // Enero: el mes anterior es diciembre del año anterior.
    const enero = getKpiWindows("month", new Date("2027-01-10T12:00:00Z"), undefined, CR);
    expect(new Date(enero.prevStart!).toISOString()).toBe("2026-12-01T06:00:00.000Z");
  });
});
