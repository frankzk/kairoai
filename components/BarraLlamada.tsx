"use client";

import { Loader2, Mic, MicOff, Phone, PhoneIncoming, PhoneOff } from "lucide-react";

// La barra de la llamada en curso, igual para Telnyx y Zadarma: el estado, el
// reloj, silenciar y colgar. Cada telefono maneja su propia libreria de audio
// y le pasa aqui lo que la asesora tiene que ver.

export type EstadoLlamada = "entrante" | "marcando" | "timbrando" | "en_llamada" | "terminada";

const ETIQUETA: Record<EstadoLlamada, string> = {
  entrante: "Llamada entrante",
  marcando: "Marcando…",
  timbrando: "Timbrando al cliente…",
  en_llamada: "En llamada",
  terminada: "Llamada terminada",
};

function duracion(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BarraLlamada({
  estado,
  desde,
  ahora,
  silenciado,
  detalle,
  onSilencio,
  onColgar,
  onContestar,
}: {
  estado: EstadoLlamada;
  desde: number | null;
  ahora: number;
  silenciado: boolean;
  /** Debajo del estado: el numero que entra, o el motivo de un fallo. */
  detalle?: string | null;
  onSilencio: () => void;
  onColgar: () => void;
  /** Solo en una llamada entrante. */
  onContestar?: () => void;
}) {
  const enCurso = estado !== "terminada";
  return (
    // Encima de los drawers (z-50 / z-[60]): se llama desde la ficha.
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 right-3 z-[70] flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
    >
      {estado === "marcando" || estado === "timbrando" ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
      ) : estado === "entrante" ? (
        <PhoneIncoming className="h-4 w-4 text-emerald-500" aria-hidden="true" />
      ) : (
        <Phone className={`h-4 w-4 ${estado === "en_llamada" ? "text-emerald-400" : "text-muted-foreground"}`} aria-hidden="true" />
      )}
      <div className="text-sm">
        <p className="font-medium">{ETIQUETA[estado]}</p>
        {estado === "en_llamada" && desde ? (
          <p className="text-xs tabular-nums text-muted-foreground">{duracion(Math.floor((ahora - desde) / 1000))}</p>
        ) : detalle ? (
          <p className="max-w-[14rem] truncate text-xs tabular-nums text-muted-foreground">{detalle}</p>
        ) : null}
      </div>
      {estado === "entrante" && onContestar && (
        <button
          type="button"
          onClick={onContestar}
          aria-label="Contestar"
          title="Contestar"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white hover:opacity-90"
        >
          <Phone className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {enCurso && (
        <>
          {estado !== "entrante" && (
            <button
              type="button"
              onClick={onSilencio}
              disabled={estado !== "en_llamada"}
              aria-pressed={silenciado}
              aria-label={silenciado ? "Activar micrófono" : "Silenciar micrófono"}
              title={silenciado ? "Activar micrófono" : "Silenciar micrófono"}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {silenciado ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            onClick={onColgar}
            aria-label={estado === "entrante" ? "Rechazar" : "Colgar"}
            title={estado === "entrante" ? "Rechazar" : "Colgar"}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:opacity-90"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}

/** Aviso discreto de un telefono que no conecta: nunca tapa el tablero. */
export function AvisoTelefono({ nombre, error, onReconectar }: { nombre: string; error: string; onReconectar: () => void }) {
  return (
    <div role="status" className="fixed bottom-2 left-2 z-[70] max-w-xs rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      <p>
        Teléfono ({nombre}): {error}
      </p>
      <button type="button" onClick={onReconectar} className="mt-1 font-medium text-foreground underline underline-offset-2">
        Reconectar teléfono
      </button>
    </div>
  );
}
