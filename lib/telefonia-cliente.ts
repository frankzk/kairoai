// Lado navegador de la telefonia: que proveedor esta activo y como le pide el
// boton "Llamar" al telefono de Telnyx que marque.
//
// El boton y el telefono viven en arboles de componentes distintos (el boton
// en cada ficha, el telefono una vez por pagina), asi que se hablan con un
// evento de ventana, igual que lib/webphone.ts para el de Zadarma.

export type ProveedorTelefonia = "zadarma" | "telnyx";

let proveedor: Promise<ProveedorTelefonia> | null = null;

/**
 * El proveedor que configuro el servidor (TELEFONIA). Se pregunta una vez por
 * pagina. Si la consulta falla se asume Zadarma, que es lo que habia: un
 * error aqui nunca debe dejar a la asesora sin telefono.
 */
export function proveedorTelefoniaCliente(): Promise<ProveedorTelefonia> {
  if (!proveedor) {
    proveedor = fetch("/api/telefonia", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { proveedor?: string } | null) => (d?.proveedor === "telnyx" ? "telnyx" : "zadarma"))
      .catch(() => "zadarma" as const);
  }
  return proveedor;
}

/** Desde donde se llamo: cada panel reconoce SU llamada con esto. */
export interface ContextoLlamada {
  leadId?: number;
  orderName?: string;
  incidentId?: number;
}

export interface LlamadaTelnyx {
  /** Numero del cliente en E.164 con '+'. */
  destino: string;
  /** Numero de la tienda que ve el cliente. */
  callerNumber: string;
  /** Id de la llamada de Kairo, para el webhook. */
  clientState: string;
  contexto?: ContextoLlamada;
}

// ─── Como termino: para premarcar "Contestó" / "No contestó" ────────────────

/**
 * Segundos que tiene que sonar el telefono del CLIENTE para premarcar "No
 * contestó": unos 3 timbres (cada uno dura ~5 s). Si la asesora corta antes,
 * no se premarca nada: no seria justo darlo por no contestado al primer timbre.
 */
export const SEGUNDOS_TIMBRE_NO_CONTESTO = 15;

export type SugerenciaLlamada = "contesto" | "no_contesto";

/**
 * Que premarcar al colgar. Solo premarca: la asesora lo confirma con un clic.
 * - Contesto el cliente → "Contestó".
 * - Ocupado o rechazada → "No contestó" (el cliente corto, no la asesora).
 * - Sono al menos SEGUNDOS_TIMBRE_NO_CONTESTO sin contestar → "No contestó".
 * - Cualquier otra cosa (se corto antes, no llego a sonar) → nada.
 */
export function sugerenciaDeLlamada(r: {
  contestada: boolean;
  segundosTimbre: number;
  causa?: string | null;
}): SugerenciaLlamada | null {
  if (r.contestada) return "contesto";
  const causa = String(r.causa ?? "").toUpperCase();
  if (causa === "USER_BUSY" || causa === "CALL_REJECTED") return "no_contesto";
  return r.segundosTimbre >= SEGUNDOS_TIMBRE_NO_CONTESTO ? "no_contesto" : null;
}

export interface ResultadoLlamada {
  contexto: ContextoLlamada;
  sugerencia: SugerenciaLlamada | null;
  segundosTimbre: number;
}

const RESULTADO_EVENT = "kairo:resultado-llamada";

/** Lo emite el telefono de Telnyx al colgar. */
export function avisarResultadoLlamada(resultado: ResultadoLlamada): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ResultadoLlamada>(RESULTADO_EVENT, { detail: resultado }));
}

/** Lo escucha cada panel; filtra por su lead, pedido o novedad. */
export function onResultadoLlamada(callback: (resultado: ResultadoLlamada) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<ResultadoLlamada>).detail);
  window.addEventListener(RESULTADO_EVENT, handler);
  return () => window.removeEventListener(RESULTADO_EVENT, handler);
}

// ─── Estado del telefono de Telnyx ──────────────────────────────────────────
//
// El boton "Llamar" lo consulta ANTES de pedirle la llamada al servidor: si el
// telefono no esta conectado o ya hay una llamada en curso, no se crea nada.
// Antes el servidor creaba la llamada y el telefono la rechazaba despues, y
// quedaba en el historial como "marcando" para siempre (01/11/2026).

export interface EstadoTelefono {
  /** Conectado a Telnyx y listo para marcar. */
  listo: boolean;
  /** Hay una llamada marcando, timbrando o en curso. */
  enCurso: boolean;
  /** Current connection error, for the call button to explain why dialing is blocked. */
  motivo?: string;
}

let estadoTelefono: EstadoTelefono = { listo: false, enCurso: false };
const ESTADO_EVENT = "kairo:telnyx-estado";

/** Lo publica el telefono de Telnyx cada vez que cambia. */
export function publicarEstadoTelefono(estado: EstadoTelefono): void {
  estadoTelefono = estado;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EstadoTelefono>(ESTADO_EVENT, { detail: estado }));
}

export function estadoTelefonoTelnyx(): EstadoTelefono {
  return estadoTelefono;
}

export function onEstadoTelefono(callback: (estado: EstadoTelefono) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<EstadoTelefono>).detail);
  window.addEventListener(ESTADO_EVENT, handler);
  return () => window.removeEventListener(ESTADO_EVENT, handler);
}

/** Por que no se puede llamar ahora con Telnyx, o null si se puede. */
export function motivoParaNoLlamar(estado: EstadoTelefono): string | null {
  if (estado.enCurso) return "Ya hay una llamada en curso: cuélgala antes de llamar a otro cliente.";
  if (!estado.listo) return estado.motivo || "El teléfono todavía se está conectando: espera unos segundos y vuelve a llamar.";
  return null;
}

const MARCAR_EVENT = "kairo:telnyx-marcar";

/** Pide al telefono de Telnyx de la pagina que marque. */
export function marcarTelnyx(llamada: LlamadaTelnyx): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LlamadaTelnyx>(MARCAR_EVENT, { detail: llamada }));
}

export function onMarcarTelnyx(callback: (llamada: LlamadaTelnyx) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<LlamadaTelnyx>).detail);
  window.addEventListener(MARCAR_EVENT, handler);
  return () => window.removeEventListener(MARCAR_EVENT, handler);
}
