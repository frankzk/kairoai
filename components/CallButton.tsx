"use client";

import { useEffect, useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVendedoraId, onVendedoraChange } from "@/lib/vendedora";

// Boton "Llamar" del lead. No marca desde el navegador: le pide a la centralita
// que timbre la extension de la asesora (su propio navegador, por el widget
// WebRTC) y enseguida marque al cliente. Asi el audio va por la laptop y la
// llamada queda en el CDR aunque la asesora conteste desde el celular.

export default function CallButton({
  leadId,
  orderName,
  store,
  size = "sm",
}: {
  /** Lead del tablero de WhatsApp. */
  leadId?: number;
  /** Pedido de Shopify (#MCRC20388), para el drawer de Gestion de pedidos. */
  orderName?: string;
  store: string;
  size?: "sm" | "default";
}) {
  const [vendedoraId, setVendedora] = useState<number | null>(null);
  const [calling, setCalling] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setVendedora(getVendedoraId());
    return onVendedoraChange(setVendedora);
  }, []);

  async function call() {
    if (!vendedoraId) {
      setFeedback({ kind: "error", text: "Selecciona quién eres (abajo) antes de llamar." });
      return;
    }
    setCalling(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/zadarma/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store,
          vendedora_id: vendedoraId,
          lead_id: leadId,
          order_name: orderName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar la llamada");
      // La centralita acepto la peticion; que timbre depende de que el
      // telefono web este abierto. Decirlo asi y no "te estamos timbrando":
      // prometer el timbre y que no suene deja a la asesora esperando sin
      // saber que mirar.
      setFeedback({
        kind: "ok",
        text: "Llamada pedida. Debe timbrar tu teléfono web en unos segundos.",
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo iniciar la llamada",
      });
    } finally {
      setCalling(false);
      setTimeout(() => setFeedback(null), 6000);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size={size} variant="outline" onClick={call} disabled={calling}>
        {calling ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <PhoneCall className="mr-2 h-4 w-4" />
        )}
        Llamar
      </Button>
      {feedback && (
        <p
          className={`max-w-[16rem] text-right text-[10px] ${
            feedback.kind === "ok" ? "text-emerald-400" : "text-destructive"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
