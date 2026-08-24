"use client";

import { useEffect, useRef, useState } from "react";
import { getVendedoraId, onVendedoraChange } from "@/lib/vendedora";

// Widget WebRTC de Zadarma: convierte el navegador de la asesora en su
// telefono. Se monta una vez por sesion en el tablero de leads; a partir de
// ahi la extension queda registrada y el boton "Llamar" solo tiene que pedirle
// a la centralita que la timbre.
//
// La llave es temporal y por extension, y el dominio de Kairo debe estar
// autorizado en Zadarma (Ajustes -> Integraciones y API -> widget WebRTC).
//
// Zadarma advierte que el widget NO debe quedar en una pagina publica: quien
// la abra puede llamar a cuenta tuya. Por eso vive solo en /admin/leads, que
// esta detras del login (ver middleware.ts).
//
// Los scripts y la firma exacta salen del codigo que Zadarma publica en el
// area personal (my.zadarma.com/marketplace/#tab-webRtc -> "Codigo del
// widget"). Si Zadarma sube la version, se cambia aqui.

const LIB_SRC = "https://my.zadarma.com/webphoneWebRTCWidget/v9/js/loader-phone-lib.js?sub_v=1";
const FN_SRC = "https://my.zadarma.com/webphoneWebRTCWidget/v9/js/loader-phone-fn.js?sub_v=1";

/** Offsets de cada esquina, como los escribe el codigo oficial. */
const POSITION_OFFSETS: Record<string, Record<string, string>> = {
  bottom_right: { right: "10px", bottom: "5px" },
  bottom_left: { left: "10px", bottom: "5px" },
  top_right: { right: "10px", top: "5px" },
  top_left: { left: "10px", top: "5px" },
};

declare global {
  interface Window {
    zadarmaWidgetFn?: (
      key: string,
      sip: string,
      shape: "square" | "rounded",
      language: string,
      autoStart: boolean,
      // El codigo del area personal lo pasa como objeto, no como cadena.
      position: Record<string, string>
    ) => void;
  }
}

/**
 * El ejemplo oficial inicializa el widget en el evento `load`. Al montarse en
 * un efecto de React la pagina suele estar lista, pero no siempre: si todavia
 * hay recursos cargando se espera, porque inicializarlo antes deja el widget
 * mudo.
 */
function whenPageLoaded(): Promise<void> {
  if (typeof document === "undefined" || document.readyState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true });
  });
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`No se pudo cargar ${src}`)));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "1";
      resolve();
    });
    script.addEventListener("error", () => reject(new Error(`No se pudo cargar ${src}`)));
    document.body.appendChild(script);
  });
}

export default function ZadarmaWebphone() {
  const [vendedoraId, setVendedora] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Extension ya registrada: el widget no se puede reinicializar dos veces con
  // la misma, y hacerlo deja dos telefonos compitiendo por la linea.
  const mountedSip = useRef<string | null>(null);

  useEffect(() => {
    setVendedora(getVendedoraId());
    return onVendedoraChange(setVendedora);
  }, []);

  useEffect(() => {
    if (!vendedoraId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/zadarma/webphone?vendedora_id=${vendedoraId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          // Sin extension asignada o telefonia apagada: el tablero sigue
          // funcionando igual, solo que sin telefono en el navegador.
          setError(data.error ?? "Teléfono no disponible");
          return;
        }
        if (mountedSip.current === data.sip) return;
        if (mountedSip.current && mountedSip.current !== data.sip) {
          setError(
            "Cambiaste de asesora: recarga la página para registrar el teléfono con la nueva extensión."
          );
          return;
        }

        await loadScript(LIB_SRC);
        await loadScript(FN_SRC);
        await whenPageLoaded();
        if (cancelled) return;
        if (typeof window.zadarmaWidgetFn !== "function") {
          setError("El widget de Zadarma no cargó.");
          return;
        }
        // Forma y esquina salen de los ajustes del area personal, no del
        // codigo: cambiar la apariencia debe ser un click en Zadarma.
        window.zadarmaWidgetFn(
          data.key,
          data.sip,
          data.shape === "rounded" ? "rounded" : "square",
          data.language || "es",
          true,
          POSITION_OFFSETS[data.position] ?? POSITION_OFFSETS.bottom_right
        );
        mountedSip.current = data.sip;
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Teléfono no disponible");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vendedoraId]);

  if (!vendedoraId || !error) return null;

  // Aviso discreto: nunca debe tapar el tablero ni bloquear el trabajo.
  return (
    <p className="pointer-events-none fixed bottom-2 left-2 z-40 max-w-xs rounded-md bg-muted/90 px-2 py-1 text-[10px] text-muted-foreground">
      Teléfono web: {error}
    </p>
  );
}
