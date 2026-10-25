"use client";

// Ventana "Productividad" de Novedades: quien trabaja las novedades, por
// persona y por dia. Los datos salen de /api/incidents/productividad
// (lib/productividad-novedades.ts). El marco y el titulo los pone la ventana.

import { useCallback, useEffect, useState } from "react";
import type { PersonaNovedades } from "@/lib/productividad-novedades";
import { pct, SelectorPeriodo, TablaPorDia, usePeriodo } from "@/components/productividad-comun";

interface Respuesta {
  range_label: string;
  personas: PersonaNovedades[];
  dias: string[];
  novedades: number;
  acciones: number;
}

export default function ProductividadNovedades({ storeCode }: { storeCode: string }) {
  const periodo = usePeriodo();
  const query = periodo.query(storeCode);
  const [data, setData] = useState<Respuesta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/productividad?${query}`, { cache: "no-store" });
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
  const totalDe = (campo: "llamadas" | "reprogramadas" | "notas" | "otras") => personas.reduce((s, p) => s + p[campo], 0);

  return (
    <div className="space-y-5">
      <div>
        <SelectorPeriodo periodo={periodo} onActualizar={load} loading={loading} nombre="Productividad de novedades" />
        <p className="mb-3 text-xs text-muted-foreground">
          <strong className="font-medium text-foreground/80">Novedades</strong>: novedades distintas que esa persona trabajó (llamó,
          reprogramó, anotó, descartó o mandó a RTS). Cuenta desde fines de octubre de 2026: antes Kairo no guardaba quién hacía cada acción.
        </p>

        {error ? (
          <p className="py-4 text-center text-sm text-destructive">{error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Persona</th>
                  <th className="py-2 pr-4 text-right font-medium">Novedades</th>
                  <th className="py-2 pr-4 text-right font-medium">% del total</th>
                  <th className="py-2 pr-4 text-right font-medium">Llamadas</th>
                  <th className="py-2 pr-4 text-right font-medium">Reprogramadas</th>
                  <th className="py-2 pr-4 text-right font-medium">Notas</th>
                  <th className="py-2 text-right font-medium" title="Descartes, RTS, cambios de estado o de causa">
                    Otras
                  </th>
                </tr>
              </thead>
              <tbody>
                {personas.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-muted-foreground">
                      {loading ? "Cargando..." : "Nadie trabajó novedades en este periodo."}
                    </td>
                  </tr>
                ) : (
                  personas.map((p) => (
                    <tr key={p.nombre} className="border-b border-border/50">
                      <td className="py-2 pr-4">{p.nombre}</td>
                      <td className="py-2 pr-4 text-right font-semibold tabular-nums">{p.novedades}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{pct(p.novedades, data?.novedades ?? 0)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.llamadas}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.reprogramadas}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.notas}</td>
                      <td className="py-2 text-right tabular-nums">{p.otras}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {data && personas.length > 0 && (
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2 pr-4" title="Una novedad trabajada por dos personas cuenta una vez">
                      Total
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{data.novedades}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">—</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totalDe("llamadas")}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totalDe("reprogramadas")}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{totalDe("notas")}</td>
                    <td className="py-2 text-right tabular-nums">{totalDe("otras")}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {!error && data && <TablaPorDia titulo="Novedades trabajadas por día" dias={data.dias} filas={personas} />}
    </div>
  );
}
