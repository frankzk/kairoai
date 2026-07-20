"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RANGE_LABELS, type RangeKey } from "@/lib/leads-metrics";

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
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/productivity?store=${store}&range=${range}`);
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
  }, [store, range]);

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
                onClick={() => setRange(r)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  range === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent"
                }`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
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
