"use client";

import { useEffect, useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVendedoraId, onVendedoraChange, setVendedoraId } from "@/lib/vendedora";
import { NOMBRE_PROVEEDOR } from "@/lib/telefonia";
import {
  configTelefoniaCliente,
  estadoTelefonoActual,
  marcarTelnyx,
  marcarZadarma,
  motivoParaNoLlamar,
  onEstadoTelefono,
  onFalloProveedor,
  usarProveedor,
  type ConfigTelefonia,
  type ProveedorTelefonia,
} from "@/lib/telefonia-cliente";

// Boton "Llamar" del lead, pedido o novedad. El proveedor sale de la tienda
// (Configuracion › Telefonia): principal y, si hay, uno de respaldo. En los
// dos Kairo decide el numero (de la base) y el navegador marca al cliente
// directo con nuestra barra de llamada:
//   - Telnyx: /api/telnyx/llamada + components/TelnyxPhone.tsx (cobra por
//     minuto: frena las rellamadas al buzon del mismo dia).
//   - Zadarma: /api/zadarma/llamada + components/ZadarmaPhone.tsx (cobra por
//     segundo).
// Si el principal no conecta, o la llamada falla antes de sonar por un
// problema del proveedor, se ofrece / usa el de respaldo.

/** Espera a que el telefono de la pagina sea `proveedor` y este listo. */
function esperarListo(proveedor: ProveedorTelefonia, ms: number): Promise<boolean> {
  const ok = () => {
    const e = estadoTelefonoActual();
    return e.proveedor === proveedor && e.listo;
  };
  if (ok()) return Promise.resolve(true);
  if (ms <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const fin = (v: boolean) => {
      window.clearTimeout(t);
      quitar();
      resolve(v);
    };
    const t = window.setTimeout(() => fin(ok()), ms);
    const quitar = onEstadoTelefono(() => ok() && fin(true));
  });
}

