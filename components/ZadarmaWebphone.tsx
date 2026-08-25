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

/**
 * Avisa cuando hay o deja de haber una llamada en curso.
 *
 * El widget no expone ninguna API para esto, pero toda llamada WebRTC pasa
 * por `RTCPeerConnection`, que es estandar del navegador. Se envuelve el
 * constructor ANTES de cargar el script del widget y se escucha su cambio de
 * estado. Esto NO es adivinar el markup de Zadarma —eso ya nos rompio el boton
 * de colgar—: es una interfaz del W3C que el widget tiene que usar si o si.
 *
 * La subclase es transparente: no cambia comportamiento, solo observa. Al
 * desmontar se restaura el constructor original.
 */
function watchWebrtcCalls(onActiveChange: (active: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const Original = window.RTCPeerConnection;
  if (typeof Original !== "function") return () => {};

  const live = new Set<RTCPeerConnection>();
  const sync = () => onActiveChange(live.size > 0);

  class Observed extends Original {
    constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
      super(...args);
      this.addEventListener("connectionstatechange", () => {
        const state = this.connectionState;
        if (state === "connecting" || state === "connected") live.add(this);
        else if (state === "closed" || state === "failed" || state === "disconnected") {
          live.delete(this);
        }
        sync();
      });
    }
  }

  window.RTCPeerConnection = Observed as unknown as typeof RTCPeerConnection;
  return () => {
    window.RTCPeerConnection = Original;
    live.clear();
  };
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
  // Tres razones para estar a la vista, y hace falta distinguirlas: si no,
  // el telefono se queda pegado despues de colgar (que fue justo el reporte)
  // o desaparece en mitad de una llamada.
  //   pinned    -> la asesora lo abrio con el boton; manda sobre todo lo demas
  //   callActive-> hay una llamada en curso; mientras dure no se oculta
  //   awaiting  -> pulso "Llamar" y la centralita todavia no timbra
  const [pinned, setPinned] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const visible = pinned || callActive || awaiting;
  const visibleRef = useRef(false);
  const awaitingTimer = useRef<number | null>(null);

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
  // timbre, para que la asesora no tenga que buscarlo. La espera caduca: si
  // la llamada nunca entra, el telefono no se queda abierto para siempre.
  useEffect(
    () =>
      onShowWebphone(() => {
        setAwaiting(true);
        if (awaitingTimer.current) window.clearTimeout(awaitingTimer.current);
        awaitingTimer.current = window.setTimeout(() => setAwaiting(false), 60_000);
      }),
    []
  );

  // Se empieza a observar antes de que el widget cargue, para no perderse la
  // primera llamada. Al conectar se cancela la espera; al colgar, si la
  // asesora no lo dejo abierto a proposito, el telefono se oculta solo.
  useEffect(() => {
    const stop = watchWebrtcCalls((active) => {
      setCallActive(active);
      if (active) {
        setAwaiting(false);
        if (awaitingTimer.current) window.clearTimeout(awaitingTimer.current);
      }
    });
    return () => {
      stop();
      if (awaitingTimer.current) window.clearTimeout(awaitingTimer.current);
    };
  }, []);

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
      onClick={() => {
        setPinned((open) => !open);
        setAwaiting(false);
      }}
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
