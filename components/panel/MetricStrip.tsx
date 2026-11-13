import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { PanelDelta, PanelMetric } from "@/lib/panel-resumen";
import { cn } from "@/lib/utils";
import { Skeleton } from "./BlockNotice";

const TONE: Record<PanelDelta["tone"], string> = {
  good: "text-emerald-400",
  bad: "text-rose-400",
  neutral: "text-muted-foreground",
};

function Delta({ delta }: { delta: PanelDelta }) {
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", TONE[delta.tone])}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{delta.spoken}</span>
    </span>
  );
}

/**
 * Las metricas del periodo en una sola tira: mismas medidas, mismo orden,
 * comparables de un vistazo. Cada celda dice de donde sale su cifra.
 */
export function MetricStrip({
  metrics,
  loading,
  refreshing,
}: {
  metrics: PanelMetric[] | null;
  loading: boolean;
  refreshing: boolean;
}) {
  const cells = metrics ?? Array.from({ length: 7 }, () => null);
  // Sin datos todavia no hay pares dt/dd: el contenedor es un div.
  const List = metrics ? "dl" : "div";
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_16_32/0.04)]">
      <List
        className={cn(
          "-mb-px -mr-px grid grid-cols-2 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 motion-reduce:transition-none",
          refreshing && "opacity-60"
        )}
        aria-busy={loading || refreshing}
      >
        {cells.map((m, i) => (
          <div key={m?.id ?? i} className="min-w-0 border-b border-r border-border px-4 py-3.5" title={m?.hint}>
            {m ? (
              <>
                <dt className="truncate text-[13px] text-muted-foreground">{m.label}</dt>
                <dd className="mt-1 min-w-0">
                  <span
                    className={cn(
                      "block truncate text-xl font-semibold tracking-tight",
                      m.unavailable ? "text-base font-medium text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {m.value}
                  </span>
                  <span className="mt-1 flex min-h-[20px] items-center text-xs">
                    {m.delta ? <Delta delta={m.delta} /> : <span className="text-muted-foreground">Sin comparación</span>}
                  </span>
                  {m.previous && (
                    <span className="block truncate text-xs text-muted-foreground tabular-nums">antes {m.previous}</span>
                  )}
                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">{m.detail}</span>
                </dd>
              </>
            ) : (
              <div className="space-y-2 py-0.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            )}
          </div>
        ))}
      </List>
    </div>
  );
}
