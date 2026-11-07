import { activityAgo, presenceStatus } from "@/lib/leads-presence";
import type { ConnectedProductivityRow } from "@/lib/leads-productivity-presence";

const STATES = {
  active: { label: "Activa", color: "oklch(0.76 0.17 163)" },
  idle: { label: "Inactiva", color: "oklch(0.83 0.16 84)" },
  offline: { label: "Desconectada", color: "oklch(0.58 0.025 260)" },
};
export interface ProductivityTotals { gestiones: number; leads: number; pedidos: number }
const conversion = (orders: number | null, actions: number | null) => actions && orders !== null ? `${Math.round(orders / actions * 100)}%` : "–";

export default function ProductivityTable({ rows, totals, now, loading, stale, asignados = null }: {
  rows: ConnectedProductivityRow[]; totals: ProductivityTotals | null; now: number; loading: boolean; stale: boolean;
  /** Reparto de leads encendido: leads abiertos asignados ahora por usuario. Null = sin columna. */
  asignados?: Record<number, number> | null;
}) {
  const conAsignados = asignados != null;
  const columnas = conAsignados ? 8 : 7;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-xs">
        <caption className="sr-only">Productividad de personas conectadas a Leads durante el período seleccionado. El estado indica su presencia actual.</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
            <th scope="col" className="py-2 pr-5 font-medium">Persona</th>
            <th scope="col" className="py-2 pr-5 font-medium">Estado actual</th>
            <th scope="col" className="py-2 pr-5 font-medium">Última actividad del período</th>
            {conAsignados ? <th scope="col" className="py-2 pr-4 text-right font-medium" title="Leads abiertos (Hoy + Seguimiento) que el reparto automático le asignó, ahora">Asignados</th> : null}
            <th scope="col" className="py-2 pr-4 text-right font-medium">Gestiones</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Leads</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Pedidos</th>
            <th scope="col" className="py-2 text-right font-medium">Conversión</th>
          </tr>
        </thead>
        <tbody>
          {loading && !rows.length ? Array.from({ length: 3 }, (_, index) => (
            <tr key={index} aria-hidden="true" className="border-b border-border/50">
              {Array.from({ length: columnas }, (_, cell) => <td key={cell} className="py-3 pr-4"><span className={`block h-3 rounded-sm bg-muted ${cell === 0 ? "w-32" : "w-14"}`} /></td>)}
            </tr>
          )) : rows.length === 0 ? (
            <tr><td colSpan={columnas} className="py-7 text-center">
              <p className="text-muted-foreground">{stale ? "No se pudieron consultar las conexiones." : "Sin conexiones registradas en este período."}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{stale ? "Usa Actualizar para reintentar." : "Prueba otro rango. El historial se registra desde la activación de presencia en Leads."}</p>
            </td></tr>
          ) : rows.map((row) => {
            const state = STATES[presenceStatus(row, now)];
            const activity = row.period_last_activity_at ?? row.period_last_seen_at ?? null;
            return (
              <tr key={row.user_id} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-3 pr-5 text-left font-medium">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: stale ? STATES.offline.color : state.color }} />
                    {row.name}
                  </span>
                </th>
                <td className="whitespace-nowrap py-3 pr-5 text-muted-foreground">{stale ? "Sin confirmar" : state.label}</td>
                <td className="whitespace-nowrap py-3 pr-5 text-muted-foreground" title={activity ? new Date(activity).toLocaleString("es-CR", { timeZone: "America/Costa_Rica" }) : undefined}>
                  {!row.period_last_activity_at && activity ? "Conexión " : ""}{activityAgo(activity, now)}
                </td>
                {conAsignados ? <td className="py-3 pr-4 text-right tabular-nums">{asignados[row.user_id] ?? 0}</td> : null}
                <td className="py-3 pr-4 text-right tabular-nums">{row.gestiones ?? "–"}</td>
                <td className="py-3 pr-4 text-right tabular-nums">{row.leads ?? "–"}</td>
                <td className="py-3 pr-4 text-right font-semibold tabular-nums">{row.pedidos ?? "–"}</td>
                <td className="py-3 text-right tabular-nums">{conversion(row.pedidos, row.gestiones)}</td>
              </tr>
            );
          })}
        </tbody>
        {totals && rows.length > 0 ? <tfoot>
          <tr className="border-t border-border font-semibold">
            <th scope="row" colSpan={conAsignados ? 4 : 3} className="py-3 pr-4 text-left">Total del período</th>
            <td className="py-3 pr-4 text-right tabular-nums">{totals.gestiones}</td>
            <td className="py-3 pr-4 text-right tabular-nums">{totals.leads}</td>
            <td className="py-3 pr-4 text-right tabular-nums">{totals.pedidos}</td>
            <td className="py-3 text-right tabular-nums">{conversion(totals.pedidos, totals.gestiones)}</td>
          </tr>
        </tfoot> : null}
      </table>
    </div>
  );
}
