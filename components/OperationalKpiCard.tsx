import { ArrowDownRight, ArrowRight, ArrowUpRight, Star } from "lucide-react";
import type { KpiComparisonCopy } from "@/lib/kpi-comparison-copy";
import { cn } from "@/lib/utils";

/**
 * Celda de la tira de indicadores de Gestión de pedidos (estilo Stripe, la
 * misma tira que el Panel): sin tarjeta propia, la tira pone el borde y los
 * divisores. El estado lo cuentan el color del valor y la comparación.
 */
export function OperationalKpiCard({
  label,
  value,
  sub,
  star = false,
  tone = "neutral",
  deltaTone = "muted",
  comparison,
  hideSubWhenComparing = false,
  loading = false,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  star?: boolean;
  tone?: "good" | "warn" | "bad" | "neutral";
  deltaTone?: "good" | "bad" | "muted";
  comparison?: KpiComparisonCopy | null;
  hideSubWhenComparing?: boolean;
  loading?: boolean;
  title?: string;
}) {
  const valueColor =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "bad"
          ? "text-red-300"
          : "text-foreground";
  const trendColor =
    comparison?.direction == null || comparison.direction === "flat"
      ? "text-muted-foreground"
      : deltaTone === "good"
        ? "text-emerald-400"
        : deltaTone === "bad"
          ? "text-red-400"
          : "text-muted-foreground";
  const Arrow =
    comparison?.direction === "up"
      ? ArrowUpRight
      : comparison?.direction === "down"
        ? ArrowDownRight
        : comparison?.direction === "flat"
          ? ArrowRight
          : null;
  return (
    <div
      className="min-w-0 border-b border-r border-border px-4 py-3.5 xl:px-3"
      title={title}
      role="group"
      aria-label={label}
    >
      <p className="flex items-center gap-1 text-[13px] leading-5 text-muted-foreground">
        <span>{label}</span>
        {star && (
          <Star className="h-3 w-3 shrink-0 fill-primary text-primary" aria-label="Indicador principal" />
        )}
      </p>
      <p className={cn("mt-1 text-xl font-semibold tracking-tight tabular-nums", valueColor)}>
        {loading ? (
          <span className="my-1 block h-5 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" aria-label="Cargando" />
        ) : (
          value
        )}
      </p>
      {sub && !(hideSubWhenComparing && comparison) && (
        <p className="mt-1 text-xs leading-4 text-muted-foreground tabular-nums">{sub}</p>
      )}
      {comparison && !loading && (
        <div className="mt-1 space-y-0.5 text-xs tabular-nums">
          <p className="flex flex-wrap items-center gap-x-1">
            <span
              className={cn("inline-flex items-center gap-0.5 font-medium", trendColor)}
              title={comparison.changeText.includes("pp") ? "Diferencia en puntos porcentuales entre las dos tasas" : undefined}
            >
              {Arrow && <Arrow className="h-3.5 w-3.5" aria-hidden="true" />}
              {comparison.direction && comparison.direction !== "flat" && (
                <span className="sr-only">{comparison.direction === "up" ? "Sube " : "Baja "}</span>
              )}
              {comparison.changeText}
            </span>
            <span className="text-muted-foreground">{comparison.versusText}</span>
          </p>
          <p className="text-muted-foreground">{comparison.baselineText}</p>
        </div>
      )}
    </div>
  );
}
