// Interpreta el historial completo de una guia de Forza (Honduras). Modulo PURO.
//
// POR QUE EXISTE: Kairo leia de Forza solo los 5 hitos de su linea de tiempo
// (Creado, Recibido, En instalaciones, En Ruta, Entregado), cada uno con la
// fecha de la ULTIMA vez que el paquete paso por ahi. Las incidencias no
// estaban: las deducia de las fechas y llegaban a Novedades uno o dos dias
// tarde, sin el motivo (caso #MIRH20879: Forza valido "destinatario no responde
// las llamadas" el 16/10 y Kairo abrio la novedad el 18/10). Y una devolucion se
// veia como "Entregado".
//
// La misma consulta que usa la pagina de rastreo (GetNewDeliveryTracking) trae
// el historial completo en order.milestones. Etapas (stageId) vistas en 150
// guias de julio a octubre de 2026:
//   1 Solicitado · 2 Recolectado · 11 Arribo a las instalaciones · 10 En
//   Inventario · 19 En Transito · 46 En escala · 20 Traslado a Express Center ·
//   22 Entregado En Express Center (espera que el cliente lo retire) · 4 En ruta
//   · 45 Incidencia en ruta (el intento fallido: motivo en description y tipo en
//   clasification) · 50 Incidencia Validada (lo que decide su call center:
//   "se programa segunda visita", "se gestiona devolucion") · 8 Paquete
//   Retornado para Reproceso (volvio a la bodega) · 5 Entregado · 25 COD pagado
//   · 14 Devuelto · 7 Anulado.

export type ForzaHistorialGroup = "delivered" | "failed" | "returned" | "cancelled" | "in_progress";

export interface ForzaHistorialEvent {
  code: string;
  group: ForzaHistorialGroup;
  title: string;
  description: string;
  date: string | null;
  note: string;
}

export interface ForzaHistorial {
  /** Del mas reciente al mas viejo. */
  events: ForzaHistorialEvent[];
  group: ForzaHistorialGroup;
  /** El intento fallido vigente (solo si group = "failed"). */
  ultimaFalla: ForzaHistorialEvent | null;
  /** Motivo del intento fallido vigente, con lo que decidio Forza despues. */
  motivo: string;
}

// Codigo de cada etapa. Los primeros conservan el vocabulario de los 5 hitos
// (CREADO, RECIBIDO_POR_FORZA, EN_INSTALACIONES, EN_RUTA, ENTREGADO) porque de
// ahi leen la fecha de preparacion (getForzaPrepareAt) y las demoras
// (lib/forza-novedades.ts).
const CODIGO_POR_ETAPA: Record<number, string> = {
  1: "CREADO",
  2: "RECIBIDO_POR_FORZA",
  11: "EN_INSTALACIONES",
  10: "EN_INVENTARIO",
  19: "EN_TRANSITO",
  46: "EN_ESCALA",
  20: "TRASLADO_EXPRESS_CENTER",
  22: "EN_EXPRESS_CENTER",
  4: "EN_RUTA",
  45: "INCIDENCIA_EN_RUTA",
  50: "INCIDENCIA_VALIDADA",
  8: "RETORNADO_PARA_REPROCESO",
  5: "ENTREGADO",
  25: "COD_PAGADO",
  14: "DEVUELTO",
  7: "ANULADO",
};

const ETAPA = { RUTA: 4, INCIDENCIA: 45, VALIDADA: 50, REPROCESO: 8, ENTREGADO: 5, COD_PAGADO: 25, DEVUELTO: 14, ANULADO: 7 };

type RawMilestone = {
  stageId?: unknown;
  title?: unknown;
  description?: unknown;
  clasification?: unknown;
  date?: unknown;
};

function texto(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, " ").trim() : "";
}

/**
 * Forza manda "2026-10-16 12:59:14Z", pero es hora de Honduras: la pagina la
 * muestra tal cual y las entregas caen de 9 a 18 h. La "Z" es falsa; leerla
 * como UTC corria todo 6 horas.
 */
