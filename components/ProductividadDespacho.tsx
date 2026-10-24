"use client";

// Ventana "Productividad" de Gestion (boton en la tabla de Pedidos): quien
// despacha (genera la guia en iComfly) y quien confirma, por persona y por
// dia. Los datos salen de /api/finance/productividad
// (lib/productividad-despacho.ts). El marco y el titulo los pone la ventana.

import { useCallback, useEffect, useState } from "react";
import { Bot, CalendarRange, RefreshCw, X } from "lucide-react";
import { localDateKey, RANGE_LABELS, type RangeKey } from "@/lib/leads-metrics";
import type { PersonaDespacho } from "@/lib/productividad-despacho";

const RANGES: RangeKey[] = ["hoy", "ayer", "7d", "30d", "mes"];
/** Con mas dias, la tabla por dia no entra: solo el resumen. */
const MAX_DIAS_TABLA = 31;

interface Respuesta {
  range_label: string;
  personas: PersonaDespacho[];
  dias: string[];
  despachados: number;
  confirmados: number;
}

function pct(n: number, total: number): string {
  return total ? `${Math.round((n / total) * 100)}%` : "—";
}

/** "2026-10-24" -> "vie 24". */
function etiquetaDia(dia: string): string {
  const fecha = new Date(`${dia}T12:00:00Z`);
  const semana = fecha.toLocaleDateString("es-CR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return `${semana} ${fecha.getUTCDate()}`;
}

function Nombre({ p }: { p: PersonaDespacho }) {
  if (!p.esIa) return <>{p.nombre}</>;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${p.nombre}: el asistente de IA de iComfly`}>
      <Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> IA de iComfly
    </span>
  );
}

export default function ProductividadDespacho({ storeCode }: { storeCode: string }) {
  const [range, setRange] = useState<RangeKey>("hoy");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const custom = Boolean(fromDate || toDate);
  const today = localDateKey(new Date()) ?? undefined;
  const [data, setData] = useState<Respuesta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ store: storeCode });
      if (custom) {
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
      } else {
        params.set("range", range);
      }
      const res = await fetch(`/api/finance/productividad?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar la productividad");
      setData(json as Respuesta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la productividad");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [storeCode, range, custom, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  const personas = data?.personas ?? [];
  const conDespachos = personas.filter((p) => p.despachados > 0);
  const dias = data && data.dias.length <= MAX_DIAS_TABLA ? data.dias : [];

  return (
    <div className="space-y-5">
      <div>
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
          <div
            className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-0.5 ${custom ? "border-primary" : "border-input"}`}
          >
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Desde</span>
              <input
                type="date"
                aria-label="Productividad de despacho: fecha inicial"
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
                aria-label="Productividad de despacho: fecha final"
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
          <button
            onClick={load}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          <strong className="font-medium text-foreground/80">Despachados</strong>: pedidos a los que esa persona les generó la guía en
          iComfly, por el día en que quedaron con guía. <strong className="font-medium text-foreground/80">Confirmados</strong>: pedidos
          que confirmó, por el día en que los confirmó.
        </p>

        {error ? (
          <p className="py-4 text-center text-sm text-destructive">{error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Persona</th>
                  <th className="py-2 pr-4 text-right font-medium">Despachados</th>
                  <th className="py-2 pr-4 text-right font-medium">% del total</th>
                  <th className="py-2 text-right font-medium">Confirmados</th>
                </tr>
              </thead>
              <tbody>
                {personas.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      {loading ? "Cargando..." : "Sin despachos ni confirmaciones en este periodo."}
                    </td>
                  </tr>
                ) : (
                  personas.map((p) => (
                    <tr key={p.nombre} className={`border-b border-border/50 ${p.esIa ? "text-muted-foreground" : ""}`}>
                      <td className="py-2 pr-4">
                        <Nombre p={p} />
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold tabular-nums">{p.despachados}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{pct(p.despachados, data?.despachados ?? 0)}</td>
                      <td className="py-2 text-right tabular-nums">{p.confirmados}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {data && personas.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{data.despachados}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{data.despachados ? "100%" : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{data.confirmados}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {!error && dias.length > 1 && conDespachos.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Despachados por día</p>
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
                {conDespachos.map((p) => (
                  <tr key={p.nombre} className="border-b border-border/50">
                    <td className="sticky left-0 whitespace-nowrap bg-card py-2 pr-4">
                      <Nombre p={p} />
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
                      {conDespachos.reduce((s, p) => s + (p.porDia[dia] ?? 0), 0) || (
                        <span className="font-normal text-muted-foreground/40">·</span>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
