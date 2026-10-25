// La cola de confirmacion de los pedidos PENDIENTES ("Por confirmar").
//
// Un pedido pendiente (sin guia, sin despacho pedido, sin entregar ni anular)
// se trabaja llamando al cliente. Esta logica dice, con la bitacora del pedido
// (order_events), dos cosas independientes:
//
//   - SUBETAPA: que hacer con la llamada (la primera que aplica gana):
//       Confirmado -> Ultimo intento -> Volver a contactar -> Por confirmar
//       -> Historico sin gestion -> Sin llamar.
//   - PLAZO: cuando toca (Vencidos / Hoy / Proximos).
//
// Regla de diseño: solo una PROMESA ROTA (fecha pactada con el cliente que ya
// paso) va a Vencidos. Un recordatorio o un ciclo que ya llego vuelve a Hoy,
// nunca a Vencidos: asi Hoy es una lista que se trabaja hasta cero y Vencidos
// muestra solo compromisos con clientes que no se cumplieron.
//
// "Confirmo" NO saca el pedido de Pendientes (decision del dueño, 15/10/2026):
// queda en la subetapa Confirmado hasta que se pide el despacho en iComfly.
//
// Puro (sin base ni reloj implicito): se prueba en tests/confirmacion.test.ts.

import { getFinanceStore } from "./store-config";

export type Subetapa =
  | "sin_llamar"
  | "por_confirmar"
  | "volver_a_contactar"
  | "ultimo_intento"
  | "confirmado"
  | "historico";

export type Plazo = "vencidos" | "hoy" | "proximos";

export const SUBETAPAS: Array<{ value: Subetapa; label: string }> = [
  { value: "sin_llamar", label: "Sin llamar" },
  { value: "por_confirmar", label: "Por confirmar" },
  { value: "volver_a_contactar", label: "Volver a contactar" },
  { value: "ultimo_intento", label: "Último intento" },
  { value: "confirmado", label: "Confirmado" },
  { value: "historico", label: "Histórico sin gestión" },
];

export const PLAZOS: Array<{ value: Plazo; label: string }> = [
  { value: "vencidos", label: "Vencidos" },
  { value: "hoy", label: "Hoy" },
  { value: "proximos", label: "Próximos" },
];

export const SUBETAPA_LABEL: Record<Subetapa, string> = Object.fromEntries(SUBETAPAS.map((s) => [s.value, s.label])) as Record<
  Subetapa,
  string
>;

/** Dias de gestion distintos a partir de los cuales se marca "Ultimo intento". */
export const DIAS_ULTIMO_INTENTO = 7;
/** Horas habiles hasta el recordatorio tras "No contesto" / "Se deja mensaje". */
export const HORAS_RECORDATORIO = 2;
export const HORA_INICIO = 8;
export const HORA_FIN = 22;

export interface ConfigConfirmacion {
  /** Pedidos nunca llamados creados ANTES de esta fecha van a Historico (YYYY-MM-DD local). */
  activacion: string;
  /** Si no hay fecha pactada, el pedido vuelve N dias despues del ultimo contacto (1-30). */
  cicloDias: number;
  /** Zona horaria de la tienda: todas las fechas se cuentan en su calendario. */
  tz: string;
}

/**
 * Configuracion por tienda. La cola arranca el 15/09/2026 (los pendientes de
 * los ultimos 30 dias al implementarla, decision del dueño); se puede pisar en
 * stores.metadata.confirmacion.
 */
export const CONFIRMACION_DEFAULT: Omit<ConfigConfirmacion, "tz"> = { activacion: "2026-09-15", cicloDias: 3 };

export function tzDeTienda(storeCode: string): string {
  return getFinanceStore(storeCode).timezone;
}

export function configDeTienda(storeCode: string, metadata?: unknown): ConfigConfirmacion {
  const raw = (metadata as { confirmacion?: { activacion?: unknown; ciclo_dias?: unknown } } | null)?.confirmacion ?? {};
  const activacion =
    typeof raw.activacion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.activacion) ? raw.activacion : CONFIRMACION_DEFAULT.activacion;
  const ciclo = Number(raw.ciclo_dias);
  const cicloDias = Number.isInteger(ciclo) && ciclo >= 1 && ciclo <= 30 ? ciclo : CONFIRMACION_DEFAULT.cicloDias;
  return { activacion, cicloDias, tz: tzDeTienda(storeCode) };
}

export interface PedidoConfirmacion {
  creadoAt: string | null;
  /** iComfly ya registro quien confirmo el pedido. */
  confirmadoIcomfly: boolean;
  /** Shopify lo muestra pagado (p. ej. SINPE ya verificado). */
  pagado: boolean;
}

export interface EventoConfirmacion {
  kind: string;
  outcome: string;
  created_at: string;
  fecha_pactada?: string | null;
  recordatorio_at?: string | null;
}

