"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import type { EstadoGrabacion } from "@/lib/grabaciones";

// La grabacion de una llamada en un historial (lead, pedido, novedad). El
// audio se pide recien al tocar "Escuchar": /api/calls/<id>/recording revisa
// tienda y permiso y redirige a una URL firmada de 10 minutos.
export default function GrabacionLlamada({
  callId,
  estado,
  className = "",
}: {
  callId: number;
  estado: EstadoGrabacion | null | undefined;
  className?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const [fallo, setFallo] = useState(false);

  if (!estado) return null;
  if (estado === "procesando") {
    return <span className={`text-[11px] italic text-muted-foreground ${className}`}>Grabación procesándose</span>;
  }
  if (estado === "no_disponible") {
    return <span className={`text-[11px] italic text-muted-foreground/70 ${className}`}>Grabación no disponible</span>;
  }
  if (fallo) {
    return <span className={`text-[11px] text-rose-400 ${className}`}>No se pudo cargar la grabación.</span>;
  }
  if (!abierta) {
    return (
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className={`inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground ${className}`}
      >
        <Play className="h-3 w-3" /> Escuchar
      </button>
    );
  }
  return (
    <audio
      controls
      autoPlay
      preload="none"
      src={`/api/calls/${callId}/recording`}
      onError={() => setFallo(true)}
      className={`h-8 w-full max-w-xs ${className}`}
    />
  );
}