export function fechaForza(value: unknown): string | null {
  const raw = texto(value);
  const iso = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?Z?$/.exec(raw);
  if (iso) return new Date(`${iso[1]}T${iso[2]}:${iso[3] ?? "00"}-06:00`).toISOString();
  // "10/15/2026 3:06:18 PM" (la consulta vieja, GetTrackingPublic).
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(raw);
  if (us) {
    let [mes, dia] = [Number(us[1]), Number(us[2])];
    if (mes > 12 && dia <= 12) [mes, dia] = [dia, mes];
    let horas = Number(us[4] ?? 0);
    const meridiano = String(us[7] ?? "").toUpperCase();
    if (meridiano === "PM" && horas < 12) horas += 12;
    if (meridiano === "AM" && horas === 12) horas = 0;
    const ms = Date.UTC(Number(us[3]), mes - 1, dia, horas + 6, Number(us[5] ?? 0), Number(us[6] ?? 0));
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  return null;
}

/**
 * Nota del call center de Forza sin el telefono ni los codigos que antepone, y
 * sin la coletilla de la evidencia ("ACEPTA EVIDENCIA POR INFORMACION CLARA").
 * "50499550648 Destinatario no responde las llamadas. Se programa segunda
 * visita." -> "Destinatario no responde las llamadas. Se programa segunda visita."
 */
export function limpiarNotaForza(value: unknown): string {
  const limpia = texto(value)
    .replace(/\s*-*\s*(se\s+)?(acepta|declina)\w*\s+(la\s+)?evidencia[^.]*\.?/gi, "")
    .replace(/\s*-*\s*se\s+declina\s+por\s+falta\s+de\s+informaci[oó]n[^.]*\.?/gi, "")
    // Telefono y codigo del caso al principio: "+504 9948-7434 - -", "C/E99550648-",
    // "S/E 50499635943", "95798388c/e", "/C/E -".
    .replace(/^(?:[\s+()./\\:–-]|\d|[a-z]\/e)+/i, "")
    .replace(/[\s,;:–-]+$/, "")
    .trim();
  return limpia.charAt(0).toUpperCase() + limpia.slice(1);
}

/**
 * Eventos, estado vigente y motivo a partir de order.milestones. Null si no hay
 * historial (la guia se lee con la consulta vieja).
 *
 * Un intento de entrega es una salida a ruta que no termina en entrega: cuenta
 * como fallido la "Incidencia en ruta" o, si Forza no la registro, la vuelta a
 * la bodega ("Retornado para Reproceso"). Un intento por salida: el detalle de
 * la novedad los cuenta para decidir si queda el intento pagado o hay que cobrar
 * un nuevo envio.
 */
export function interpretarHistorialForza(milestones: unknown): ForzaHistorial | null {
  if (!Array.isArray(milestones) || !milestones.length) return null;
  const crudos = (milestones as RawMilestone[])
    .map((m) => ({ etapa: Number(texto(m.stageId)), titulo: texto(m.title), desc: texto(m.description), tipo: texto(m.clasification), fecha: fechaForza(m.date) }))
    .sort((a, b) => String(a.fecha ?? "").localeCompare(String(b.fecha ?? "")));

  const eventos: ForzaHistorialEvent[] = [];
  let enRuta = false;
  let fallaEnEstaSalida = false;
  let ultimaFalla: ForzaHistorialEvent | null = null;
  let notaDeLaFalla = "";
  let salioDespuesDeLaFalla = false;
  let cierre: ForzaHistorialGroup | null = null;

  for (const m of crudos) {
    const code = CODIGO_POR_ETAPA[m.etapa] ?? `ETAPA_${m.etapa || "X"}`;
    const base = { code, title: m.titulo || code, description: m.desc === m.titulo ? "" : m.desc, date: m.fecha, note: "" };
    let ev: ForzaHistorialEvent = { ...base, group: "in_progress" };
    switch (m.etapa) {
      case ETAPA.RUTA:
        enRuta = true;
        fallaEnEstaSalida = false;
        if (ultimaFalla) salioDespuesDeLaFalla = true;
        break;
      case ETAPA.INCIDENCIA:
        // Un segundo aviso en la misma salida no es otro intento.
        if (!fallaEnEstaSalida) {
          ev = { ...base, group: "failed", description: m.desc || m.tipo || "Incidencia en ruta", note: m.tipo };
          ultimaFalla = ev;
          notaDeLaFalla = "";
          salioDespuesDeLaFalla = false;
          fallaEnEstaSalida = true;
        }
        break;
      case ETAPA.VALIDADA:
        ev = { ...base, group: "in_progress", description: limpiarNotaForza(m.desc) };
        if (ultimaFalla && !salioDespuesDeLaFalla && ev.description) notaDeLaFalla = ev.description;
        break;
      case ETAPA.REPROCESO:
        if (enRuta && !fallaEnEstaSalida) {
          ev = { ...base, group: "failed", description: "Volvio a la bodega de Forza sin entregarse (Forza no registro el motivo)" };
          ultimaFalla = ev;
          notaDeLaFalla = "";
          salioDespuesDeLaFalla = false;
        }
        enRuta = false;
        fallaEnEstaSalida = false;
        break;
      case ETAPA.ENTREGADO:
      case ETAPA.COD_PAGADO:
        ev = { ...base, group: "delivered" };
        cierre = "delivered";
        break;
      case ETAPA.DEVUELTO:
        ev = { ...base, group: "returned" };
        cierre = "returned";
        break;
      case ETAPA.ANULADO:
        ev = { ...base, group: "cancelled" };
        cierre = "cancelled";
        break;
    }
    eventos.push(ev);
  }

  const group: ForzaHistorialGroup = cierre ?? (ultimaFalla && !salioDespuesDeLaFalla ? "failed" : "in_progress");
  const vigente = group === "failed" ? ultimaFalla : null;
  return {
    events: eventos.reverse(),
    group,
    ultimaFalla: vigente,
    motivo: vigente ? [vigente.description, notaDeLaFalla && `Forza: ${notaDeLaFalla}`].filter(Boolean).join(" · ") : "",
  };
}
