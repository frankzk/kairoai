"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Truck } from "lucide-react";
import {
  DIAS_TODOS,
  esDiaDeRuta,
  fechaCorta,
  nombresDias,
  primerDiaDeRuta,
  proximasEntregas,
  rutaDeUbicacion,
  type RutaWyn,
  type UbicacionCliente,
} from "@/lib/wyn-rutas";
import { cn } from "@/lib/utils";

// Días de entrega de WYN para el cliente (Mejoras Kairo N.º 2): zona, días que
// pasa el camión, próxima entrega posible y la siguiente, y un verificador de
// fecha para reprogramar. Solo Mireva Costa Rica. Las rutas salen del Excel de
// WYN (Configuración › Rutas de WYN); una zona que no está se toma como diaria.

const TIENDA = "mireva-cr";
const RURALES = ["guanacaste", "limon", "puntarenas"];

let rutasCache: Promise<RutaWyn[]> | null = null;
function rutasWyn(): Promise<RutaWyn[]> {
  if (!rutasCache) {
    rutasCache = fetch("/api/wyn/rutas")
      .then((r) => (r.ok ? r.json() : { rutas: [] }))
      .then((d: { rutas?: RutaWyn[] }) => d.rutas ?? [])
      .catch(() => {
        rutasCache = null;
        return [];
      });
  }
  return rutasCache;
}

const normal = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export default function EntregaWyn({
  store,
  orderName,
  ubicacion: ubicacionDada,
  className,
}: {
  store: string;
  /** Pedido guardado: la dirección se lee de la base. */
  orderName?: string | null;
  /** O la ubicación que se está escribiendo (Crear pedido). */
  ubicacion?: UbicacionCliente | null;
  className?: string;
}) {
  const activa = store === TIENDA;
  const [rutas, setRutas] = useState<RutaWyn[] | null>(null);
  const [delPedido, setDelPedido] = useState<UbicacionCliente | null | undefined>(undefined);
  const [fecha, setFecha] = useState("");

  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    void rutasWyn().then((r) => vivo && setRutas(r));
    return () => {
      vivo = false;
    };
  }, [activa]);

  useEffect(() => {
    if (!activa || !orderName || ubicacionDada) return;
    let vivo = true;
    setDelPedido(undefined);
    fetch(`/api/wyn/ubicacion?store=${encodeURIComponent(store)}&order=${encodeURIComponent(orderName)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ubicacion: null }))
      .then((d: { ubicacion?: UbicacionCliente | null }) => vivo && setDelPedido(d.ubicacion ?? null))
      .catch(() => vivo && setDelPedido(null));
    return () => {
      vivo = false;
    };
  }, [activa, orderName, store, ubicacionDada]);

  const ubicacion = ubicacionDada ?? delPedido;
  const calculo = useMemo(() => {
    if (!rutas || !ubicacion) return null;
    const hay = [ubicacion.canton, ubicacion.distrito, ubicacion.direccion].some((x) => String(x ?? "").trim());
    if (!hay) return null;
    const zona = rutaDeUbicacion(rutas, ubicacion);
    const dias = zona?.ruta.dias ?? DIAS_TODOS;
    const rural = RURALES.some((p) => normal(ubicacion.provincia).includes(p));
    return { zona, dias, entregas: proximasEntregas(dias), verificar: !zona && rural };
  }, [rutas, ubicacion]);

  if (!activa) return null;
  if (!rutas || ubicacion === undefined) return null;

  const caja = cn("rounded-md border px-3 py-2 text-[13px]", className);
  if (!calculo) {
    return (
      <div className={cn(caja, "border-border bg-muted/30 text-muted-foreground")}>
        <Truck className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
        Entrega WYN: falta la dirección del cliente (cantón o distrito) para calcular los días.
      </div>
    );
  }

  const { zona, dias, entregas, verificar } = calculo;
  const elegida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
  const antes = elegida && elegida < entregas.entrega;
  const fuera = elegida && !esDiaDeRuta(dias, elegida);
  const opciones = elegida && (fuera || antes)
    ? [primerDiaDeRuta(dias, antes ? entregas.entrega : elegida)].map((f) => [f, primerDiaDeRuta(dias, sumarDia(f))])[0]
    : null;

  return (
    <section aria-label="Entrega WYN" className={cn(caja, "border-border bg-card")}>
      <p className="flex flex-wrap items-center gap-x-1.5 font-medium text-foreground">
        <Truck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        Entrega WYN ·{" "}
        {zona ? (
          <span>
            {zona.zona.replace(/\s*\(.*?\)|\s*\*/g, "")}{" "}
            <span className="font-normal text-muted-foreground">
              ({zona.ruta.region}
              {zona.ruta.hub ? `, hub ${zona.ruta.hub}` : ""})
            </span>
          </span>
        ) : (
          <span className="font-normal text-muted-foreground">zona fuera del calendario rural: entrega diaria</span>
        )}
      </p>
      <p className="mt-1 text-foreground">
        Días: <strong className="font-semibold">{nombresDias(dias)}</strong>
      </p>
      <p className="text-foreground">
        Próxima entrega: <strong className="font-semibold">{fechaCorta(entregas.entrega)}</strong>
        <span className="text-muted-foreground"> · si no se concreta: {fechaCorta(entregas.siguiente)}</span>
      </p>
      {zona?.ruta.nota && <p className="mt-0.5 text-xs text-muted-foreground">Nota de WYN: {zona.ruta.nota}</p>}
      {verificar && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          La zona no aparece en el calendario rural de WYN: verifica la cobertura antes de prometer la fecha.
        </p>
      )}
      <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        ¿El cliente pide otra fecha?
        <input
          type="date"
          value={fecha}
          min={entregas.despacho}
          onChange={(e) => setFecha(e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
        />
      </label>
      {elegida && !fuera && !antes && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          WYN entrega {zona ? `en ${zona.zona.replace(/\s*\(.*?\)|\s*\*/g, "")}` : "en la zona"} el {fechaCorta(elegida)}.
        </p>
      )}
      {elegida && (fuera || antes) && opciones && (
        <p role="alert" className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {antes
            ? `El ${fechaCorta(elegida)} es antes de la primera entrega posible.`
            : `WYN no pasa por la zona el ${fechaCorta(elegida)}.`}{" "}
          Opciones: {fechaCorta(opciones[0])} o {fechaCorta(opciones[1])}.
        </p>
      )}
    </section>
  );
}

function sumarDia(f: string): string {
  return new Date(new Date(`${f}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}
