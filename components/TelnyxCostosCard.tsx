"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, DollarSign, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Cuanto costaron las llamadas de Telnyx (/api/telnyx/costos). El costo de
// cada llamada lo manda Telnyx al colgar (evento call.cost), si esta activado.

interface Grupo {
  clave: string;
  nombre: string;
  llamadas: number;
  contestadas: number;
  conCosto: number;
  total: Record<string, number>;
  minutosCobrados: number;
}

interface Periodo {
  desde: string;
  general: Grupo;
  porTienda: Grupo[];
  porAsesora: Grupo[];
}

interface Datos {
  aviso: { activo: boolean | null; error: string | null };
  hoy: Periodo;
  mes: Periodo;
}

function monto(total: Record<string, number>): string {
  const partes = Object.entries(total).map(([moneda, v]) => `${v.toFixed(2)} ${moneda}`);
  return partes.length ? partes.join(" + ") : "—";
}

function Tabla({ titulo, grupos }: { titulo: string; grupos: Grupo[] }) {
  if (!grupos.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{titulo}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-2 font-normal">Nombre</th>
              <th className="py-1 pr-2 text-right font-normal">Llamadas</th>
              <th className="py-1 pr-2 text-right font-normal">Contestadas</th>
              <th className="py-1 pr-2 text-right font-normal">Min. cobrados</th>
              <th className="py-1 text-right font-normal">Costo</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.clave} className="border-t border-border">
                <td className="py-1 pr-2">{g.nombre}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{g.llamadas}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{g.contestadas}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{Math.round(g.minutosCobrados)}</td>
                <td className="py-1 text-right tabular-nums">
                  {monto(g.total)}
                  {g.conCosto < g.llamadas && (
                    <span className="block text-[11px] text-muted-foreground">{g.llamadas - g.conCosto} sin costo</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TelnyxCostosCard() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<"hoy" | "mes">("hoy");
  const [activando, setActivando] = useState(false);

  const cargar = useCallback(() => {
    setError(null);
    fetch("/api/telnyx/costos", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
        setDatos(data as Datos);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo leer el costo"));
  }, []);

  useEffect(cargar, [cargar]);

  async function activar() {
    setActivando(true);
    setError(null);
    try {
      const r = await fetch("/api/telnyx/costos", { method: "POST" });
      const data = await r.json();
      if (!r.ok || !data.activo) throw new Error(data.error || "Telnyx no lo dejó activado");
      cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo activar");
    } finally {
      setActivando(false);
    }
  }

  const p = datos?.[periodo];
  const sinCosto = p ? p.general.llamadas - p.general.conCosto : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" /> Costo de llamadas
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={cargar} aria-label="Actualizar">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!datos && !error && <p className="text-xs text-muted-foreground">Cargando…</p>}
        {datos && (
          <>
            <div className="flex items-start gap-2 text-xs">
              {datos.aviso.activo ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {datos.aviso.activo
                    ? "Telnyx informa el costo de cada llamada"
                    : datos.aviso.activo === false
                      ? "Telnyx todavía no informa el costo"
                      : "No se pudo consultar Telnyx"}
                </p>
                <p className="break-words text-muted-foreground">
                  {datos.aviso.activo
                    ? "Llega unos segundos después de colgar."
                    : datos.aviso.error ?? "Sin esto, las llamadas nuevas quedan sin costo."}
                </p>
              </div>
              {datos.aviso.activo === false && (
                <Button type="button" size="sm" onClick={activar} disabled={activando}>
                  {activando ? "Activando…" : "Activar"}
                </Button>
              )}
            </div>

            <div className="flex gap-1">
              {(["hoy", "mes"] as const).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={periodo === k ? "default" : "outline"}
                  onClick={() => setPeriodo(k)}
                >
                  {k === "hoy" ? "Hoy" : "Este mes"}
                </Button>
              ))}
            </div>

            {p && (
              <>
                <p className="text-sm">
                  <span className="text-lg font-semibold tabular-nums">{monto(p.general.total)}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    en {p.general.llamadas} llamadas ({p.general.contestadas} contestadas)
                  </span>
                </p>
                {sinCosto > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {sinCosto} llamadas sin costo informado (anteriores a la activación o que Telnyx no pudo calcular): el
                    total real es mayor.
                  </p>
                )}
                <Tabla titulo="Por tienda" grupos={p.porTienda} />
                <Tabla titulo="Por asesora" grupos={p.porAsesora} />
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
