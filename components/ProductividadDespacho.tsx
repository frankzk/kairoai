"use client";

// Ventana "Productividad" de Gestion (boton en la tabla de Pedidos): quien
// despacha (genera la guia en iComfly) y quien confirma, por persona y por
// dia. Los datos salen de /api/finance/productividad
// (lib/productividad-despacho.ts). El marco y el titulo los pone la ventana.

import { useCallback, useEffect, useState } from "react";
import type { PersonaDespacho } from "@/lib/productividad-despacho";
import { NombrePersona, pct, SelectorPeriodo, TablaPorDia, usePeriodo } from "@/components/productividad-comun";

interface Respuesta {
  range_label: string;
  personas: PersonaDespacho[];
  dias: string[];
  despachados: number;
  confirmados: number;
}

export default function ProductividadDespacho({ storeCode }: { storeCode: string }) {
  const periodo = usePeriodo();
  const query = periodo.query(storeCode);
  const [data, setData] = useState<Respuesta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/productividad?${query}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar la productividad");
      setData(json as Respuesta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la productividad");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const personas = data?.personas ?? [];

  return (
    <div className="space-y-5">
      <div>
        <SelectorPeriodo periodo={periodo} onActualizar={load} loading={loading} nombre="Productividad de despacho" />
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
                        <NombrePersona nombre={p.nombre} esIa={p.esIa} />
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

      {!error && data && (
        <TablaPorDia titulo="Despachados por día" dias={data.dias} filas={personas.filter((p) => p.despachados > 0)} />
      )}
    </div>
  );
}
