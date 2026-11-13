import { PANEL_RANGES, type PanelRange } from "@/lib/panel-resumen";
import { cn } from "@/lib/utils";

/** Periodo del Panel: un control segmentado, el primer filtro de la fila. */
export function PeriodControl({ value, onChange }: { value: PanelRange; onChange: (next: PanelRange) => void }) {
  return (
    <div
      role="group"
      aria-label="Periodo"
      className="inline-flex max-w-full shrink-0 overflow-x-auto rounded-md border border-border bg-card p-0.5"
    >
      {PANEL_RANGES.map((r) => {
        const active = r.value === value;
        return (
          <button
            key={r.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(r.value)}
            className={cn(
              "h-7 shrink-0 whitespace-nowrap rounded-[5px] px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
