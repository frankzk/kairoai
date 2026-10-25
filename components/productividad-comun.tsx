"use client";

// Piezas comunes de las ventanas de Productividad (Gestion -> despacho,
// Novedades -> gestion de novedades): el periodo, el nombre de la IA de
// iComfly y la tabla persona x dia.

import { useState } from "react";
import { Bot, CalendarRange, RefreshCw, X } from "lucide-react";
import { localDateKey, RANGE_LABELS, type RangeKey } from "@/lib/leads-metrics";

const RANGES: RangeKey[] = ["hoy", "ayer", "7d", "30d", "mes"];
/** Con mas dias, la tabla por dia no entra: solo el resumen. */
export const MAX_DIAS_TABLA = 31;

export function pct(n: number, total: number): string {
  return total ? `${Math.round((n / total) * 100)}%` : "—";
}

/** "2026-10-24" -> "vie 24". */
export function etiquetaDia(dia: string): string {
  const fecha = new Date(`${dia}T12:00:00Z`);
  const semana = fecha.toLocaleDateString("es-CR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return `${semana} ${fecha.getUTCDate()}`;
}

export function NombrePersona({ nombre, esIa }: { nombre: string; esIa?: boolean }) {
  if (!esIa) return <>{nombre}</>;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${nombre}: el asistente de IA de iComfly`}>
      <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> IA de iComfly
    </span>
  );
}

/** El periodo elegido: una ventana (hoy, ayer, 7d...) o un rango de fechas, que manda si esta. */
export function usePeriodo() {
  const [range, setRange] = useState<RangeKey>("hoy");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const custom = Boolean(fromDate || toDate);
  /** Los parametros que entienden las rutas de productividad (range, o from/to). */
  const query = (store: string): string => {
    const params = new URLSearchParams({ store });
    if (custom) {
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
    } else {
      params.set("range", range);
    }
    return params.toString();
  };
  return { range, setRange, fromDate, setFromDate, toDate, setToDate, custom, query };
}

export function SelectorPeriodo({
  periodo,
  onActualizar,
  loading,
  nombre,
}: {
  periodo: ReturnType<typeof usePeriodo>;
  onActualizar: () => void;
  loading: boolean;
  /** Para los aria-label de las fechas. */
  nombre: string;
}) {
  const { range, setRange, fromDate, setFromDate, toDate, setToDate, custom } = periodo;
  const today = localDateKey(new Date()) ?? undefined;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => {
              setRange(r);
              setFromDate("");
              setToDate("");
            }}
            aria-pressed={!custom && range === r}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              !custom && range === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent"
            }`}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>
      <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-0.5 ${custom ? "border-primary" : "border-input"}`}>
        <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Desde</span>
          <input
            type="date"
            aria-label={`${nombre}: fecha inicial`}
            value={fromDate}
            max={toDate || today}
            onChange={(e) => {
              const next = e.target.value;
              setFromDate(next);
              if (next && toDate && next > toDate) setToDate(next);
            }}
            className="h-7 w-[132px] rounded border border-input bg-card px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <span className="text-muted-foreground/50" aria-hidden="true">—</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Hasta</span>
          <input
            type="date"
            aria-label={`${nombre}: fecha final`}
            value={toDate}
            min={fromDate || undefined}
            max={today}
            onChange={(e) => {
              const next = e.target.value;
              setToDate(next);
              if (next && fromDate && next < fromDate) setFromDate(next);
            }}
            className="h-7 w-[132px] rounded border border-input bg-card px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        {custom && (
          <button
            type="button"
            onClick={() => {
              setFromDate("");
              setToDate("");
            }}
            aria-label="Quitar rango de fechas"
            title="Quitar rango"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button onClick={onActualizar} className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Actualizar
      </button>
    </div>
  );
}

/** Persona x dia, con fila de totales. Con un solo dia o con mas de MAX_DIAS_TABLA no se muestra. */
export function TablaPorDia({
  titulo,
  dias,
  filas,
}: {
  titulo: string;
  dias: string[];
  filas: Array<{ nombre: string; esIa?: boolean; porDia: Record<string, number> }>;
}) {
  if (dias.length <= 1 || dias.length > MAX_DIAS_TABLA || !filas.length) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{titulo}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="sticky left-0 bg-card py-2 pr-4 text-left font-medium">Persona</th>
              {dias.map((dia) => (
                <th key={dia} className="whitespace-nowrap px-2 py-2 text-right font-medium">
                  {etiquetaDia(dia)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <tr key={p.nombre} className="border-b border-border/50">
                <td className="sticky left-0 whitespace-nowrap bg-card py-2 pr-4">
                  <NombrePersona nombre={p.nombre} esIa={p.esIa} />
                </td>
                {dias.map((dia) => (
                  <td key={dia} className="px-2 py-2 text-right tabular-nums">
                    {p.porDia[dia] ? p.porDia[dia] : <span className="text-muted-foreground/40">·</span>}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="sticky left-0 bg-card py-2 pr-4">Total</td>
              {dias.map((dia) => (
                <td key={dia} className="px-2 py-2 text-right tabular-nums">
                  {filas.reduce((s, p) => s + (p.porDia[dia] ?? 0), 0) || (
                    <span className="font-normal text-muted-foreground/40">·</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
