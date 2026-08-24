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

// Por encima de los drawers de Kairo (z-50). El telefono tiene que estar
// SIEMPRE arriba: es lo que timbra, y si queda tapado la asesora tiene que
// cerrar el pedido —perdiendo lo que estaba leyendo— para poder contestar.
const WIDGET_Z_INDEX = "2147483000";

/**
 * Sube el widget por encima de todo lo nuestro.
 *
 * El script de Zadarma inyecta su markup en <body> con su propio z-index y no
 * expone forma de configurarlo, asi que en vez de adivinar sus clases (que
 * pueden cambiar con cada version del widget) se observa que agrega al montar
 * y se le fija el z-index a eso. Solo mira lo que aparece en la ventana de
 * carga del widget; despues deja de observar para no tocar nada de la app.
 */
function raiseWidgetAboveDrawers(): () => void {
  if (typeof document === "undefined") return () => {};

  const known = new Set<Node>(Array.from(document.body.children));
  const bump = (node: Node) => {
    if (!(node instanceof HTMLElement) || known.has(node)) return;
    node.style.setProperty("z-index", WIDGET_Z_INDEX, "important");
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(bump);
  });
  observer.observe(document.body, { childList: true });

  // Red de seguridad por si el widget se monta sin pasar por el observer
  // (p.ej. si el script ya estaba cargado de una visita anterior).
  const sweeps = [500, 2000, 6000].map((delay) =>
    window.setTimeout(() => {
      for (const child of Array.from(document.body.children)) bump(child);
    }, delay)
  );

  const stop = () => {
    observer.disconnect();
    sweeps.forEach((id) => window.clearTimeout(id));
  };
  const stopTimer = window.setTimeout(stop, 20_000);
  return () => {
    stop();
    window.clearTimeout(stopTimer);
  };
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
  const stopRaising = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRaising.current?.(), []);

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
        // Se empieza a observar ANTES de montar: lo que el script agregue a
        // partir de aqui es el widget, y hay que subirlo sobre los drawers.
        stopRaising.current?.();
        stopRaising.current = raiseWidgetAboveDrawers();

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
