"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { getVendedoraId, onVendedoraChange } from "@/lib/vendedora";
import {
  avisarResultadoLlamada,
  onMarcarTelnyx,
  sugerenciaDeLlamada,
  type ContextoLlamada,
  type LlamadaTelnyx,
} from "@/lib/telefonia-cliente";

// Telefono de Telnyx en el navegador (@telnyx/webrtc). A diferencia del widget
// de Zadarma, no inyecta nada en la pagina: la libreria solo maneja el audio y
// la barra de la llamada es nuestra. Y marca al cliente DIRECTO: no hay una
// primera pata que timbre a la asesora (ver lib/telnyx.ts).
//
// Se monta una vez por pagina (Leads y Gestion). Se conecta con un token de la
// credencial de la asesora (/api/telnyx/token) y queda esperando a que el
// boton "Llamar" pida marcar (lib/telefonia-cliente.ts).

// Lo minimo de la libreria que se usa. Se importa dinamico (solo navegador) y
// se tipa aqui para no depender de rutas internas del paquete.
interface LlamadaRTC {
  state: string;
  cause?: string;
  hangup(): Promise<void>;
  muteAudio(): void;
  unmuteAudio(): void;
}
interface ClienteRTC {
  remoteElement: HTMLMediaElement | string;
  on(evento: string, cb: (dato: unknown) => void): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  newCall(opciones: {
    destinationNumber: string;
    callerNumber: string;
    clientState: string;
    audio: boolean;
  }): LlamadaRTC;
}

type EstadoLlamada = "marcando" | "timbrando" | "en_llamada" | "terminada";

// Estados de @telnyx/webrtc (en minusculas) → lo que ve la asesora.
function estadoVisible(state: string): EstadoLlamada | null {
  switch (state) {
    case "new":
    case "requesting":
    case "trying":
    case "recovering":
      return "marcando";
    case "ringing":
    case "early":
      return "timbrando";
    case "active":
    case "held":
      return "en_llamada";
    case "hangup":
    case "destroy":
    case "purge":
      return "terminada";
    default:
      return null;
  }
}

const ETIQUETA: Record<EstadoLlamada, string> = {
  marcando: "Marcando…",
  timbrando: "Timbrando al cliente…",
  en_llamada: "En llamada",
  terminada: "Llamada terminada",
};

// Reconexiones seguidas antes de rendirse. Sin limite, un token vencido o
// Telnyx caido dejaria un lazo pidiendo tokens para siempre (paso con
// /api/zadarma/last-call el 29/08/2026, ver ZadarmaWebphone).
const MAX_RECONEXIONES = 5;
const AUDIO_ID = "kairo-telnyx-audio";

