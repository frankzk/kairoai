import { Card, CardContent } from "@/components/ui/card";
import type { KpiComparisonCopy } from "@/lib/kpi-comparison-copy";

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
  const border =
    tone === "good"
      ? "border-emerald-500/40"
      : tone === "warn"
        ? "border-amber-500/40"
        : tone === "bad"
          ? "border-red-500/40"
          : "border-border";
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
  const arrow =
    comparison?.direction === "up"
      ? "↑"
      : comparison?.direction === "down"
        ? "↓"
        : comparison?.direction === "flat"
          ? "→"
          : "";
  return (
    <Card
      className={`${border} h-full`}
      title={title}
      role="group"
      aria-label={label}
    >
      <CardContent className="min-h-[112px] p-2.5 sm:p-3">
        <p className="text-[11px] leading-4 text-muted-foreground">{label}</p>
        <p
          className={`mt-1 flex items-baseline gap-1 text-xl font-semibold leading-tight tabular-nums ${valueColor}`}
        >
          {star && <span className="text-[9px] text-primary">★</span>}
          {loading ? "..." : value}
        </p>
        {sub && !(hideSubWhenComparing && comparison) && (
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            {sub}
          </p>
        )}
        {comparison && !loading && (
          <div className="mt-1 space-y-0.5 text-[10px] leading-4">
            <p className="flex flex-wrap items-baseline gap-x-1">
              <span
                className={`font-medium ${trendColor}`}
                title={
                  comparison.changeText.includes("pp")
                    ? "Diferencia en puntos porcentuales entre las dos tasas"
                    : undefined
                }
              >
                {arrow && `${arrow} `}
                {comparison.changeText}
              </span>
              <span className="text-muted-foreground">
                {comparison.versusText}
              </span>
            </p>
            <p className="text-muted-foreground">{comparison.baselineText}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
