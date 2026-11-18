"use client";

// Inventario de ShipHero (bodega de Boxful) para todo el equipo: cuántas
// unidades hay de cada producto, sin preguntarle a la líder de tienda.
// Mejoras Kairo N.º 1 (18/11/2026). El cron lo renueva cada 15 min y
// "Actualizar ahora" lo lee de ShipHero en el momento.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  POCAS_UNIDADES,
  contarInventario,
  estadoStock,
  filtrarInventario,
  type EstadoStock,
  type FiltroInventario,
  type ItemInventario,
} from "@/lib/inventario";
import type { InventarioRespuesta } from "@/lib/inventario-db";
import { cn } from "@/lib/utils";

const STORE = "mireva-cr";

const FILTROS: Array<{ key: FiltroInventario; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "con_stock", label: "Con stock" },
  { key: "pocas", label: `Pocas unidades (≤${POCAS_UNIDADES})` },
  { key: "agotado", label: "Agotados" },
];

const TONO: Record<EstadoStock, { texto: string; punto: string; label: string }> = {
  con_stock: { texto: "text-foreground", punto: "bg-emerald-500", label: "Con stock" },
  pocas: { texto: "text-amber-600 dark:text-amber-300", punto: "bg-amber-500", label: "Pocas unidades" },
  agotado: { texto: "text-rose-600 dark:text-rose-300", punto: "bg-rose-500", label: "Agotado" },
};

const n = (v: number) => v.toLocaleString("es-CR", { maximumFractionDigits: 2 });

