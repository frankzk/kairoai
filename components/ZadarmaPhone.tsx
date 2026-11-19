"use client";

import { useEffect, useRef, useState } from "react";
import type { RTCSession } from "jssip/lib/RTCSession";
import type { UA } from "jssip/lib/UA";
import { AvisoTelefono, BarraLlamada, type EstadoLlamada } from "@/components/BarraLlamada";
import { getVendedoraId, onVendedoraChange } from "@/lib/vendedora";
import {
  avisarFalloProveedor,
  avisarResultadoLlamada,
  onMarcarZadarma,
  publicarEstadoTelefono,
  sugerenciaDeLlamada,
  type ContextoLlamada,
} from "@/lib/telefonia-cliente";
import {
  ZADARMA_ICE,
  ZADARMA_USER_AGENT,
  causaParaSugerencia,
  credencialesDeWebphone,
  destinoSip,
  esFalloDelProveedor,
  mensajeDeCausa,
  pedirDatosWebphone,
  type CredencialesSip,
} from "@/lib/zadarma-webrtc";

// Teléfono de Zadarma con la interfaz de Kairo (lib/zadarma-webrtc.ts explica
// cómo se conecta). Igual que el de Telnyx: la barra de la llamada es nuestra
// (components/BarraLlamada.tsx) y marca al cliente DIRECTO desde la extensión
// de la asesora, sin la pata previa que timbraba su teléfono.
//
// Zadarma cobra por segundo: por eso aquí no hay freno de buzón.

const AUDIO_ID = "kairo-zadarma-audio";
// Tope de la búsqueda de rutas de audio (ICE): sin él, Chrome puede tardar
// ~40 s en mandar la llamada si un servidor no responde.
const ICE_MAX_MS = 3_000;
// Reintentos cada vez más espaciados: con uno fijo cada 15 s, varias pestañas
// fallando a la vez hicieron que Zadarma frenara a Kairo ("rate limit by IP").
const REINTENTOS_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
const OPCIONES_MEDIA = { mediaConstraints: { audio: true, video: false }, pcConfig: { iceServers: ZADARMA_ICE } };

