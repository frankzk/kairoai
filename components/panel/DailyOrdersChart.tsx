"use client";

import { useState } from "react";
import { Table2 } from "lucide-react";
import { ChartLegend, ColumnChart, type ColumnBin } from "@/components/marketing/charts";
import theme from "@/components/marketing/theme.module.css";
import { averagePerDay, DAY_PARTS, dayLabel, formatInt, splitDay } from "@/lib/panel-resumen";
import type { PanelDay } from "@/lib/panel-serie";
import { cn } from "@/lib/utils";
import { BlockNotice, Skeleton } from "./BlockNotice";
import type { BlockState } from "./useEndpoint";

/**
 * Pedidos generados por dia, partidos segun su estado de HOY (entregados,
 * despachados sin entregar, confirmados sin guia, en gestion, anulados). Un
 * eje, columnas finas, tooltip por columna y una tabla equivalente.
 */
export function DailyOrdersChart({
  state,
  subtitle,
  note,
  money,
}: {
  state: BlockState<{ days: PanelDay[] }>;
  subtitle: string;
  note?: string | null;
  money: (value: number) => string;
}) {
  const [asTable, setAsTable] = useState(false);
  const days = state.status === "ready" ? state.data.days : [];
  const avg = averagePerDay(days);
  const bins: ColumnBin[] = days.map((day) => {
    const parts = splitDay(day);
    return {
      key: day.date,
      label: dayLabel(day.date),
      title: dayLabel(day.date, true),
      stacks: [DAY_PARTS.map((p) => ({ key: p.key, label: p.label, value: parts[p.key], color: p.color }))],
      notes: day.value > 0 ? [`Valor ${money(day.value)}`] : undefined,
    };
  });
  const total = days.reduce(
    (acc, d) => {
      acc.generated += d.generated;
      acc.confirmed += d.confirmed;
      acc.dispatched += d.dispatched;
      acc.delivered += d.delivered;
      acc.annulled += d.annulled;
      acc.value += d.value;
      return acc;
    },
    { generated: 0, confirmed: 0, dispatched: 0, delivered: 0, annulled: 0, value: 0 }
  );

  return (
    <section
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_16_32/0.04)] sm:p-5"
      aria-labelledby="panel-daily-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="panel-daily-title" className="text-sm font-semibold text-foreground">
            Pedidos por día
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {subtitle}
            {state.status === "ready" && avg != null && days.length > 1 && (
              <span className="tabular-nums"> · promedio {formatInt(avg)} por día</span>
            )}
          </p>
        </div>
        {state.status === "ready" && days.length > 0 && (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            <Table2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {asTable ? "Ver gráfico" : "Ver tabla"}
          </button>
        )}
      </div>

      {state.status === "loading" && <Skeleton className="mt-4 h-[236px] w-full" />}
      {(state.status === "sin_acceso" || state.status === "no_disponible") && (
        <BlockNotice
          className="mt-4 min-h-[120px]"
          failure={state.status}
          noAccess="Los pedidos por día son de Gestión de pedidos."
          unavailable="No se pudo calcular la serie. Prueba con Actualizar."
        />
      )}
      {state.status === "ready" && days.length === 0 && (
        <p className="mt-4 text-[13px] text-muted-foreground">Sin días en este periodo.</p>
      )}
      {state.status === "ready" && days.length > 0 && (
        <div
          className={cn(
            "mt-2 transition-opacity motion-reduce:transition-none",
            state.refreshing && "opacity-60"
          )}
        >
          {asTable ? (
            <div className="mt-2 max-h-[320px] overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] text-[13px]">
                <caption className="sr-only">Pedidos por día según su estado de hoy</caption>
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 font-medium">Día</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Generados</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Confirmados</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Despachados</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Entregados</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Anulados</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className="border-b border-border last:border-0">
                      <th scope="row" className="px-3 py-1.5 text-left font-normal text-foreground">
                        {dayLabel(d.date, true)}
                      </th>
                      <td className="px-3 py-1.5 text-right">{formatInt(d.generated)}</td>
                      <td className="px-3 py-1.5 text-right">{formatInt(d.confirmed)}</td>
                      <td className="px-3 py-1.5 text-right">{formatInt(d.dispatched)}</td>
                      <td className="px-3 py-1.5 text-right">{formatInt(d.delivered)}</td>
                      <td className="px-3 py-1.5 text-right">{formatInt(d.annulled)}</td>
                      <td className="px-3 py-1.5 text-right">{money(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-foreground">
                  <tr className="border-t border-border font-medium">
                    <th scope="row" className="px-3 py-2 text-left font-medium">Total</th>
                    <td className="px-3 py-2 text-right">{formatInt(total.generated)}</td>
                    <td className="px-3 py-2 text-right">{formatInt(total.confirmed)}</td>
                    <td className="px-3 py-2 text-right">{formatInt(total.dispatched)}</td>
                    <td className="px-3 py-2 text-right">{formatInt(total.delivered)}</td>
                    <td className="px-3 py-2 text-right">{formatInt(total.annulled)}</td>
                    <td className="px-3 py-2 text-right">{money(total.value)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className={theme.theme}>
              <ColumnChart
                bins={bins}
                height={236}
                format={formatInt}
                ariaLabel={`Pedidos generados por día, ${subtitle.toLowerCase()}. Total ${formatInt(total.generated)}`}
              />
              <ChartLegend
                label="Estados de hoy"
                items={DAY_PARTS.map((p) => ({ key: p.key, name: p.label, color: p.color, mark: "rect" as const }))}
              />
            </div>
          )}
          {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}
        </div>
      )}
    </section>
  );
}
