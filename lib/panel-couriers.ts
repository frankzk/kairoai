// Comparativo de transportadoras del Panel: por courier, los pedidos que
// despacho en el periodo y como estan hoy (entregados, en camino, con
// incidencia, no entregados), con la entrega efectiva sobre despachados y
// sobre los ya resueltos (para comparar couriers con distinto volumen en
// camino). Sale de courierPerformance de /api/finance/kpis.
//
// Puro: se prueba en tests/panel-couriers.test.ts.

export const COURIER_PARTS = [
  { key: "delivered", label: "Entregados", color: "var(--mk-series-1)" },
  { key: "enCamino", label: "En camino", color: "var(--mk-series-2)" },
  { key: "incidencia", label: "Con incidencia", color: "var(--mk-series-3)" },
  { key: "notDelivered", label: "No entregados", color: "var(--mk-series-4)" },
] as const;

export type CourierPartKey = (typeof COURIER_PARTS)[number]["key"];

export interface CourierComparisonRow {
  id: string;
  label: string;
  dispatched: number;
  parts: Record<CourierPartKey, number>;
  /** Entregados / despachados (%). */
  rate: number | null;
  /** Entregados / (entregados + no entregados) (%): sin lo que sigue en camino. */
  resolvedRate: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const pct = (part: number, base: number) => (base > 0 ? Math.round((part / base) * 1000) / 10 : null);

/** Filas del comparativo, de mayor a menor volumen despachado. Ignora couriers sin despachos. */
export function buildCourierComparison(report: unknown): CourierComparisonRow[] {
  if (!isRecord(report) || !Array.isArray(report.rows)) return [];
  return (report.rows as unknown[])
    .filter(isRecord)
    .map((r) => {
      const dispatched = num(r.dispatched);
      const delivered = Math.min(num(r.delivered), dispatched);
      const notDelivered = Math.min(num(r.notDelivered), dispatched - delivered);
      const counts = isRecord(r.statusCounts) ? r.statusCounts : {};
      const incidencia = Math.min(num(counts.incident_solvable) + num(counts.incident_unsolvable), dispatched - delivered - notDelivered);
      const enCamino = Math.max(0, dispatched - delivered - notDelivered - incidencia);
      return {
        id: String(r.id ?? r.label ?? ""),
        label: String(r.label ?? r.id ?? "Sin nombre"),
        dispatched,
        parts: { delivered, enCamino, incidencia, notDelivered },
        rate: pct(delivered, dispatched),
        resolvedRate: pct(delivered, delivered + notDelivered),
      };
    })
    .filter((r) => r.dispatched > 0)
    .sort((a, b) => b.dispatched - a.dispatched || a.label.localeCompare(b.label));
}

/** Ancho (%) de cada parte en su barra 100 %. */
export function partWidths(row: CourierComparisonRow): Record<CourierPartKey, number> {
  const out = {} as Record<CourierPartKey, number>;
  for (const p of COURIER_PARTS) out[p.key] = row.dispatched ? (row.parts[p.key] / row.dispatched) * 100 : 0;
  return out;
}
