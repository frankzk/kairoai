"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import type { ClienteHistorial, ClienteRiesgo } from "@/lib/cliente-historial";
import { cn } from "@/lib/utils";

// Historial de entrega del cliente (otros pedidos con su teléfono), como el
// globo "Entregas por transportadora" de iComfly: una línea corta con el
// veredicto y, al tocarla, el detalle por transportadora. Ayuda a decidir si
// se le despacha a quien ya devolvió.

const TONO: Record<ClienteRiesgo, { icon: typeof ShieldCheck; cls: string; label: string }> = {
  nuevo: { icon: UserPlus, cls: "text-muted-foreground", label: "Sin entregas previas" },
  confiable: { icon: ShieldCheck, cls: "text-emerald-300", label: "Recibe sus pedidos" },
  atencion: { icon: AlertTriangle, cls: "text-amber-300", label: "Devolvió antes" },
  riesgo: { icon: ShieldAlert, cls: "text-rose-300", label: "Devuelve seguido" },
};

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function resumenCorto(h: ClienteHistorial): string {
  if (h.total === 0) return "Primer pedido";
  const resueltos = h.entregados + h.devueltos;
  if (resueltos === 0) return `${plural(h.total, "pedido anterior", "pedidos anteriores")}, sin entregas aún`;
  return `${h.entregados}/${resueltos} entregados${h.devueltos ? ` · ${plural(h.devueltos, "devuelto", "devueltos")}` : ""}`;
}

export function ClienteHistorialChip({ historial, className }: { historial: ClienteHistorial; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const tono = TONO[historial.total === 0 ? "nuevo" : historial.riesgo];
  const Icon = tono.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn("relative mt-1 block", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        title={`${tono.label}. Toca para ver el detalle.`}
        className={cn(
          "inline-flex max-w-[200px] items-center gap-1 rounded text-left text-xs font-medium tabular-nums underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tono.cls
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{resumenCorto(historial)}</span>
      </button>
      {open && (
        <span
          id={panelId}
          role="dialog"
          aria-label="Historial de entrega del cliente"
          className="absolute left-0 top-full z-30 mt-1 block w-[280px] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 text-xs text-foreground shadow-lg"
        >
          <span className={cn("flex items-center gap-1.5 font-semibold", tono.cls)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
            {tono.label}
            {historial.tasa != null && <span className="ml-auto tabular-nums text-foreground">{historial.tasa.toLocaleString("es")} %</span>}
          </span>
          {historial.couriers.length > 0 && (
            <>
              <span className="mt-2 block font-medium text-foreground">Entregas por transportadora</span>
              <span className="mt-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
                <span className="text-muted-foreground" />
                <span className="text-right text-muted-foreground">Entr.</span>
                <span className="text-right text-muted-foreground">Dev.</span>
                <span className="text-right text-muted-foreground">% dev.</span>
                {historial.couriers.map((c) => {
                  const tot = c.entregados + c.devueltos;
                  return (
                    <span key={c.id} className="contents">
                      <span className="truncate text-foreground">{c.label}</span>
                      <span className="text-right">{c.entregados}</span>
                      <span className={cn("text-right", c.devueltos > 0 && "text-rose-300")}>{c.devueltos}</span>
                      <span className="text-right">{tot ? Math.round((c.devueltos / tot) * 100) : 0} %</span>
                    </span>
                  );
                })}
              </span>
            </>
          )}
          <span className="mt-2 block text-muted-foreground">
            {historial.total === 0
              ? "No hay otros pedidos con este teléfono."
              : `${plural(historial.total, "pedido anterior", "pedidos anteriores")}: ${[
                  plural(historial.entregados, "entregado", "entregados"),
                  plural(historial.devueltos, "devuelto", "devueltos"),
                  historial.enCamino ? `${historial.enCamino} en camino` : "",
                  historial.sinDespachar ? `${historial.sinDespachar} sin despachar` : "",
                  historial.cancelados ? plural(historial.cancelados, "cancelado", "cancelados") : "",
                ].filter(Boolean).join(", ")}.`}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground">Cuenta los otros pedidos con el mismo teléfono, no este.</span>
        </span>
      )}
    </span>
  );
}