const mismoContexto = (
  a: { leadId?: number; orderName?: string; incidentId?: number },
  b: { leadId?: number; orderName?: string; incidentId?: number },
) => (a.leadId ?? null) === (b.leadId ?? null) && (a.orderName ?? null) === (b.orderName ?? null) && (a.incidentId ?? null) === (b.incidentId ?? null);

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
  // Hoy ya contesto el buzon de este numero (lib/telnyx-buzon.ts): aviso con
  // "Llamar igual" en vez de marcar y pagar otro minuto.
  const [buzon, setBuzon] = useState<string | null>(null);
  // El proveedor fallo antes de sonar: se ofrece el de respaldo de la tienda.
  const [fallo, setFallo] = useState<{ motivo: string; respaldo: ProveedorTelefonia; de: ProveedorTelefonia } | null>(null);
  const [config, setConfig] = useState<ConfigTelefonia | null>(null);
  useEffect(() => {
    let vivo = true;
    void configTelefoniaCliente(store).then((c) => vivo && setConfig(c));
    return () => {
      vivo = false;
    };
  }, [store]);
  useEffect(
    () =>
      onFalloProveedor((f) => {
        if (!mismoContexto(f.contexto, { leadId, orderName, incidentId })) return;
        const respaldo = config?.respaldo;
        if (!respaldo || respaldo === f.proveedor) {
          setFeedback({ kind: "error", text: f.motivo });
          setTimeout(() => setFeedback(null), 15_000);
          return;
        }
        setFallo({ motivo: f.motivo, respaldo, de: f.proveedor });
      }),
    [config, leadId, orderName, incidentId],
  );

  useEffect(() => {
    setVendedora(getVendedoraId());
    return onVendedoraChange(setVendedora);
  }, []);

  const [planilla, setPlanilla] = useState<Array<{ id: number; name: string }> | null>(null);
  async function cargarPlanilla() {
    if (planilla) return;
    try {
      const res = await fetch("/api/finance/payroll-staff", { cache: "no-store" });
      const data = (await res.json()) as { staff?: Array<{ id: number; name: string; active?: boolean }> };
      setPlanilla((data.staff ?? []).filter((p) => p.active !== false));
    } catch {
      setFeedback({ kind: "error", text: "No se pudo cargar la lista de asesoras." });
    }
  }
  function elegirAsesora(id: number) {
    setVendedoraId(id);
    setPlanilla(null);
    // El telefono de esa asesora se conecta en unos segundos.
    setFeedback({ kind: "ok", text: "Listo: en unos segundos toca «Llamar»." });
    setTimeout(() => setFeedback(null), 8_000);
  }

  // Con Telnyx, mientras hay una llamada en curso el boton queda apagado: un
  // segundo clic creaba una llamada que el telefono nunca marcaba.
  const [enCurso, setEnCurso] = useState(false);
  useEffect(() => {
    setEnCurso(estadoTelefonoActual().enCurso);
    return onEstadoTelefono((e) => setEnCurso(e.enCurso));
  }, []);

  async function call(forzado?: ProveedorTelefonia) {
    if (!vendedoraId) {
      // Quien no esta vinculada a la planilla (supervision, logistica) elige
      // aqui mismo desde que telefono llama. Antes solo se le decia "Selecciona
      // quien eres (abajo)", y en Novedades no habia donde elegir.
      void cargarPlanilla();
      setFeedback(null);
      return;
    }
    setCalling(true);
    setFeedback(null);
    setBuzon(null);
    setFallo(null);
    const cfg = config ?? (await configTelefoniaCliente(store));
    let proveedor: ProveedorTelefonia = forzado ?? estadoTelefonoActual().proveedor ?? cfg.principal;
    let aviso = "";
    if (forzado) {
      usarProveedor(forzado);
    } else if (cfg.respaldo && proveedor === cfg.principal && !estadoTelefonoActual().listo && !estadoTelefonoActual().enCurso) {
      // El principal no esta listo: unos segundos si recien se esta
      // conectando; si ya mostro un error, de una al respaldo.
      const listo = await esperarListo(proveedor, estadoTelefonoActual().motivo ? 0 : 6_000);
      if (!listo) {
        aviso = `${NOMBRE_PROVEEDOR[proveedor]} no conectó: llamando por ${NOMBRE_PROVEEDOR[cfg.respaldo]} (respaldo).`;
        proveedor = cfg.respaldo;
        usarProveedor(proveedor);
        setFeedback({ kind: "ok", text: aviso });
        setTimeout(() => setFeedback((f) => (f?.text === aviso ? null : f)), 20_000);
      }
    }
    if (estadoTelefonoActual().proveedor !== proveedor || !estadoTelefonoActual().listo) {
      await esperarListo(proveedor, 15_000);
    }
    if (proveedor === "telnyx") await llamarConTelnyx(vendedoraId);
    else await llamarConZadarma(vendedoraId);
  }

  async function llamarConZadarma(vendedora: number) {
    const motivo = motivoParaNoLlamar(estadoTelefonoActual());
    if (motivo) {
      setFeedback({ kind: "error", text: motivo });
      setTimeout(() => setFeedback(null), 15_000);
      setCalling(false);
      return;
    }
    try {
      const res = await fetch("/api/zadarma/llamada", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, vendedora_id: vendedora, lead_id: leadId, order_name: orderName, incident_id: incidentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar la llamada");
      marcarZadarma({ destino: data.destino, contexto: { leadId, orderName, incidentId } });
    } catch (err) {
      setFeedback({ kind: "error", text: err instanceof Error ? err.message : "No se pudo iniciar la llamada" });
      setTimeout(() => setFeedback(null), 15_000);
    } finally {
      setCalling(false);
    }
  }

  async function llamarConTelnyx(vendedora: number, forzar = false) {
    // Antes de pedir la llamada: si el telefono no puede marcar, no se crea
    // nada (si no, quedaba en el historial como "marcando" para siempre).
    const motivo = motivoParaNoLlamar(estadoTelefonoActual());
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
          ...(forzar ? { forzar: true } : {}),
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === "buzon_hoy") {
        setBuzon(String(data.error || "Hoy ya contestó el buzón de este número."));
        return;
      }
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
      <Button size={size} variant="outline" onClick={() => void call()} disabled={calling || enCurso} aria-label="Llamar">
        {calling ? (
          <Loader2 className="h-4 w-4 animate-spin sm:mr-2" aria-hidden="true" />
        ) : (
          <PhoneCall className="h-4 w-4 sm:mr-2" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">Llamar</span>
      </Button>
      {!vendedoraId && planilla && (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => e.target.value && elegirAsesora(Number(e.target.value))}
          aria-label="Quién llama"
          className="h-8 max-w-[16rem] rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="" disabled>
            ¿Quién llama?
          </option>
          {planilla.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {buzon && (
        <div role="alert" className="max-w-[18rem] rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-right text-xs text-amber-300">
          <p>{buzon}</p>
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setBuzon(null)}
              className="rounded px-1.5 py-0.5 font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Entendido
            </button>
            <button
              type="button"
              disabled={calling || enCurso || !vendedoraId}
              onClick={() => {
                if (!vendedoraId) return;
                setBuzon(null);
                setCalling(true);
                void llamarConTelnyx(vendedoraId, true);
              }}
              className="rounded px-1.5 py-0.5 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Llamar igual
            </button>
          </div>
        </div>
      )}
      {fallo && (
        <div role="alert" className="max-w-[18rem] rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-right text-xs text-amber-700 dark:text-amber-300">
          <p>
            {NOMBRE_PROVEEDOR[fallo.de]}: {fallo.motivo}
          </p>
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFallo(null)}
              className="rounded px-1.5 py-0.5 font-medium text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cerrar
            </button>
            <button
              type="button"
              disabled={calling || enCurso || !vendedoraId}
              onClick={() => void call(fallo.respaldo)}
              className="rounded px-1.5 py-0.5 font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Llamar por {NOMBRE_PROVEEDOR[fallo.respaldo]}
            </button>
          </div>
        </div>
      )}
      {feedback && (
        // El aviso de exito es una INSTRUCCION, no una confirmacion: si no se
        // lee, la llamada no llega al cliente. Por eso va mas grande que el
        // resto de la letra chica de la ficha.
        <p
          className={`max-w-[16rem] text-right ${
            feedback.kind === "ok" ? "text-xs text-emerald-400" : "text-[11px] text-destructive"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