export interface EstadoConfirmacion {
  subetapa: Subetapa;
  plazo: Plazo | null;
  diasGestion: number;
  ultimoContactoAt: string | null;
  /** Cuando vuelve a tocar y por que: lo que la asesora ve en la fila. */
  vence: { tipo: "pactada" | "recordatorio" | "ciclo" | "nunca"; fecha: string | null } | null;
}

// Resultados que son un acuerdo con fecha: "Volver a contactar" y "Pendiente de abono".
const ACUERDOS = new Set(["reagendar", "pendiente_abono"]);
// Resultados tras los que se pone un recordatorio de 2 horas habiles.
const CON_RECORDATORIO = new Set(["no_contesta", "buzon"]);

// ─── Calendario local ────────────────────────────────────────────────────────

function partes(ms: number, tz: string): { fecha: string; minutos: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return { fecha: `${get("year")}-${get("month")}-${get("day")}`, minutos: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** La fecha (YYYY-MM-DD) en el calendario de la tienda. */
export function fechaLocal(iso: string | number | Date, tz: string): string {
  return partes(new Date(iso).getTime(), tz).fecha;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Suma horas HABILES (08:00 a 22:00 de la tienda). Un "No contesto" a las
 * 21:30 vence al dia siguiente a las 09:30; uno a las 23:00, a las 10:00.
 */
export function sumarHorasHabiles(desde: Date, horas: number, tz: string): Date {
  const inicio = HORA_INICIO * 60;
  const fin = HORA_FIN * 60;
  let restante = Math.round(horas * 60);
  let t = desde.getTime();
  for (let guarda = 0; guarda < 400; guarda++) {
    const { minutos } = partes(t, tz);
    if (minutos < inicio) {
      t += (inicio - minutos) * 60_000;
      continue;
    }
    if (minutos >= fin) {
      t += (24 * 60 - minutos + inicio) * 60_000;
      continue;
    }
    const disponible = fin - minutos;
    if (restante <= disponible) return new Date(t + restante * 60_000);
    restante -= disponible;
    t += (disponible + 24 * 60 - fin + inicio) * 60_000;
  }
  return new Date(t);
}

// Una nota es gestion: el equipo venia anotando "se llamo 3 veces, se le dejo
// msj" como texto libre. Cuenta como dia de gestion y saca al pedido de "Sin
// llamar", pero NO rompe un acuerdo ni un recordatorio: suele acompañar al boton
// ("No contesto" + "se le dejo audio").
const esGestion = (e: EventoConfirmacion) => e.kind === "contacto" || e.kind === "nota";
const porFecha = (a: EventoConfirmacion, b: EventoConfirmacion) => Date.parse(a.created_at) - Date.parse(b.created_at);

/** Dias de gestion: dias DISTINTOS con al menos un intento o nota (3 llamadas el mismo dia = 1). */
export function diasDeGestion(eventos: EventoConfirmacion[], tz: string): number {
  return new Set(eventos.filter(esGestion).map((e) => fechaLocal(e.created_at, tz))).size;
}

// ─── Estado ──────────────────────────────────────────────────────────────────

export function estadoConfirmacion(
  pedido: PedidoConfirmacion,
  eventos: EventoConfirmacion[],
  config: ConfigConfirmacion,
  ahora: Date
): EstadoConfirmacion {
  const tz = config.tz;
  const hoy = fechaLocal(ahora, tz);
  // Intentos en orden; a igual hora, el acuerdo va despues (el empate lo gana la fecha pactada).
  const contactos = eventos
    .filter((e) => e.kind === "contacto")
    .sort((a, b) => {
      const d = Date.parse(a.created_at) - Date.parse(b.created_at);
      if (d !== 0) return d;
      return Number(ACUERDOS.has(a.outcome)) - Number(ACUERDOS.has(b.outcome));
    });
  const ultimo = contactos[contactos.length - 1] ?? null;
  const notas = eventos.filter((e) => e.kind === "nota").sort(porFecha);
  const ultimaNota = notas[notas.length - 1] ?? null;
  const diasGestion = diasDeGestion(eventos, tz);
  // La gestion mas reciente, sea un intento o una nota.
  const ultimaGestion = [ultimo, ultimaNota].filter((e): e is EventoConfirmacion => !!e).sort(porFecha).pop() ?? null;
  const ultimoContactoAt = ultimaGestion?.created_at ?? null;
  const base = { diasGestion, ultimoContactoAt };

  // 1) Confirmado: lo dijo una asesora, iComfly ya lo confirmo o Shopify lo cobro.
  if (pedido.confirmadoIcomfly || pedido.pagado || contactos.some((e) => e.outcome === "confirmado")) {
    return { subetapa: "confirmado", plazo: null, vence: null, ...base };
  }

  // Nunca contactado: Historico (anterior a la activacion) o Sin llamar.
  if (!ultimaGestion) {
    const creado = pedido.creadoAt ? fechaLocal(pedido.creadoAt, tz) : null;
    if (creado && creado < config.activacion) {
      return { subetapa: "historico", plazo: null, vence: null, ...base };
    }
    // La primera llamada es trabajo de hoy.
    return { subetapa: "sin_llamar", plazo: "hoy", vence: { tipo: "nunca", fecha: null }, ...base };
  }

  // El plazo sale de la fuente mas fuerte disponible.
  // Solo los intentos fijan acuerdos y recordatorios; las notas solo mueven el ciclo.
  const acuerdoVigente = !!ultimo && ACUERDOS.has(ultimo.outcome) && !!ultimo.fecha_pactada;
  let plazo: Plazo;
  let vence: EstadoConfirmacion["vence"];
  if (acuerdoVigente && ultimo) {
    const f = String(ultimo.fecha_pactada).slice(0, 10);
    plazo = f < hoy ? "vencidos" : f === hoy ? "hoy" : "proximos";
    vence = { tipo: "pactada", fecha: f };
  } else if (ultimo && CON_RECORDATORIO.has(ultimo.outcome) && ultimo.recordatorio_at) {
    // Un recordatorio vencido vuelve a HOY aunque sea de hace dias: no es una promesa.
    plazo = Date.parse(ultimo.recordatorio_at) > ahora.getTime() ? "proximos" : "hoy";
    vence = { tipo: "recordatorio", fecha: ultimo.recordatorio_at };
  } else {
    const vuelve = sumarDias(fechaLocal(ultimaGestion.created_at, tz), config.cicloDias);
    plazo = vuelve > hoy ? "proximos" : "hoy";
    vence = { tipo: "ciclo", fecha: vuelve };
  }

  // 2) Ultimo intento: 7 dias de gestion o marcado a mano. Lo cancela una persona.
  const marcadoUltimo = eventos.some((e) => e.kind === "decision" && e.outcome === "ultimo_intento");
  if (marcadoUltimo || diasGestion >= DIAS_ULTIMO_INTENTO) {
    return { subetapa: "ultimo_intento", plazo, vence, ...base };
  }
  // 3) Volver a contactar: lo ultimo es una fecha pactada. Si despues se llamo
  //    sin pactar otra, vuelve a Por confirmar: el compromiso viejo ya no vale.
  if (acuerdoVigente) return { subetapa: "volver_a_contactar", plazo, vence, ...base };
  // 4) Por confirmar: hubo contacto y lo ultimo no tiene fecha pactada.
  return { subetapa: "por_confirmar", plazo, vence, ...base };
}

// ─── Validaciones al registrar ───────────────────────────────────────────────

/** La fecha pactada no puede ser anterior a hoy (en la tienda). null si sirve. */
export function problemaFechaPactada(fecha: unknown, ahora: Date, tz: string): string | null {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) {
    return "Elegí la fecha pactada con el cliente.";
  }
  if (fecha < fechaLocal(ahora, tz)) return "La fecha pactada no puede ser anterior a hoy.";
  return null;
}

/** Cuando se pone recordatorio: tras No contesto y Se deja mensaje, a 2 horas habiles. */
export function recordatorioPara(outcome: string, ahora: Date, tz: string): string | null {
  return CON_RECORDATORIO.has(outcome) ? sumarHorasHabiles(ahora, HORAS_RECORDATORIO, tz).toISOString() : null;
}

export function requiereFechaPactada(outcome: string): boolean {
  return ACUERDOS.has(outcome);
}

// ─── Lo que comparten la tabla y la ficha ────────────────────────────────────

/** Lo que la cola necesita de una fila de pedidos. El servidor y la ficha leen lo mismo. */
export function pedidoDeFila(row: {
  shopify_created_at?: string | null;
  dispatch_confirmed_by?: string | null;
  shopify_financial_status?: string | null;
}): PedidoConfirmacion {
  return {
    creadoAt: row.shopify_created_at ?? null,
    confirmadoIcomfly: Boolean(row.dispatch_confirmed_by),
    pagado: row.shopify_financial_status === "paid",
  };
}

/** Cuando vuelve a tocar, corto: "17/10", o "15/10 12:30" para un recordatorio. */
export function cuandoVence(v: EstadoConfirmacion["vence"], tz: string): string {
  if (!v?.fecha) return "";
  if (v.tipo === "recordatorio") {
    return new Intl.DateTimeFormat("es-CR", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date(v.fecha))
      .replace(",", "");
  }
  const [, m, d] = v.fecha.slice(0, 10).split("-");
  return `${d}/${m}`;
}
