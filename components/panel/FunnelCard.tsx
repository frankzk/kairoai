import theme from "@/components/marketing/theme.module.css";
import { formatInt, formatPct, type PanelFunnel } from "@/lib/panel-resumen";
import { cn } from "@/lib/utils";
import { BlockNotice, Skeleton } from "./BlockNotice";
import type { BlockFailure } from "@/lib/panel-atencion";

/**
 * Embudo del periodo: generados -> confirmados -> despachados -> entregados.
 * Barras finas de un solo color (es una sola serie), la cifra y el % sobre los
 * generados al lado de cada paso. Lo que sale del camino va en el pie.
 */
export function FunnelCard({
  funnel,
  failure,
  refreshing,
  periodPhrase,
}: {
  funnel: PanelFunnel | null;
  failure: BlockFailure | null;
  refreshing: boolean;
  periodPhrase: string;
}) {
  return (
    <section
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_16_32/0.04)] sm:p-5"
      aria-labelledby="panel-funnel-title"
    >
      <h2 id="panel-funnel-title" className="text-sm font-semibold text-foreground">
        Embudo del periodo
      </h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Pedidos generados {periodPhrase}, según su estado de hoy</p>

      {failure && (
        <BlockNotice
          className="mt-4"
          failure={failure}
          noAccess="El embudo es de Gestión de pedidos."
          unavailable="No se pudieron cargar los pedidos. Prueba con Actualizar."
        />
      )}
      {!failure && !funnel && (
        <div className="mt-4 space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {!failure && funnel && (
        <div className={cn("transition-opacity motion-reduce:transition-none", refreshing && "opacity-60")}>
          <ol className={cn(theme.theme, "mt-4 space-y-3.5")} aria-label="Embudo de pedidos">
            {funnel.steps.map((step) => (
              <li key={step.id}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-foreground">{step.label}</span>
                  <span className="tabular-nums">
                    <span className="font-semibold text-foreground">{formatInt(step.value)}</span>
                    {step.share != null && step.id !== "generated" && (
                      <span className="ml-1.5 text-muted-foreground">{formatPct(step.share)}</span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full" style={{ background: "var(--mk-track)" }} aria-hidden="true">
                  {step.share != null && step.share > 0 && (
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${Math.min(100, step.share)}%`, background: "var(--mk-series-1)" }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 text-[13px]">
            {funnel.aside.map((item) => (
              <div key={item.id} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="font-medium tabular-nums text-foreground">{formatInt(item.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
