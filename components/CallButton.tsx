"use client";

import { useEffect, useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVendedoraId, onVendedoraChange } from "@/lib/vendedora";
import { showWebphone } from "@/lib/webphone";
import {
  estadoTelefonoTelnyx,
  marcarTelnyx,
  motivoParaNoLlamar,
  onEstadoTelefono,
  proveedorTelefoniaCliente,
} from "@/lib/telefonia-cliente";

// Boton "Llamar" del lead. Dos telefonias, segun TELEFONIA en el servidor:
//   - Zadarma: no marca desde el navegador. Le pide a la centralita que timbre
//     la extension de la asesora (su propio navegador, por el widget WebRTC) y
//     enseguida marque al cliente.
//   - Telnyx: Kairo decide el numero y el caller ID (/api/telnyx/llamada) y el
//     navegador marca al cliente directo (components/TelnyxPhone.tsx).

export default function CallButton({
  leadId,
  orderName,
  incidentId,
  store,
  size = "sm",
}: {
  /** Lead del tablero de WhatsApp. */
  leadId?: number;
  /** Pedido de Shopify (#MCRC20388) o de iComfly (IC-...), para el drawer de Gestion de pedidos. */
  orderName?: string;
  /** Novedad de entrega, para su panel en Novedades. */
  incidentId?: number;
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

  // Con Telnyx, mientras hay una llamada en curso el boton queda apagado: un
  // segundo clic creaba una llamada que el telefono nunca marcaba.
  const [enCurso, setEnCurso] = useState(false);
  useEffect(() => {
    setEnCurso(estadoTelefonoTelnyx().enCurso);
    return onEstadoTelefono((e) => setEnCurso(e.enCurso));
  }, []);

  async function call() {
    if (!vendedoraId) {
      setFeedback({ kind: "error", text: "Selecciona quién eres (abajo) antes de llamar." });
      return;
    }
    setCalling(true);
    setFeedback(null);
    if ((await proveedorTelefoniaCliente()) === "telnyx") {
      await llamarConTelnyx(vendedoraId);
      return;
    }
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
          incident_id: incidentId,
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

  async function llamarConTelnyx(vendedora: number) {
    // Antes de pedir la llamada: si el telefono no puede marcar, no se crea
    // nada (si no, quedaba en el historial como "marcando" para siempre).
    const motivo = motivoParaNoLlamar(estadoTelefonoTelnyx());
    if (motivo) {
      setFeedback({ kind: "error", text: motivo });
      setTimeout(() => setFeedback(null), 15_000);
      setCalling(false);
      return;
    }
    try {
      const res = await fetch("/api/telnyx/llamada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store,
          vendedora_id: vendedora,
          lead_id: leadId,
          order_name: orderName,
          incident_id: incidentId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar la llamada");
      marcarTelnyx({
        destino: data.destino,
        callerNumber: data.caller_number,
        clientState: data.client_state,
        // Para que el panel que llamo premarque "Contestó" / "No contestó".
        contexto: { leadId, orderName, incidentId },
      });
      // El estado de la llamada lo muestra la barra del telefono (abajo a la
      // derecha); aqui no hace falta instruccion: no hay nada que contestar.
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "No se pudo iniciar la llamada" });
      setTimeout(() => setFeedback(null), 15_000);
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size={size} variant="outline" onClick={call} disabled={calling || enCurso}>
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
