"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, RefreshCw, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { localDateKey, RANGE_LABELS, type RangeKey } from "@/lib/leads-metrics";

interface Row {
  vendedora_id: number;
  name: string;
  gestiones: number;
  leads: number;
  pedidos: number;
}

interface Totals {
  gestiones: number;
  leads: number;
  pedidos: number;
}

const RANGES: RangeKey[] = ["hoy", "ayer", "7d", "30d", "mes"];

function conv(pedidos: number, gestiones: number): string {
  if (!gestiones) return "—";
  return `${Math.round((pedidos / gestiones) * 100)}%`;
}

export default function ProductivityPanel({ store }: { store: string }) {
  const [range, setRange] = useState<RangeKey>("hoy");
  // Rango a mano (dias locales, inclusivos). Si hay alguna fecha, manda sobre
  // los botones: los botones se apagan y la consulta va con from/to.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const custom = Boolean(fromDate || toDate);
  const today = localDateKey(new Date()) ?? undefined;
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ store });
      if (custom) {
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
      } else {
        params.set("range", range);
      }
      const res = await fetch(`/api/leads/productivity?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar productividad");
      setRows(data.rows ?? []);
      setTotals(data.totals ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar productividad");
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [store, range, custom, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Productividad</span>
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
            className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-0.5 ${
              custom ? "border-primary" : "border-input"
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Desde</span>
              <input
                type="date"
                aria-label="Productividad: fecha inicial"
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
                aria-label="Productividad: fecha final"
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

        {error ? (
          <p className="py-4 text-center text-sm text-destructive">{error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Asesora</th>
                  <th className="py-2 pr-4 text-right font-medium">Gestiones</th>
                  <th className="py-2 pr-4 text-right font-medium">Leads</th>
                  <th className="py-2 pr-4 text-right font-medium">Pedidos</th>
                  <th className="py-2 text-right font-medium">Conversión</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      {loading ? "Cargando..." : "Sin gestiones en este periodo."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.vendedora_id} className="border-b border-border/50">
                      <td className="py-2 pr-4">{r.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.gestiones}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{r.leads}</td>
                      <td className="py-2 pr-4 text-right font-semibold tabular-nums">{r.pedidos}</td>
                      <td className="py-2 text-right tabular-nums">{conv(r.pedidos, r.gestiones)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {totals && rows.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2 pr-4">Total</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totals.gestiones}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totals.leads}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totals.pedidos}</td>
                    <td className="py-2 text-right tabular-nums">{conv(totals.pedidos, totals.gestiones)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
