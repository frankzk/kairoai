import { describe, expect, it } from "vitest";
import { buildPanelSeries, dayKeysBetween, spanDays, type RowMetrics } from "../lib/panel-serie";
import { getKpiWindows } from "../lib/kpi-windows";

const TZ = "America/Costa_Rica"; // UTC-6, sin horario de verano

type Row = { shopify_created_at: string | null; m: RowMetrics };

const base: RowMetrics = { generated: 1, confirmed: 0, dispatched: 0, delivered: 0, annulled: 0, ticket: 0 };
const row = (iso: string | null, m: Partial<RowMetrics> = {}): Row => ({ shopify_created_at: iso, m: { ...base, ...m } });

describe("dayKeysBetween", () => {
  it("lista los dias de la tienda, sin el dia siguiente si termina a medianoche", () => {
    // 10/11 00:00 CR = 06:00Z; hasta 13/11 00:00 CR.
    const start = Date.parse("2026-11-10T06:00:00Z");
    const end = Date.parse("2026-11-13T06:00:00Z");
    expect(dayKeysBetween(start, end, TZ)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
  });

  it("un tramo parcial de hoy es un solo dia y un tramo vacio no tiene dias", () => {
    const start = Date.parse("2026-11-13T06:00:00Z");
    expect(dayKeysBetween(start, start + 3_600_000, TZ)).toEqual(["2026-11-13"]);
    expect(dayKeysBetween(start, start, TZ)).toEqual([]);
  });

  it("los 7 dias de getKpiWindows son 7 columnas", () => {
    const win = getKpiWindows("7d", new Date("2026-11-13T16:30:00Z"), undefined, TZ);
    const days = dayKeysBetween(win.curStart, win.curEnd, TZ);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-11-07");
    expect(days[6]).toBe("2026-11-13");
    expect(spanDays(win.curStart, win.curEnd)).toBe(7);
  });
});

describe("buildPanelSeries", () => {
  const win = {
    curStart: Date.parse("2026-11-11T06:00:00Z"),
    curEnd: Date.parse("2026-11-13T06:00:00Z"),
    prevStart: Date.parse("2026-11-09T06:00:00Z"),
    prevEnd: Date.parse("2026-11-11T06:00:00Z"),
  };

  it("reparte por dia de la tienda (no UTC) y suma el valor", () => {
    const rows = [
      // 11/11 23:30 CR = 12/11 05:30Z: es del 11 en la tienda.
      row("2026-11-12T05:30:00Z", { confirmed: 1, dispatched: 1, delivered: 1, ticket: 20000 }),
      row("2026-11-12T15:00:00Z", { confirmed: 1, ticket: 15000 }),
      row("2026-11-12T16:00:00Z", { annulled: 1, ticket: 10000 }),
    ];
    const s = buildPanelSeries(rows, win, TZ, (r) => r.m);
    expect(s.days.map((d) => d.date)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(s.days[0]).toMatchObject({ generated: 1, confirmed: 1, dispatched: 1, delivered: 1, value: 20000 });
    expect(s.days[1]).toMatchObject({ generated: 2, confirmed: 1, annulled: 1, value: 25000 });
    expect(s.current).toEqual({ generated: 3, valueOrders: 3, value: 45000, deliveredValue: 20000 });
  });

  it("los pedidos que no cuentan (generated 0) quedan fuera, igual que en los KPIs", () => {
    const rows = [row("2026-11-12T15:00:00Z", { generated: 0, annulled: 0, ticket: 9999 })];
    const s = buildPanelSeries(rows, win, TZ, (r) => r.m);
    expect(s.current).toEqual({ generated: 0, valueOrders: 0, value: 0, deliveredValue: 0 });
    expect(s.days.every((d) => d.generated === 0 && d.value === 0)).toBe(true);
  });

  it("el periodo anterior solo suma totales y respeta el limite exclusivo", () => {
    const rows = [
      row("2026-11-10T12:00:00Z", { ticket: 5000 }),
      row("2026-11-11T06:00:00Z", { ticket: 7000 }), // justo el inicio actual: es del actual
      row("2026-11-13T06:00:00Z", { ticket: 1 }), // fin exclusivo: fuera
      row(null),
      row("no es fecha"),
    ];
    const s = buildPanelSeries(rows, win, TZ, (r) => r.m);
    expect(s.previous).toEqual({ generated: 1, valueOrders: 1, value: 5000, deliveredValue: 0 });
    expect(s.current.generated).toBe(1);
    expect(s.days[0].value).toBe(7000);
  });

  it("sin ventana anterior no hay previous y no se piden metricas de filas ajenas", () => {
    let calls = 0;
    const rows = [row("2026-11-10T12:00:00Z"), row("2026-11-12T12:00:00Z")];
    const s = buildPanelSeries(rows, { ...win, prevStart: null, prevEnd: null }, TZ, (r) => {
      calls += 1;
      return r.m;
    });
    expect(s.previous).toBeNull();
    expect(calls).toBe(1);
  });

  it("un pedido sin monto cuenta como generado pero no en la base del ticket", () => {
    const s = buildPanelSeries([row("2026-11-12T12:00:00Z", { ticket: 0 })], win, TZ, (r) => r.m);
    expect(s.current).toEqual({ generated: 1, valueOrders: 0, value: 0, deliveredValue: 0 });
  });
});
