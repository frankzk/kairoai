// Cuando se puede reprogramar una novedad, y para que fechas.
//
// Modulo puro (sin base, sin navegador): lo usa el detalle de la novedad y se
// prueba en tests/incidents-reprog.test.ts.

import type { IncidentEvent } from "./incidents-types";

/**
 * Por que se habilita la reprogramacion:
 *  - "contesto": la ultima llamada fue "Contestó". Cualquier fecha desde hoy.
 *  - "segundo_intento": el courier registra UN solo intento fallido, asi que el
 *    segundo ya esta pagado. Se manda aunque el cliente no conteste: intentarlo
 *    cuesta lo mismo que no intentarlo y alguna entrega sale. Desde mañana.
 *  - "finde": 3 "No contestó" en dias distintos. Solo el proximo viernes o
 *    sabado (Moovin no hace un 3er intento).
 *  - null: todavia no se puede.
 */
export type ModoReprog = "contesto" | "segundo_intento" | "finde";

/**
 * Dias en que el courier no entrega (0 = domingo), para no ofrecerlos al
 * reprogramar. Por courier, no por tienda: en Honduras conviven Forza y Cargo
 * Expreso. Medido el 13/10/2026:
 *  - Forza: en 90 dias, entre 627 y 852 entregas por dia habil y 3 en domingos.
 *  - Cargo Expreso: 86 intentos de entrega en septiembre y octubre, ninguno en
 *    domingo.
 */
export const DIAS_SIN_ENTREGA: Record<string, number[]> = { forza: [0], cargoexpreso: [0] };

/**
 * Dias sin entrega para una novedad: los de su courier; si el origen no es un
 * courier (una novedad manual), los del courier principal de la tienda.
 */
export function diasSinEntregaDe(source: string, proveedorTienda: string): number[] {
  return DIAS_SIN_ENTREGA[source] ?? DIAS_SIN_ENTREGA[proveedorTienda] ?? [];
}

/**
 * true cuando el courier ya no va a intentar entregar y hay que cobrar un nuevo
 * envio. Moovin y Forza hacen dos intentos (el segundo incluido). Cargo Expreso
 * reintenta solo y sin un numero fijo: de 22 devoluciones de septiembre y
 * octubre, 3 no tuvieron ningun intento y 3 tuvieron cuatro. Ahi recien se sabe
 * cuando cancela por devolucion.
 */
export function courierYaNoReintenta(source: string, intentosFallidos: number, devuelto: boolean): boolean {
  if (source === "cargoexpreso") return devuelto;
  return intentosFallidos >= 2;
}

/** true si la fecha (YYYY-MM-DD) cae en un dia en que el courier no entrega. */
export function esDiaSinEntrega(fecha: string, diasSinEntrega: number[]): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return false;
  return diasSinEntrega.includes(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay());
}

export interface ReglaReprog {
  modo: ModoReprog | null;
  /** Fecha minima del selector (YYYY-MM-DD, hora local). */
  min: string | null;
  /** Fecha maxima del selector, o null si no hay tope. */
  max: string | null;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function masDias(d: Date, dias: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + dias);
  return r;
}

// El primer dia desde `d` en que el courier entrega.
function primerDiaConEntrega(d: Date, diasSinEntrega: number[]): Date {
  let r = d;
  for (let i = 0; i < 7 && diasSinEntrega.includes(r.getDay()); i++) r = masDias(r, 1);
  return r;
}

export function reglaReprogramar(
  events: Array<Pick<IncidentEvent, "kind" | "metadata" | "created_at">>,
  intentosEntrega: number,
  ahora: Date = new Date(),
  diasSinEntrega: number[] = []
): ReglaReprog {
  const llamadas = events
    .filter((e) => e.kind === "llamada")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const clienteContesto = llamadas[0]?.metadata?.resultado === "contesto";
  if (clienteContesto) {
    return { modo: "contesto", min: ymd(primerDiaConEntrega(ahora, diasSinEntrega)), max: null };
  }

  // Antes que la regla de los 3 dias: si queda el intento pagado, no hace falta
  // esperar 3 dias de llamadas ni limitarlo al finde.
  if (intentosEntrega === 1) {
    return { modo: "segundo_intento", min: ymd(primerDiaConEntrega(masDias(ahora, 1), diasSinEntrega)), max: null };
  }

  const diasNoContesta = new Set(
    llamadas
      .filter((e) => e.metadata?.resultado === "no_contesto")
      .map((e) => (e.created_at || "").slice(0, 10))
      .filter(Boolean)
  ).size;
  if (diasNoContesta >= 3) {
    const viernes = masDias(ahora, (5 - ahora.getDay() + 7) % 7);
    return { modo: "finde", min: ymd(viernes), max: ymd(masDias(viernes, 1)) };
  }

  return { modo: null, min: null, max: null };
}
