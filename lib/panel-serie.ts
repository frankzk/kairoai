// Serie diaria del Panel (inicio): pedidos de la tienda por dia de creacion,
// con su estado de HOY, y el valor de los pedidos del periodo.
//
// Usa exactamente la misma regla que los KPIs de Gestion (/api/finance/kpis):
// la cohorte se agrupa por shopify_created_at en la hora de la tienda y cada
// fila pasa por computeOpMetricsFromTrackableRows. Aca se calcula fila por fila
// (los conteos de OpMetrics son sumables) para poder repartirlos por dia y
// sumar el valor de cada pedido: la suma de `generated` de los dias es la misma
// cifra que "Pedidos generados" de los KPIs, y los pedidos que no cuentan
// (duplicados, lista negra, testeos...) quedan fuera de los dos.
//
// Modulo puro (sin base ni red): lo usa la ruta /api/finance/kpis/daily y se
// prueba en tests/panel-serie.test.ts con una funcion de metricas falsa.

/** Lo unico que la serie necesita de OpMetrics (lib/finance-orders.ts). */
export interface RowMetrics {
  generated: number;
  confirmed: number;
  dispatched: number;
  delivered: number;
  annulled: number;
  /** Valor del pedido cuando es uno solo (ticket de una fila = su valor). */
  ticket: number;
}

export interface PanelDay {
  /** YYYY-MM-DD en la hora de la tienda. */
  date: string;
  generated: number;
  confirmed: number;
  dispatched: number;
  delivered: number;
  annulled: number;
  /** Valor de los pedidos generados ese dia (moneda de la tienda). */
  value: number;
}

export interface PanelTotals {
  generated: number;
  /** Pedidos generados con valor (> 0): la base del ticket promedio. */
  valueOrders: number;
  /** Valor de los pedidos generados (incluye los anulados, como el ticket). */
  value: number;
  /** Valor de los pedidos ya entregados. */
  deliveredValue: number;
}

export interface PanelSeriesWindow {
  curStart: number;
  curEnd: number;
  prevStart: number | null;
  prevEnd: number | null;
}

export interface PanelSeries {
  days: PanelDay[];
  current: PanelTotals;
  previous: PanelTotals | null;
}

const DAY = 86_400_000;

/** Dia YYYY-MM-DD de un instante en la zona (en-CA da el formato ISO). */
export function dayKeyIn(timeZone: string): (time: number) => string {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (time) => format.format(new Date(time));
}

/**
 * Dias de calendario (en la zona) que toca el tramo [start, end). Un tramo que
 * termina justo a medianoche no incluye el dia siguiente.
 */
export function dayKeysBetween(start: number, end: number, timeZone: string): string[] {
  if (!(end > start)) return [];
  const key = dayKeyIn(timeZone);
  const first = key(start);
  const last = key(end - 1);
  const out: string[] = [];
  const [y, m, d] = first.split("-").map(Number);
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push(day);
    if (day >= last) break;
  }
  return out;
}

function inWindow(value: string | null | undefined, start: number, end: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time >= start && time < end ? time : null;
}

function emptyTotals(): PanelTotals {
  return { generated: 0, valueOrders: 0, value: 0, deliveredValue: 0 };
}

function addTotals(totals: PanelTotals, m: RowMetrics): void {
  if (m.generated <= 0) return;
  totals.generated += m.generated;
  const value = Number(m.ticket) || 0;
  if (value > 0) {
    totals.valueOrders += 1;
    totals.value += value;
    if (m.delivered > 0) totals.deliveredValue += value;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundTotals(t: PanelTotals): PanelTotals {
  return { ...t, value: round2(t.value), deliveredValue: round2(t.deliveredValue) };
}

/**
 * Reparte las filas del periodo por dia y suma el periodo anterior (solo
 * totales). `metricsOf` recibe UNA fila: en la ruta es
 * computeOpMetricsFromTrackableRows([row], trazas).
 */
export function buildPanelSeries<Row extends { shopify_created_at: string | null }>(
  rows: Row[],
  window: PanelSeriesWindow,
  timeZone: string,
  metricsOf: (row: Row) => RowMetrics
): PanelSeries {
  const key = dayKeyIn(timeZone);
  const days = new Map<string, PanelDay>(
    dayKeysBetween(window.curStart, window.curEnd, timeZone).map((date) => [
      date,
      { date, generated: 0, confirmed: 0, dispatched: 0, delivered: 0, annulled: 0, value: 0 },
    ])
  );
  const current = emptyTotals();
  const hasPrevious = window.prevStart != null && window.prevEnd != null;
  const previous = hasPrevious ? emptyTotals() : null;

  for (const row of rows) {
    const curTime = inWindow(row.shopify_created_at, window.curStart, window.curEnd);
    const prevTime =
      curTime == null && hasPrevious
        ? inWindow(row.shopify_created_at, window.prevStart as number, window.prevEnd as number)
        : null;
    if (curTime == null && prevTime == null) continue;
    const m = metricsOf(row);
    if (prevTime != null && previous) {
      addTotals(previous, m);
      continue;
    }
    addTotals(current, m);
    if (m.generated <= 0 || curTime == null) continue;
    const day = days.get(key(curTime));
    if (!day) continue;
    day.generated += m.generated;
    day.confirmed += m.confirmed;
    day.dispatched += m.dispatched;
    day.delivered += m.delivered;
    day.annulled += m.annulled;
    if (m.ticket > 0) day.value += m.ticket;
  }

  return {
    days: Array.from(days.values()).map((d) => ({ ...d, value: round2(d.value) })),
    current: roundTotals(current),
    previous: previous ? roundTotals(previous) : null,
  };
}

/** Tope de dias de la serie (un rango mas largo se rechaza en la ruta). */
export const PANEL_SERIES_MAX_DAYS = 93;

/** Cantidad de dias de calendario de un tramo, para validar el tope. */
export function spanDays(start: number, end: number): number {
  return Math.ceil((end - start) / DAY);
}
