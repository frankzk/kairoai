// Lado navegador de la telefonia: que proveedor usa la tienda (Configuracion ›
// Telefonia, lib/telefonia.ts) y como le pide el boton "Llamar" al telefono de
// la pagina que marque.
//
// El boton y el telefono viven en arboles de componentes distintos (el boton
// en cada ficha, el telefono una vez por pagina), asi que se hablan con
// eventos de ventana.

import type { ConfigTelefonia, ProveedorTelefonia } from "@/lib/telefonia";

export type { ConfigTelefonia, ProveedorTelefonia };

const configs = new Map<string, Promise<ConfigTelefonia>>();

/**
 * Proveedor principal y de respaldo de la tienda. Se pregunta una vez por
 * pagina y tienda. Si la consulta falla se asume Telnyx sin respaldo, que es
 * lo que usaban todas las tiendas: un error aqui nunca debe dejar a la asesora
 * sin telefono.
 */
export function configTelefoniaCliente(store: string): Promise<ConfigTelefonia> {
  let config = configs.get(store);
  if (!config) {
    config = fetch(`/api/telefonia?store=${encodeURIComponent(store)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<ConfigTelefonia> | null): ConfigTelefonia => ({
        principal: d?.principal === "zadarma" ? "zadarma" : "telnyx",
        respaldo: d?.respaldo === "zadarma" || d?.respaldo === "telnyx" ? d.respaldo : null,
      }))
      .catch((): ConfigTelefonia => {
        configs.delete(store);
        return { principal: "telnyx", respaldo: null };
      });
    configs.set(store, config);
  }
  return config;
}

// ─── Cambiar al respaldo ─────────────────────────────────────────────────────
//
// El telefono de la pagina monta UN proveedor (con dos, la asesora quedaria
// registrada en dos centralitas). Si el principal no conecta, el boton
// "Llamar" pide pasar al de respaldo; queda asi hasta recargar la pagina o
// cambiar de tienda.

const USAR_EVENT = "kairo:telefono-usar";

export function usarProveedor(proveedor: ProveedorTelefonia): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ProveedorTelefonia>(USAR_EVENT, { detail: proveedor }));
}

export function onUsarProveedor(callback: (proveedor: ProveedorTelefonia) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<ProveedorTelefonia>).detail);
  window.addEventListener(USAR_EVENT, handler);
  return () => window.removeEventListener(USAR_EVENT, handler);
}

/** Desde donde se llamo: cada panel reconoce SU llamada con esto. */
export interface ContextoLlamada {
  leadId?: number;
  orderName?: string;
  incidentId?: number;
}

/** Llamada por el telefono propio de Zadarma (components/ZadarmaPhone.tsx). */
export interface LlamadaZadarma {
  /** Numero internacional sin "+": 50688887777. */
  destino: string;
  contexto?: ContextoLlamada;
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

/** Lo emite el telefono (Telnyx o Zadarma) al colgar. */
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

// ─── Estado del telefono de la pagina ───────────────────────────────────────
//
// El boton "Llamar" lo consulta ANTES de pedirle la llamada al servidor: si el
// telefono no esta conectado o ya hay una llamada en curso, no se crea nada.
// Antes el servidor creaba la llamada y el telefono la rechazaba despues, y
// quedaba en el historial como "marcando" para siempre (01/11/2026).

export interface EstadoTelefono {
  /** Que telefono esta montado (null = ninguno todavia). */
  proveedor?: ProveedorTelefonia | null;
  /** Conectado y listo para marcar. */
  listo: boolean;
  /** Hay una llamada marcando, timbrando o en curso. */
  enCurso: boolean;
  /** Current connection error, for the call button to explain why dialing is blocked. */
  motivo?: string;
}

let estadoTelefono: EstadoTelefono = { proveedor: null, listo: false, enCurso: false };
const ESTADO_EVENT = "kairo:telefono-estado";

/** Lo publica el telefono montado cada vez que cambia. */
export function publicarEstadoTelefono(estado: EstadoTelefono): void {
  estadoTelefono = estado;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<EstadoTelefono>(ESTADO_EVENT, { detail: estado }));
}

export function estadoTelefonoActual(): EstadoTelefono {
  return estadoTelefono;
}

export function onEstadoTelefono(callback: (estado: EstadoTelefono) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<EstadoTelefono>).detail);
  window.addEventListener(ESTADO_EVENT, handler);
  return () => window.removeEventListener(ESTADO_EVENT, handler);
}

/** Por que no se puede llamar ahora, o null si se puede. */
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

const MARCAR_ZADARMA_EVENT = "kairo:zadarma-marcar";

/** Pide al telefono de Zadarma de la pagina que marque. */
export function marcarZadarma(llamada: LlamadaZadarma): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LlamadaZadarma>(MARCAR_ZADARMA_EVENT, { detail: llamada }));
}

export function onMarcarZadarma(callback: (llamada: LlamadaZadarma) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<LlamadaZadarma>).detail);
  window.addEventListener(MARCAR_ZADARMA_EVENT, handler);
  return () => window.removeEventListener(MARCAR_ZADARMA_EVENT, handler);
}

// ─── El proveedor fallo antes de sonar ───────────────────────────────────────
//
// Conexion, credenciales, saldo: no es culpa del cliente. El boton que llamo
// ofrece el proveedor de respaldo de la tienda, si tiene.

export interface FalloProveedor {
  proveedor: ProveedorTelefonia;
  motivo: string;
  contexto: ContextoLlamada;
}

const FALLO_EVENT = "kairo:telefono-fallo";

export function avisarFalloProveedor(fallo: FalloProveedor): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FalloProveedor>(FALLO_EVENT, { detail: fallo }));
}

export function onFalloProveedor(callback: (fallo: FalloProveedor) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<FalloProveedor>).detail);
  window.addEventListener(FALLO_EVENT, handler);
  return () => window.removeEventListener(FALLO_EVENT, handler);
}
