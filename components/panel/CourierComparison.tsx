"use client";

import { useState } from "react";
import { Table2 } from "lucide-react";
import { ChartLegend } from "@/components/marketing/charts";
import theme from "@/components/marketing/theme.module.css";
import { COURIER_PARTS, partWidths, type CourierComparisonRow, type CourierPartKey } from "@/lib/panel-couriers";
import { formatInt, formatPct } from "@/lib/panel-resumen";
import type { BlockFailure } from "@/lib/panel-atencion";
import { cn } from "@/lib/utils";
import { BlockNotice, Skeleton } from "./BlockNotice";

/**
 * Efectividad por transportadora: una barra 100 % por courier con como estan
 * hoy sus despachos del periodo, la entrega efectiva a la derecha y, al pasar
 * o enfocar un tramo, su detalle. Un eje (0-100 %), una fila por courier, en
 * orden de volumen. Tabla equivalente con "Ver tabla".
 */
export function CourierComparison({
  rows,
  failure,
  refreshing,
  periodPhrase,
  maturing,
}: {
  rows: CourierComparisonRow[] | null;
  failure: BlockFailure | null;
  refreshing: boolean;
  periodPhrase: string;
  maturing: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<{ id: string; part: CourierPartKey } | null>(null);
  const ready = !failure && rows != null;

  return (
    <section
      className={cn(theme.theme, "flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_16_32/0.04)] sm:p-5")}
      aria-labelledby="panel-couriers-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="panel-couriers-title" className="text-sm font-semibold text-foreground">
            Efectividad por transportadora
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Pedidos despachados {periodPhrase}, según su estado de hoy
          </p>
        </div>
        {ready && rows.length > 0 && (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <Table2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {asTable ? "Ver gráfico" : "Ver tabla"}
          </button>
        )}
      </div>

      {failure && (
        <BlockNotice
          className="mt-4"
          failure={failure}
          noAccess="La efectividad por transportadora es de Gestión de pedidos."
          unavailable="No se pudo calcular. Prueba con Actualizar."
        />
      )}
      {!failure && rows == null && (
        <div className="mt-4 space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {ready && rows.length === 0 && <p className="mt-4 text-[13px] text-muted-foreground">Sin despachos en el periodo.</p>}

      {ready && rows.length > 0 && (
        <div className={cn("mt-3 transition-opacity motion-reduce:transition-none", refreshing && "opacity-60")}>
          {asTable ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[620px] text-[13px]">
                <caption className="sr-only">Efectividad de entrega por transportadora</caption>
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                    <th scope="col">Transportadora</th>
                    <th scope="col" className="text-right">Despachados</th>
                    {COURIER_PARTS.map((p) => (
                      <th key={p.key} scope="col" className="text-right">{p.label}</th>
                    ))}
                    <th scope="col" className="text-right">Entrega efectiva</th>
                    <th scope="col" className="text-right">Sobre resueltos</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-b-0 [&>td]:px-3 [&>td]:py-2">
                      <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">{r.label}</th>
                      <td className="text-right tabular-nums">{formatInt(r.dispatched)}</td>
                      {COURIER_PARTS.map((p) => (
                        <td key={p.key} className="text-right tabular-nums">{formatInt(r.parts[p.key])}</td>
                      ))}
                      <td className="text-right font-semibold tabular-nums text-foreground">{r.rate == null ? "—" : formatPct(r.rate)}</td>
                      <td className="text-right tabular-nums">{r.resolvedRate == null ? "—" : formatPct(r.resolvedRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <ChartLegend items={COURIER_PARTS.map((p) => ({ key: p.key, name: p.label, color: p.color, mark: "rect" as const }))} label="Estados de los despachos" />
              <ul className="mt-3 space-y-4" aria-label="Transportadoras">
                {rows.map((r) => {
                  const widths = partWidths(r);
                  const visibles = COURIER_PARTS.filter((p) => r.parts[p.key] > 0).map((p) => p.key);
                  const active = hover?.id === r.id ? hover.part : null;
                  return (
                    <li key={r.id} className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
                        <span className="min-w-0 basis-full truncate font-medium text-foreground sm:basis-auto" title={r.label}>{r.label}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatInt(r.dispatched)} despachados
                          <span className="ml-3 text-base font-semibold text-foreground">{r.rate == null ? "—" : formatPct(r.rate)}</span>
                          <span className="ml-1 text-xs">entrega</span>
                        </span>
                      </div>
                      <div className="mt-1.5 flex h-3 w-full gap-[2px]" role="img" aria-label={`${r.label}: ${COURIER_PARTS.map((p) => `${p.label} ${r.parts[p.key]}`).join(", ")}`}>
                        {COURIER_PARTS.map((p) =>
                          r.parts[p.key] > 0 ? (
                            <button
                              key={p.key}
                              type="button"
                              aria-label={`${r.label}, ${p.label}: ${r.parts[p.key]} (${formatPct(widths[p.key])})`}
                              onMouseEnter={() => setHover({ id: r.id, part: p.key })}
                              onMouseLeave={() => setHover(null)}
                              onFocus={() => setHover({ id: r.id, part: p.key })}
                              onBlur={() => setHover(null)}
                              className={cn(
                                "h-full min-w-[3px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                                p.key === visibles[0] && "rounded-l-[4px]",
                                p.key === visibles[visibles.length - 1] && "rounded-r-[4px]",
                                active && active !== p.key && "opacity-40"
                              )}
                              style={{ width: `${widths[p.key]}%`, background: p.color }}
                            />
                          ) : null
                        )}
                      </div>
                      <p className="mt-1 min-h-[18px] text-xs tabular-nums text-muted-foreground" aria-live="polite">
                        {active ? (
                          <>
                            <span className="font-medium text-foreground">{COURIER_PARTS.find((p) => p.key === active)?.label}</span>{" "}
                            {formatInt(r.parts[active])} de {formatInt(r.dispatched)} ({formatPct(widths[active])})
                          </>
                        ) : (
                          <>
                            {r.resolvedRate == null ? "Sin pedidos resueltos todavía" : `${formatPct(r.resolvedRate)} de los ya resueltos`}
                            {r.parts.notDelivered > 0 && ` · ${formatInt(r.parts.notDelivered)} no entregados`}
                          </>
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Entrega efectiva = entregados ÷ despachados. “De los ya resueltos” deja fuera lo que sigue en camino, para comparar transportadoras con distinto volumen en ruta.
            {maturing && " Los despachos recientes siguen en camino: la entrega todavía puede subir."}
          </p>
        </div>
      )}
    </section>
  );
}