function haceCuanto(iso: string | null, ahora: number): string {
  if (!iso) return "sin lecturas";
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000));
  const hora = new Date(iso).toLocaleTimeString("es-CR", { hour: "numeric", minute: "2-digit", timeZone: "America/Costa_Rica" });
  if (min < 1) return `hace un momento (${hora})`;
  if (min < 60) return `hace ${min} min (${hora})`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h (${hora})`;
  return new Date(iso).toLocaleString("es-CR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Costa_Rica" });
}

function Disponible({ item }: { item: ItemInventario }) {
  const tono = TONO[estadoStock(item.disponible)];
  return (
    <span className={cn("inline-flex items-center justify-end gap-1.5 font-semibold tabular-nums", tono.texto)}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", tono.punto)} aria-hidden="true" />
      {n(item.disponible)}
      <span className="sr-only"> ({tono.label})</span>
    </span>
  );
}

export default function InventarioPage() {
  const [datos, setDatos] = useState<InventarioRespuesta | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState("");
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<FiltroInventario>("todos");
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/inventario?store=${STORE}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as (InventarioRespuesta & { error?: string }) | null;
      if (!res.ok || !json) throw new Error(json?.error || "No se pudo leer el inventario.");
      setDatos(json);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el inventario.");
    } finally {
      setCargando(false);
      setAhora(Date.now());
    }
  }, []);

  useEffect(() => {
    void cargar();
    // Se refresca sola (el cron trae una foto nueva cada 15 min) y el "hace X min" avanza.
    const id = window.setInterval(() => void cargar(), 5 * 60_000);
    const reloj = window.setInterval(() => setAhora(Date.now()), 30_000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(reloj);
    };
  }, [cargar]);

  async function actualizarAhora() {
    setLeyendo(true);
    setAviso("");
    try {
      const res = await fetch(`/api/inventario?store=${STORE}`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as (InventarioRespuesta & { error?: string }) | null;
      if (!res.ok || !json || json.error) {
        setAviso(json?.error || "No se pudo leer ShipHero.");
        return;
      }
      setDatos(json);
      setError("");
    } catch {
      setAviso("No se pudo leer ShipHero.");
    } finally {
      setLeyendo(false);
      setAhora(Date.now());
    }
  }

  const items = useMemo(() => datos?.items ?? [], [datos]);
  const conteo = useMemo(() => contarInventario(items), [items]);
  const visibles = useMemo(() => filtrarInventario(items, texto, filtro), [items, texto, filtro]);
  const conPendientes = items.some((i) => i.pendientes != null);
  const conEnCamino = items.some((i) => i.enCamino != null);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="container mx-auto flex items-start justify-between gap-3 px-4 py-4 sm:items-center sm:px-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Inventario</h1>
            <p className="text-[13px] text-muted-foreground">
              <span className="hidden sm:inline">Bodega de Boxful (ShipHero) · </span>
              {datos?.estado === "ok" ? <>Actualizado {haceCuanto(datos.actualizado, ahora)}</> : "Stock disponible por producto"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void actualizarAhora()}
            disabled={leyendo || datos?.estado !== "ok"}
            className="shrink-0 gap-1.5"
            title="Lee el stock de ShipHero en este momento (una vez cada 10 min)"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", leyendo && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            {leyendo ? "Leyendo ShipHero…" : "Actualizar ahora"}
          </Button>
        </div>
      </header>

      <main className="container mx-auto space-y-4 px-4 py-6 sm:px-6">
        {aviso && (
          <p role="status" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{aviso}</span>
            <button type="button" onClick={() => setAviso("")} aria-label="Cerrar aviso" className="rounded p-0.5 hover:bg-amber-500/20">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </p>
        )}
        {datos?.mensaje && datos.estado === "ok" && (
          <p className="flex items-start gap-2 text-[13px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {datos.mensaje}
          </p>
        )}

        {error ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-sm text-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => void cargar()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Reintentar
            </Button>
          </div>
        ) : !datos && cargando ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Cargando inventario…
          </p>
        ) : datos && datos.estado !== "ok" ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <Boxes className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm text-foreground">{datos.mensaje}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="relative block w-full sm:max-w-xs">
                <span className="sr-only">Buscar producto o SKU</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Buscar producto o SKU"
                  className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por stock">
                {FILTROS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFiltro(f.key)}
                    aria-pressed={filtro === f.key}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                      filtro === f.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:bg-muted",
                    )}
                  >
                    {f.label}
                    <span className={cn("tabular-nums", filtro === f.key ? "opacity-80" : "text-muted-foreground")}>{conteo[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Stock por producto en la bodega de Boxful</caption>
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border [&>th]:px-3 [&>th]:py-2.5 [&>th]:font-medium">
                    <th scope="col">Producto</th>
                    <th scope="col" className="text-right">Disponible</th>
                    <th scope="col" className="hidden text-right sm:table-cell" title="Unidades físicas en la bodega">En bodega</th>
                    <th scope="col" className="hidden text-right sm:table-cell" title="Apartadas para pedidos que aún no salen">Reservado</th>
                    {conEnCamino && <th scope="col" className="hidden text-right md:table-cell" title="Órdenes de compra abiertas">En camino</th>}
                    {conPendientes && <th scope="col" className="hidden text-right md:table-cell" title="Pedidos esperando que llegue stock">Pedidos esperando</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((i) => (
                    <tr key={i.sku} className="border-b border-border/60 last:border-b-0 [&>td]:px-3 [&>td]:py-2.5">
                      <th scope="row" className="px-3 py-2.5 text-left font-medium text-foreground">
                        {i.nombre}
                        {i.nombre !== i.sku && <span className="block text-xs font-normal tabular-nums text-muted-foreground">{i.sku}</span>}
                      </th>
                      <td className="text-right"><Disponible item={i} /></td>
                      <td className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{n(i.enBodega)}</td>
                      <td className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{n(i.reservado)}</td>
                      {conEnCamino && <td className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{i.enCamino ? n(i.enCamino) : "—"}</td>}
                      {conPendientes && (
                        <td className={cn("hidden text-right tabular-nums md:table-cell", i.pendientes ? "text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>
                          {i.pendientes ? n(i.pendientes) : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        {items.length === 0 ? "ShipHero no devolvió productos." : "Ningún producto coincide con la búsqueda."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              «Disponible» es lo que se puede vender ya: lo que hay en bodega menos lo reservado para pedidos que todavía no salen. Se renueva
              solo cada 15 minutos.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
