"use client";

import { useEffect, useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVendedoraId, onVendedoraChange } from "@/lib/vendedora";
import { showWebphone } from "@/lib/webphone";

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
    // El telefono web vive oculto; se abre aqui para que este a la vista
    // cuando la centralita timbre en unos segundos.
    showWebphone();
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
      // La centralita NO marca al cliente de una: primero timbra el telefono
      // web de la asesora y solo cuando ella descuelga marca al cliente. Hay
      // que decir eso y no "debe timbrar tu telefono", que se lee como que ya
      // esta sonando el del cliente y no hay nada que hacer.
      //
      // Medido: en 5 dias, 72 llamadas murieron en esa pata porque nadie
      // descolgo. Ninguna llego a marcarse al cliente, y en el tablero se veian
      // como "cancelada", o sea como si el cliente hubiera colgado.
      setFeedback({
        kind: "ok",
        text: "Va a timbrar TU teléfono: contestá el botón verde y ahí se marca al cliente.",
      });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "No se pudo iniciar la llamada",
      });
    } finally {
      setCalling(false);
      // 15s y no 6: el aviso tiene que seguir en pantalla cuando el telefono
      // empieza a timbrar (tarda unos segundos) y mientras dura el timbre. Si
      // desaparece antes, la asesora ve sonar algo sin la instruccion al lado.
      setTimeout(() => setFeedback(null), 15_000);
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
        // El aviso de exito es una INSTRUCCION, no una confirmacion: si no se
        // lee, la llamada no llega al cliente. Por eso va mas grande que el
        // resto de la letra chica de la ficha.
        <p
          className={`max-w-[16rem] text-right ${
            feedback.kind === "ok" ? "text-xs text-emerald-400" : "text-[10px] text-destructive"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
