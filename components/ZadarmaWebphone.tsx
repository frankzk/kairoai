"use client";

import { useEffect, useRef, useState } from "react";
import { Phone } from "lucide-react";
import { getVendedoraId, onVendedoraChange } from "@/lib/vendedora";
import { onShowWebphone } from "@/lib/webphone";

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
// Se SUMA al z-index que ya trae cada nodo, no lo reemplaza. Fijar el mismo
// valor a todos aplana el orden interno del widget: sus capas quedan
// empatadas, decide el orden del DOM, y algo que deberia ir detras termina
// delante comiendose los clicks (asi se rompio el boton de colgar).
const Z_OFFSET = 2_000_000_000;
const Z_MAX = 2_147_483_647;

/**
 * Sube el widget por encima de todo lo nuestro, respetando su apilado interno.
 *
 * El script de Zadarma inyecta su markup en <body> con su propio z-index y no
 * expone forma de configurarlo, asi que en vez de adivinar sus clases (que
 * pueden cambiar con cada version del widget) se observa que agrega al montar
 * y se desplaza lo que ya tenia. Solo mira lo que aparece en la ventana de
 * carga del widget; despues deja de observar para no tocar nada de la app.
 */
function raiseWidgetAboveDrawers(onNode: (node: HTMLElement) => void): () => void {
  if (typeof document === "undefined") return () => {};

  const known = new Set<Node>(Array.from(document.body.children));
  // Cada nodo se desplaza UNA vez: los barridos de seguridad vuelven a pasar
  // por los mismos elementos y sumar dos veces los desordenaria igual.
  const raised = new WeakSet<HTMLElement>();

  const bump = (node: Node) => {
    if (!(node instanceof HTMLElement) || known.has(node) || raised.has(node)) return;
    const current = Number.parseInt(window.getComputedStyle(node).zIndex, 10);
    const next = Number.isFinite(current) ? current + Z_OFFSET : Z_OFFSET;
    node.style.setProperty("z-index", String(Math.min(next, Z_MAX)), "important");
    raised.add(node);
    onNode(node);
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
  // Nodos que el script de Zadarma inyecto: los mismos que subimos de
  // z-index son los que hay que ocultar y mostrar. No se vuelven a adivinar.
  const widgetNodes = useRef<HTMLElement[]>([]);
  const [mounted, setMounted] = useState(false);
  // Se muestra al pulsar "Llamar" y se oculta con el boton de la esquina.
  //
  // Hubo un intento de ocultarlo solo al colgar, envolviendo
  // `RTCPeerConnection` para saber cuando terminaba la llamada. Se revirtio:
  // el widget dejo de inicializarse ("WebrtcPhoneInterface is not defined") y
  // sin telefono no hay nada que ocultar. Que el widget dependa de globales
  // del navegador lo hace fragil a que se los toquen, aunque sea de forma
  // transparente. Poder llamar vale mas que la comodidad de que se cierre solo.
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  useEffect(() => () => stopRaising.current?.(), []);

  // Aplica la visibilidad a los nodos del widget. `display:none` no corta el
  // registro SIP ni el audio —eso es red, no pintado—, asi que la extension
  // sigue registrada y el timbre se escucha aunque el telefono este oculto.
  const applyVisibility = (node: HTMLElement, show: boolean) => {
    if (show) node.style.removeProperty("display");
    else node.style.setProperty("display", "none", "important");
  };

  useEffect(() => {
    visibleRef.current = visible;
    for (const node of widgetNodes.current) applyVisibility(node, visible);
  }, [visible]);

  // El boton "Llamar" pide que aparezca justo antes de que la centralita
  // timbre, para que la asesora no tenga que buscarlo.
  useEffect(() => onShowWebphone(() => setVisible(true)), []);


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
        stopRaising.current = raiseWidgetAboveDrawers((node) => {
          widgetNodes.current.push(node);
          applyVisibility(node, visibleRef.current);
        });

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
        setMounted(true);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Teléfono no disponible");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vendedoraId]);

  if (!vendedoraId) return null;

  if (error) {
    // Aviso discreto: nunca debe tapar el tablero ni bloquear el trabajo.
    return (
      <p className="pointer-events-none fixed bottom-2 left-2 z-40 max-w-xs rounded-md bg-muted/90 px-2 py-1 text-[10px] text-muted-foreground">
        Teléfono web: {error}
      </p>
    );
  }

  if (!mounted) return null;

  // Lanzador: el widget esta montado y registrado, pero oculto. Este boton es
  // la unica pista de que el telefono existe, y hace falta para las llamadas
  // ENTRANTES: se escuchan (el audio suena aunque este oculto) pero hay que
  // abrirlo para contestar.
  return (
    <button
      type="button"
      onClick={() => setVisible((open) => !open)}
      title={visible ? "Ocultar el teléfono web" : "Abrir el teléfono web"}
      aria-label={visible ? "Ocultar el teléfono web" : "Abrir el teléfono web"}
      aria-pressed={visible}
      className={`fixed bottom-3 right-3 z-40 flex h-10 w-10 items-center justify-center rounded-full border shadow-lg transition-colors ${
        visible
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      <Phone className="h-4 w-4" />
    </button>
  );
}
