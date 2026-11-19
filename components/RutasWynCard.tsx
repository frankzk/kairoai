"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Truck, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { nombresDias, type RutaWyn } from "@/lib/wyn-rutas";

interface Carga {
  archivo: string | null;
  rutas: number;
  cargado_por: string | null;
  cargado_at: string | null;
}

function fmtFecha(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-CR", { timeZone: "America/Costa_Rica", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Rutas y días de entrega de WYN (Costa Rica): se cargan desde el Excel que
// manda WYN (hoja "Frecuencias por zona"). Cada carga reemplaza las rutas.
export default function RutasWynCard() {
  const [rutas, setRutas] = useState<RutaWyn[] | null>(null);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [verTodas, setVerTodas] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/wyn/rutas", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { rutas?: RutaWyn[]; carga?: Carga | null }) => {
        setRutas(d.rutas ?? []);
        setCarga(d.carga ?? null);
      })
      .catch(() => setRutas([]));
  }, []);

  async function subir(archivo: File) {
    setSubiendo(true);
    setMensaje(null);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      const res = await fetch("/api/wyn/rutas", { method: "POST", body: form });
      const d = (await res.json().catch(() => ({}))) as { error?: string; cargadas?: number; rutas?: RutaWyn[]; carga?: Carga | null };
      if (!res.ok) throw new Error(d.error || "No se pudo cargar el Excel.");
      setRutas(d.rutas ?? []);
      setCarga(d.carga ?? null);
      setMensaje({ ok: true, texto: `Listo: ${d.cargadas ?? d.rutas?.length ?? 0} rutas cargadas. Las asesoras las ven al recargar.` });
    } catch (err) {
      setMensaje({ ok: false, texto: err instanceof Error ? err.message : "No se pudo cargar el Excel." });
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }

  const visibles = verTodas ? rutas ?? [] : (rutas ?? []).filter((r) => r.dias.length < 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4 text-primary" aria-hidden="true" />
          Rutas de WYN (Costa Rica)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Días en que WYN entrega en cada zona rural. Kairo los muestra al confirmar, crear o reprogramar un pedido. Las zonas que no están
          en el Excel se toman como entrega diaria (lunes a sábado). Corte: confirmado antes de las 12 m. sale ese día y llega al hub al día
          siguiente.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {carga?.cargado_at
            ? `${carga.rutas} rutas · ${carga.archivo ?? "Excel"} · cargado ${fmtFecha(carga.cargado_at)}${carga.cargado_por ? ` por ${carga.cargado_por.replace(/^\d+:/, "")}` : ""}`
            : "Todavía no se cargó el Excel de WYN."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
            }}
          />
          <button
            type="button"
            disabled={subiendo}
            onClick={() => input.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {subiendo ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
            {subiendo ? "Cargando…" : "Cargar Excel nuevo de WYN"}
          </button>
          {mensaje && <p className={`text-xs ${mensaje.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{mensaje.texto}</p>}
        </div>
        {rutas && rutas.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {verTodas ? "Todas las rutas" : "Zonas que no tienen entrega diaria"}{" "}
              <button type="button" onClick={() => setVerTodas((v) => !v)} className="font-normal text-primary underline-offset-2 hover:underline">
                {verTodas ? "ver solo las no diarias" : `ver las ${rutas.length}`}
              </button>
            </p>
            <ul className="divide-y divide-border rounded-md border border-border text-[13px]">
              {visibles.map((r) => (
                <li key={r.ruta} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5">
                  <span className="text-foreground">
                    {r.ruta} <span className="text-xs text-muted-foreground">· {r.region}</span>
                  </span>
                  <span className="font-medium text-foreground">{nombresDias(r.dias)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
