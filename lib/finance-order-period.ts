import type { TrackableOrderRow } from "./finance-orders";

export type OrderPeriodMode = "all" | "month" | "range" | "today" | "7d" | "30d";

// Dia (YYYY-MM-DD) en la hora de la TIENDA, igual que los KPIs de Gestion
// (getKpiWindows con store.timezone). Antes se cortaba en UTC: un pedido de
// las 7 p. m. del 03 en Costa Rica caia el 04 aca y el 03 en Gestion.
export function dayKeyFormatter(timeZone: string): (time: number) => string {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (time) => format.format(new Date(time));
}

export function shiftDayKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Replica matchesOrderPeriod para los modos del tab Pedidos, y resuelve
// today/7d/30d como dias completos de la tienda (incluye hoy).
export function matchesPeriod(
  row: TrackableOrderRow,
  mode: OrderPeriodMode,
  month: string,
  startDate: string,
  endDate: string,
  now: Date,
  dayKey: (time: number) => string
): boolean {
  if (mode === "all") return true;
  const ts = row.shopify_created_at ? Date.parse(row.shopify_created_at) : NaN;
  if (Number.isNaN(ts)) return false;
  const orderDate = dayKey(ts);

  if (mode === "month") {
    if (!month) return true;
    return orderDate.slice(0, 7) === month;
  }

  if (mode === "range") {
    if (startDate && orderDate < startDate) return false;
    if (endDate && orderDate > endDate) return false;
    return true;
  }

  const today = dayKey(now.getTime());
  if (mode === "today") return orderDate === today;
  const days = mode === "7d" ? 7 : 30;
  return orderDate >= shiftDayKey(today, -(days - 1)) && orderDate <= today;
}