function duracion(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function TelnyxPhone() {
  const [vendedoraId, setVendedora] = useState<number | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoLlamada | null>(null);
  const [desde, setDesde] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [silenciado, setSilenciado] = useState(false);
  const cliente = useRef<ClienteRTC | null>(null);
  const llamada = useRef<LlamadaRTC | null>(null);
  // Para premarcar "Contestó" / "No contestó" al colgar: desde donde se llamo,
  // desde cuando suena el telefono DEL CLIENTE (no desde que se marco) y si
  // llego a contestar.
  const contexto = useRef<ContextoLlamada>({});
  const timbreDesde = useRef<number | null>(null);
  const contestada = useRef(false);

  useEffect(() => {
    setVendedora(getVendedoraId());
    return onVendedoraChange(setVendedora);
  }, []);

  // Conexion: token → cliente → listo. Se rehace si cambia la asesora.
  useEffect(() => {
    if (!vendedoraId) return;
    let cancelado = false;
    let reconexiones = 0;
    let timer: number | undefined;

    const conectar = async () => {
      try {
        const res = await fetch("/api/telnyx/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vendedora_id: vendedoraId }),
        });
        const data = (await res.json()) as { token?: string; error?: string };
        if (!res.ok || !data.token) throw new Error(data.error || "No se pudo conectar el teléfono");
        const { TelnyxRTC } = await import("@telnyx/webrtc");
        if (cancelado) return;
        const c = new TelnyxRTC({ login_token: data.token }) as unknown as ClienteRTC;
        c.remoteElement = AUDIO_ID;
        c.on("telnyx.ready", () => {
          reconexiones = 0;
          setListo(true);
          setError(null);
        });
        c.on("telnyx.error", (e) => {
          setListo(false);
          setError(e instanceof Error ? e.message : "Error del teléfono");
        });
        // Se cayo la conexion (token vencido, red): token nuevo y de nuevo,
        // espaciando cada intento.
        c.on("telnyx.socket.close", () => {
          setListo(false);
          if (cancelado || reconexiones >= MAX_RECONEXIONES) return;
          reconexiones += 1;
          timer = window.setTimeout(() => void conectar(), Math.min(2_000 * 2 ** reconexiones, 60_000));
        });
        c.on("telnyx.notification", (n) => {
          const dato = n as { type?: string; call?: LlamadaRTC };
          if (dato.type !== "callUpdate" || !dato.call) return;
          // El primer aviso puede llegar antes de que newCall devuelva la
          // llamada; otra llamada distinta de la nuestra no se muestra.
          if (llamada.current && dato.call !== llamada.current) return;
          if (!llamada.current && estadoVisible(dato.call.state) !== "marcando") return;
          llamada.current = dato.call;
          const visible = estadoVisible(dato.call.state);
          if (!visible) return;
          setEstado(visible);
          if (visible === "timbrando" && timbreDesde.current === null) timbreDesde.current = Date.now();
          if (visible === "en_llamada") {
            contestada.current = true;
            setDesde((d) => d ?? Date.now());
          }
          if (visible === "terminada") {
            const segundosTimbre = timbreDesde.current
              ? Math.round((Date.now() - timbreDesde.current) / 1000)
              : 0;
            avisarResultadoLlamada({
              contexto: contexto.current,
              segundosTimbre,
              sugerencia: sugerenciaDeLlamada({
                contestada: contestada.current,
                segundosTimbre,
                causa: dato.call.cause,
              }),
            });
            llamada.current = null;
            setSilenciado(false);
            // El aviso queda unos segundos para que se lea, y se va.
            window.setTimeout(() => {
              if (!llamada.current) {
                setEstado(null);
                setDesde(null);
              }
            }, 4_000);
          }
        });
        await cliente.current?.disconnect().catch(() => undefined);
        cliente.current = c;
        await c.connect();
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : "Teléfono no disponible");
      }
    };

    void conectar();
    return () => {
      cancelado = true;
      if (timer !== undefined) window.clearTimeout(timer);
      void cliente.current?.disconnect().catch(() => undefined);
      cliente.current = null;
      setListo(false);
    };
  }, [vendedoraId]);

  // El boton "Llamar" pide marcar.
  useEffect(
    () =>
      onMarcarTelnyx((pedido: LlamadaTelnyx) => {
        const c = cliente.current;
        if (!c || !listo) {
          setError("El teléfono todavía se está conectando: espera unos segundos y vuelve a llamar.");
          return;
        }
        if (llamada.current) {
          setError("Ya hay una llamada en curso: cuélgala antes de llamar a otro cliente.");
          return;
        }
        setError(null);
        setSilenciado(false);
        setDesde(null);
        setEstado("marcando");
        contexto.current = pedido.contexto ?? {};
        timbreDesde.current = null;
        contestada.current = false;
        llamada.current = c.newCall({
          destinationNumber: pedido.destino,
          callerNumber: pedido.callerNumber,
          clientState: pedido.clientState,
          audio: true,
        });
      }),
    [listo]
  );

  // Reloj de la llamada en curso.
  useEffect(() => {
    if (estado !== "en_llamada") return;
    const t = window.setInterval(() => setAhora(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [estado]);

  if (!vendedoraId) return null;

  const colgar = () => void llamada.current?.hangup().catch(() => undefined);
  const alternarSilencio = () => {
    const l = llamada.current;
    if (!l) return;
    if (silenciado) l.unmuteAudio();
    else l.muteAudio();
    setSilenciado(!silenciado);
  };
  const enCurso = estado !== null && estado !== "terminada";

  return (
    <>
      {/* El audio del cliente. Siempre montado: la libreria lo busca por id. */}
      <audio id={AUDIO_ID} autoPlay className="hidden" />

      {estado && (
        // Encima de los drawers (z-50 / z-[60]): se llama desde la ficha.
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 right-3 z-[70] flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
        >
          {estado === "marcando" || estado === "timbrando" ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Phone className={`h-4 w-4 ${estado === "en_llamada" ? "text-emerald-400" : "text-muted-foreground"}`} />
          )}
          <div className="text-sm">
            <p className="font-medium">{ETIQUETA[estado]}</p>
            {estado === "en_llamada" && desde && (
              <p className="text-xs tabular-nums text-muted-foreground">{duracion(Math.floor((ahora - desde) / 1000))}</p>
            )}
          </div>
          {enCurso && (
            <>
              <button
                type="button"
                onClick={alternarSilencio}
                disabled={estado !== "en_llamada"}
                aria-pressed={silenciado}
                aria-label={silenciado ? "Activar micrófono" : "Silenciar micrófono"}
                title={silenciado ? "Activar micrófono" : "Silenciar micrófono"}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {silenciado ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={colgar}
                aria-label="Colgar"
                title="Colgar"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:opacity-90"
              >
                <PhoneOff className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      )}

      {error && !estado && (
        // Aviso discreto, como el de Zadarma: nunca tapa el tablero.
        <p className="pointer-events-none fixed bottom-2 left-2 z-40 max-w-xs rounded-md bg-muted/90 px-2 py-1 text-[10px] text-muted-foreground">
          Teléfono: {error}
        </p>
      )}
    </>
  );
}