async function credenciales(vendedoraId: number, forzar: boolean): Promise<CredencialesSip> {
  const res = await fetch(`/api/zadarma/webphone?vendedora_id=${vendedoraId}${forzar ? "&force=1" : ""}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { sip?: string; key?: string; error?: string };
  if (!res.ok || !data.sip || !data.key) throw new Error(data.error || "No se pudo preparar el teléfono de Zadarma.");
  return credencialesDeWebphone(data.sip, await pedirDatosWebphone(data.key, data.sip));
}

function numeroDe(session: RTCSession): string {
  const uri = session.remote_identity?.uri;
  return String(uri?.user ?? "");
}

export default function ZadarmaPhone() {
  const [vendedoraId, setVendedora] = useState<number | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoLlamada | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [desde, setDesde] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [silenciado, setSilenciado] = useState(false);
  const [intento, setIntento] = useState(0);
  const ua = useRef<UA | null>(null);
  const dominio = useRef<string>("");
  const sesion = useRef<RTCSession | null>(null);
  const contexto = useRef<ContextoLlamada>({});
  const timbreDesde = useRef<number | null>(null);
  const contestada = useRef(false);
  const sono = useRef(false);

  useEffect(() => {
    setVendedora(getVendedoraId());
    return onVendedoraChange(setVendedora);
  }, []);

  // Una conexión por asesora. Si Zadarma rechaza la clave, se pide una llave
  // nueva una vez; si no conecta, se reintenta solo cada 15 s.
  useEffect(() => {
    if (!vendedoraId) return;
    let vivo = true;
    let reintento: number | undefined;
    let forzar = intento > 0;
    let agente: UA | null = null;
    let fallos = 0;
    const reintentar = () => {
      const espera = REINTENTOS_MS[Math.min(fallos, REINTENTOS_MS.length - 1)];
      fallos += 1;
      reintento = window.setTimeout(() => vivo && void conectar(), espera);
    };

    const conectar = async () => {
      setListo(false);
      try {
        const cred = await credenciales(vendedoraId, forzar);
        if (!vivo) return;
        const JsSIP = (await import("jssip")).default;
        if (!vivo) return;
        dominio.current = cred.domain;
        agente = new JsSIP.UA({
          sockets: [new JsSIP.WebSocketInterface(cred.wsUrl)],
          uri: cred.uri,
          authorization_user: cred.authUser,
          password: cred.password,
          register: true,
          user_agent: ZADARMA_USER_AGENT,
          connection_recovery_min_interval: 2,
          connection_recovery_max_interval: 30,
        });
        ua.current = agente;
        agente.on("registered", () => {
          if (!vivo) return;
          forzar = false;
          fallos = 0;
          setError(null);
          setListo(true);
        });
        agente.on("unregistered", () => vivo && setListo(false));
        agente.on("disconnected", () => {
          if (!vivo) return;
          setListo(false);
          setError("Se perdió la conexión con Zadarma: reconectando…");
        });
        agente.on("registrationFailed", (e: { cause?: string }) => {
          if (!vivo) return;
          setListo(false);
          setError(mensajeDeCausa(e.cause));
          agente?.stop();
          // Llave nueva solo una vez seguida: el servidor la renueva como
          // mucho cada 5 min (lib/zadarma-webrtc-db.ts).
          forzar = e.cause === "Authentication Error" && fallos === 0;
          reintentar();
        });
        agente.on("newRTCSession", (e: { originator: string; session: RTCSession }) => {
          if (e.originator !== "remote") return;
          // Una llamada a la vez: la segunda recibe "ocupado".
          if (sesion.current) {
            e.session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
            return;
          }
          seguirRef.current(e.session, "entrante");
          setDetalle(numeroDe(e.session) ? `+${numeroDe(e.session)}` : null);
        });
        agente.start();
      } catch (err) {
        if (!vivo) return;
        setListo(false);
        setError(err instanceof Error ? err.message : "No se pudo conectar con Zadarma.");
        forzar = false;
        reintentar();
      }
    };
    void conectar();
    return () => {
      vivo = false;
      window.clearTimeout(reintento);
      try {
        agente?.stop();
      } catch {
        // ya estaba detenido
      }
      if (ua.current === agente) ua.current = null;
      setListo(false);
    };
    // intento: "Reconectar teléfono" fuerza una conexión nueva.
  }, [vendedoraId, intento]);

  function audioRemoto(session: RTCSession) {
    const conectar = (pc: RTCPeerConnection) =>
      pc.addEventListener("track", (ev) => {
        const audio = document.getElementById(AUDIO_ID) as HTMLAudioElement | null;
        if (audio && ev.streams[0]) audio.srcObject = ev.streams[0];
      });
    if (session.connection) conectar(session.connection as unknown as RTCPeerConnection);
    else session.on("peerconnection", (e: { peerconnection: RTCPeerConnection }) => conectar(e.peerconnection));
  }

  function terminar(session: RTCSession, causa: string | null) {
    if (sesion.current !== session) return;
    const segundosTimbre = timbreDesde.current ? Math.round((Date.now() - timbreDesde.current) / 1000) : 0;
    const entrante = session.direction === "incoming";
    if (!entrante) {
      avisarResultadoLlamada({
        contexto: contexto.current,
        segundosTimbre,
        sugerencia: sugerenciaDeLlamada({ contestada: contestada.current, segundosTimbre, causa: causaParaSugerencia(causa) }),
      });
      if (esFalloDelProveedor(causa, sono.current || contestada.current)) {
        avisarFalloProveedor({ proveedor: "zadarma", motivo: mensajeDeCausa(causa), contexto: contexto.current });
      }
    }
    sesion.current = null;
    setSilenciado(false);
    setEstado("terminada");
    setDetalle(causa && !contestada.current ? mensajeDeCausa(causa) : null);
    window.setTimeout(() => {
      if (!sesion.current) {
        setEstado(null);
        setDesde(null);
        setDetalle(null);
      }
    }, 4_000);
  }

  function seguir(session: RTCSession, inicial: EstadoLlamada) {
    sesion.current = session;
    timbreDesde.current = null;
    contestada.current = false;
    sono.current = false;
    setSilenciado(false);
    setDesde(null);
    setDetalle(null);
    setEstado(inicial);
    let tope: number | undefined;
    session.on("icecandidate", (e: { ready: () => void }) => {
      if (!tope) tope = window.setTimeout(() => e.ready(), ICE_MAX_MS);
    });
    session.on("progress", () => {
      if (session.direction === "incoming") return;
      sono.current = true;
      if (timbreDesde.current === null) timbreDesde.current = Date.now();
      setEstado("timbrando");
    });
    session.on("accepted", () => {
      contestada.current = true;
      setEstado("en_llamada");
      setDetalle(null);
      setDesde((d) => d ?? Date.now());
    });
    session.on("ended", (e: { cause?: string }) => {
      window.clearTimeout(tope);
      terminar(session, e.cause ?? null);
    });
    session.on("failed", (e: { cause?: string }) => {
      window.clearTimeout(tope);
      terminar(session, e.cause ?? null);
    });
    audioRemoto(session);
  }

  // Los efectos de conexión y de marcar llaman siempre a la versión actual.
  const seguirRef = useRef(seguir);
  seguirRef.current = seguir;

  // El botón "Llamar" pide marcar.
  useEffect(
    () =>
      onMarcarZadarma((pedido) => {
        const agente = ua.current;
        if (!agente || !listo || !dominio.current) {
          setError("El teléfono todavía se está conectando: espera unos segundos y vuelve a llamar.");
          return;
        }
        if (sesion.current) {
          setError("Ya hay una llamada en curso: cuélgala antes de llamar a otro cliente.");
          return;
        }
        setError(null);
        contexto.current = pedido.contexto ?? {};
        try {
          const session = agente.call(destinoSip(pedido.destino, dominio.current), OPCIONES_MEDIA);
          seguirRef.current(session, "marcando");
        } catch (err) {
          sesion.current = null;
          setEstado(null);
          const motivo = err instanceof Error ? err.message : "No se pudo marcar.";
          setError(motivo);
          avisarFalloProveedor({ proveedor: "zadarma", motivo, contexto: contexto.current });
        }
      }),
    [listo],
  );

  // Lo que consulta el botón "Llamar" antes de pedir una llamada.
  const enCurso = estado !== null && estado !== "terminada";
  useEffect(
    () => publicarEstadoTelefono({ proveedor: "zadarma", listo, enCurso, motivo: error ?? undefined }),
    [listo, enCurso, error],
  );
  useEffect(() => () => publicarEstadoTelefono({ proveedor: null, listo: false, enCurso: false }), []);

  // Reloj de la llamada en curso.
  useEffect(() => {
    if (estado !== "en_llamada") return;
    const t = window.setInterval(() => setAhora(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [estado]);

  if (!vendedoraId) return null;

  const colgar = () => {
    const s = sesion.current;
    if (!s) return;
    try {
      if (estado === "entrante") s.terminate({ status_code: 486, reason_phrase: "Busy Here" });
      else s.terminate();
    } catch {
      // ya terminó
    }
  };
  const contestar = () => {
    try {
      sesion.current?.answer(OPCIONES_MEDIA);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo contestar.");
    }
  };
  const alternarSilencio = () => {
    const s = sesion.current;
    if (!s) return;
    if (silenciado) s.unmute({ audio: true });
    else s.mute({ audio: true });
    setSilenciado(!silenciado);
  };

  return (
    <>
      {/* El audio del cliente. Siempre montado. */}
      <audio id={AUDIO_ID} autoPlay className="hidden" />
      {estado && (
        <BarraLlamada
          estado={estado}
          desde={desde}
          ahora={ahora}
          silenciado={silenciado}
          detalle={detalle}
          onSilencio={alternarSilencio}
          onColgar={colgar}
          onContestar={contestar}
        />
      )}
      {error && !estado && <AvisoTelefono nombre="Zadarma" error={error} onReconectar={() => setIntento((n) => n + 1)} />}
    </>
  );
}
