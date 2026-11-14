import { Boxes, CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatInt } from "@/lib/panel-resumen";
import {
  coverDaysText,
  formatOne,
  shortDay,
  type PanelStockView,
  type StockAlert,
  type StockTone,
} from "@/lib/panel-productos-vista";
import type { BlockFailure } from "@/lib/panel-atencion";
import { cn } from "@/lib/utils";
import { BlockNotice, Skeleton } from "./BlockNotice";

const TONE: Record<StockTone, { label: string; variant: "destructive" | "warning"; summary: string }> = {
  out: { label: "Agotado", variant: "destructive", summary: "agotados" },
  red: { label: "Menos de 3 días", variant: "destructive", summary: "con menos de 3 días" },
  yellow: { label: "Menos de 7 días", variant: "warning", summary: "con menos de 7 días" },
};

function AlertRow({ alert }: { alert: StockAlert }) {
  const tone = TONE[alert.tone];
  return (
    <li className="flex min-w-0 items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-foreground" title={alert.name}>
          {alert.name}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
          {alert.sku} · vende {formatOne(alert.dailyUnits)}/día
          {alert.backorder ? ` · ${formatInt(alert.backorder)} esperando` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <Badge variant={tone.variant}>{tone.label}</Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {alert.tone === "out" ? "0 disponibles" : `${formatInt(alert.available)} disp. · ${coverDaysText(alert.days)}`}
        </span>
      </div>
    </li>
  );
}

/**
 * SKUs agotados o por acabarse segun lo que se vendio en los ultimos 7 dias.
 * Sin inventario conectado (todas las tiendas menos las que tienen ShipHero)
 * lo dice en vez de inventar.
 */
export function StockAlertsCard({
  stock,
  failure,
  refreshing,
}: {
  stock: PanelStockView | null;
  failure: BlockFailure | null;
  refreshing: boolean;
}) {
  const ready = stock?.status === "ready" ? stock : null;
  const total = ready ? ready.alerts.counts.out + ready.alerts.counts.red + ready.alerts.counts.yellow : 0;
  const day = ready ? shortDay(ready.snapshotDate) : null;
  const summary = ready
    ? (["out", "red", "yellow"] as StockTone[])
        .filter((t) => ready.alerts.counts[t] > 0)
        .map((t) => `${formatInt(ready.alerts.counts[t])} ${TONE[t].summary}`)
        .join(" · ")
    : "";
  return (
    <section
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_16_32/0.04)] sm:p-5"
      aria-labelledby="panel-stock-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="panel-stock-title" className="text-sm font-semibold text-foreground">
          Alertas de stock
        </h2>
        {ready && total > ready.alerts.alerts.length && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {ready.alerts.alerts.length} de {formatInt(total)}
          </p>
        )}
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        {ready
          ? `Inventario de ShipHero${day ? ` del ${day}` : ""} contra lo vendido en los últimos 7 días`
          : "Productos agotados o por acabarse según lo que se vende"}
      </p>

      {failure && (
        <BlockNotice
          className="mt-4"
          failure={failure}
          noAccess="Las alertas de stock salen de Gestión de pedidos."
          unavailable="No se pudo cargar el inventario. Prueba con Actualizar."
        />
      )}
      {!failure && !stock && (
        <div className="mt-4 space-y-3.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
      {!failure && stock?.status === "sin_inventario" && (
        <div className="mt-4 flex items-start gap-2 text-[13px] text-muted-foreground" role="status">
          <Boxes className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-medium text-foreground">Sin inventario</span>. {stock.message}
          </p>
        </div>
      )}
      {!failure && ready && (
        <div className={cn("mt-4 transition-opacity motion-reduce:transition-none", refreshing && "opacity-60")}>
          {total === 0 ? (
            <p className="flex items-start gap-2 text-[13px] text-muted-foreground" role="status">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
              <span>
                <span className="font-medium text-foreground">Todo con stock para más de 7 días</span>
                {ready.alerts.selling > 0 ? ` (${formatInt(ready.alerts.selling)} productos con ventas en 7 días).` : "."}
              </span>
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs font-medium text-foreground tabular-nums">{summary}</p>
              <ul className="divide-y divide-border" aria-label="Productos con alerta de stock">
                {ready.alerts.alerts.map((alert) => (
                  <AlertRow key={alert.sku} alert={alert} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
