// Que novedad deducir del tracking de Forza (Honduras). Modulo PURO.
//
// POR QUE EXISTE: Forza no informa intentos fallidos, motivos ni devoluciones,
// y no entrega un reporte de novedades. Su rastreo publico solo trae 5 hitos
// (Creado, Recibido por Forza, En instalaciones, En Ruta, Entregado), cada uno
// con la fecha de la ULTIMA vez que el paquete paso por ahi. Hasta ahora
// Honduras usaba la regla de Costa Rica (demora a los 14 dias del pedido): las
// 726 novedades que tuvo fueron demoras, y las 479 que se cerraron se cerraron
// solas porque el paquete llego. Las que importaban se veian tarde.
//
// Las senales salen de las fechas de los hitos. Los umbrales son los tiempos
// reales de Forza en 2.652 entregas de 60 dias (medidos el 12/10/2026).

import type { IncidentCategory } from "./incidents-types";

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/**
 * Horas en ruta sin entregarse para tomarlo como intento fallido. De "En Ruta"
 * a "Entregado" la mitad tarda 10,5 h y el 95% menos de 18,4 h.
 */
export const FORZA_HORAS_EN_RUTA = 24;

/**
 * Horas de vuelta en una bodega de Forza, despues de haber salido a ruta, para
 * tomarlo como intento fallido. Volver a instalaciones tambien es el paso
 * normal por una bodega intermedia: de los que volvieron y despues se
 * entregaron, 2 de cada 3 salieron en menos de 12 h.
 */
export const FORZA_HORAS_DE_VUELTA_EN_BODEGA = 24;

/** Horas desde "Creado" sin que Forza reciba el paquete. El 95% lo recibe en menos de 43 h. */
export const FORZA_HORAS_SIN_RECIBIR = 48;

/** Dias dentro de Forza sin salir nunca a ruta. De instalaciones a ruta el 95% tarda menos de 60 h. */
export const FORZA_DIAS_SIN_SALIR_A_RUTA = 3;

/**
 * Pedidos mas viejos no generan novedades: ya no hay venta que salvar. Habia 73
 * demoras pendientes de pedidos de enero a marzo, con la guia en "Creado".
 */
export const FORZA_DIAS_MAXIMOS_DEL_PEDIDO = 60;

export interface ForzaHitos {
  creado: number | null;
  recibido: number | null;
  instalaciones: number | null;
  ruta: number | null;
  entregado: number | null;
  /** Ciudad de la bodega del ultimo "En instalaciones" (Forza la manda en la descripcion). */
  bodega: string;
}

type HitoEvent = { title?: string | null; description?: string | null; date?: string | null };

// "En instalaciones" y "EN_INSTALACIONES" -> "ENINSTALACIONES".
function clave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

const HITO_POR_CLAVE: Record<string, keyof Omit<ForzaHitos, "bodega">> = {
  CREADO: "creado",
  RECIBIDOPORFORZA: "recibido",
  ENINSTALACIONES: "instalaciones",
  ENRUTA: "ruta",
  ENTREGADO: "entregado",
};

/** Fecha (epoch ms) de cada hito alcanzado. Un hito sin fecha todavia no paso. */
export function forzaHitos(events: HitoEvent[] | null | undefined): ForzaHitos {
  const hitos: ForzaHitos = { creado: null, recibido: null, instalaciones: null, ruta: null, entregado: null, bodega: "" };
  for (const ev of events ?? []) {
    const hito = HITO_POR_CLAVE[clave(String(ev.title ?? ""))];
    const at = Date.parse(String(ev.date ?? ""));
    if (!hito || Number.isNaN(at)) continue;
    if (hitos[hito] === null || at > (hitos[hito] as number)) {
      hitos[hito] = at;
      if (hito === "instalaciones") hitos.bodega = String(ev.description ?? "").trim();
    }
  }
  return hitos;
}

export interface SenalForza {
  category: Extract<IncidentCategory, "fallo_entrega" | "demora_entrega">;
  detail: string;
  /** Cuando se vio la falla: sirve para notar que una reprogramada volvio a fallar. */
  failureAt: string | null;
}

// Fecha corta en hora de Honduras (UTC-6, sin horario de verano).
function dia(ms: number): string {
  const d = new Date(ms - 6 * HORA_MS);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * La novedad que se deduce de los hitos, o null si el envio va en tiempo.
 *
 * El detalle usa fechas y no "lleva N dias": se reescribe en cada deteccion y
 * asi solo cambia cuando el paquete se mueve.
 */
export function senalForza(
  events: HitoEvent[] | null | undefined,
  orderCreatedAt: string | null | undefined,
  now: string
): SenalForza | null {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return null;
  const h = forzaHitos(events);
  if (h.entregado !== null) return null;

  const pedido = Date.parse(String(orderCreatedAt ?? ""));
  const inicio = Number.isNaN(pedido) ? h.creado : pedido;
  if (inicio !== null && nowMs - inicio > FORZA_DIAS_MAXIMOS_DEL_PEDIDO * DIA_MS) return null;

  const enBodega = h.bodega ? ` en ${h.bodega}` : "";

  if (h.ruta !== null) {
    // Salio a ruta y volvio a una bodega: si no vuelve a salir, no lo entregaron.
    if (h.instalaciones !== null && h.instalaciones > h.ruta) {
      if (nowMs - h.instalaciones < FORZA_HORAS_DE_VUELTA_EN_BODEGA * HORA_MS) return null;
      return {
        category: "fallo_entrega",
        detail: `Salio a ruta el ${dia(h.ruta)} y el ${dia(h.instalaciones)} volvio a la bodega de Forza${enBodega} sin entregarse: probable intento de entrega fallido`,
        failureAt: new Date(h.instalaciones).toISOString(),
      };
    }
    if (nowMs - h.ruta < FORZA_HORAS_EN_RUTA * HORA_MS) return null;
    return {
      category: "fallo_entrega",
      detail: `En ruta desde el ${dia(h.ruta)} y sigue sin entregarse: probable intento de entrega fallido`,
      failureAt: new Date(h.ruta).toISOString(),
    };
  }

  const dentroDesde = Math.max(h.recibido ?? 0, h.instalaciones ?? 0);
  if (dentroDesde > 0) {
    if (nowMs - dentroDesde < FORZA_DIAS_SIN_SALIR_A_RUTA * DIA_MS) return null;
    return {
      category: "demora_entrega",
      detail: `En Forza${enBodega} desde el ${dia(dentroDesde)} y todavia no sale a ruta`,
      failureAt: null,
    };
  }

  if (h.creado !== null && nowMs - h.creado >= FORZA_HORAS_SIN_RECIBIR * HORA_MS) {
    return {
      category: "demora_entrega",
      detail: `La guia se creo el ${dia(h.creado)} y Forza todavia no recibe el paquete: revisar con bodega`,
      failureAt: null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intentos de entrega fallidos
//
// La novedad dice si HOY hay una falla; el detalle ademas cuenta cuantos
// intentos fallidos hubo, y con eso decide si el segundo intento ya esta
// pagado (1 fallido) o si Forza ya no reintenta y hay que cobrar el nuevo envio
// (2 fallidos: Forza hace 2 intentos y el segundo viene incluido). Como Forza
// solo guarda la ULTIMA fecha de cada hito, el primer intento desaparece cuando
// el paquete sale a ruta de nuevo: Kairo tiene que recordar los que ya vio.
// Cada intento queda como un evento mas del tracking (grupo "failed"), que es lo
// que cuenta el detalle.

export const FORZA_CODIGO_INTENTO_FALLIDO = "INTENTO_FALLIDO";

export interface ForzaEventoTracking {
  code: string;
  group: string;
  title: string;
  description: string;
  date: string | null;
  note: string;
}

/**
 * El intento fallido que muestran hoy los hitos (salio a ruta y lleva mas de un
 * dia de vuelta en una bodega), o null. `note` guarda la fecha de salida a ruta:
 * identifica el intento entre lecturas.
 */
export function intentoFallidoVisible(
  events: HitoEvent[] | null | undefined,
  now: string
): ForzaEventoTracking | null {
  const nowMs = Date.parse(now);
  const h = forzaHitos(events);
  if (Number.isNaN(nowMs) || h.entregado !== null || h.ruta === null || h.instalaciones === null) return null;
  if (h.instalaciones <= h.ruta || nowMs - h.instalaciones < FORZA_HORAS_DE_VUELTA_EN_BODEGA * HORA_MS) return null;
  const enBodega = h.bodega ? ` en ${h.bodega}` : "";
  return {
    code: FORZA_CODIGO_INTENTO_FALLIDO,
    group: "failed",
    title: "Intento de entrega fallido",
    description: `Salio a ruta el ${dia(h.ruta)} y volvio a la bodega de Forza${enBodega} (deducido por Kairo)`,
    date: new Date(h.instalaciones).toISOString(),
    note: new Date(h.ruta).toISOString(),
  };
}

/**
 * Los hitos que acaba de mandar Forza, mas los intentos fallidos vistos en
 * lecturas anteriores y el que se ve ahora (sin repetir: uno por salida a ruta).
 */
export function conIntentosFallidos<T extends ForzaEventoTracking>(
  nuevos: T[],
  anteriores: ForzaEventoTracking[] | null | undefined,
  now: string
): Array<T | ForzaEventoTracking> {
  const intentos = new Map<string, ForzaEventoTracking>();
  for (const ev of anteriores ?? []) {
    if (ev.code === FORZA_CODIGO_INTENTO_FALLIDO && ev.note) intentos.set(ev.note, ev);
  }
  const visible = intentoFallidoVisible(nuevos, now);
  if (visible && !intentos.has(visible.note)) intentos.set(visible.note, visible);
  const hitos = nuevos.filter((ev) => ev.code !== FORZA_CODIGO_INTENTO_FALLIDO);
  return [...hitos, ...Array.from(intentos.values())];
}
