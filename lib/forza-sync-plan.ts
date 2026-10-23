// Que guias de Forza consultar en una corrida del cron, y en que orden. Modulo
// PURO: recibe lo ya leido de la base y devuelve la lista. Sin base ni red.
//
// POR QUE EXISTE: el tracking de Forza (Honduras) solo se actualizaba con el
// boton manual "Forza (N)" del tablero. Nadie lo apreto despues del 27/07 y
// Honduras paso dos meses sin estados de entrega: al 26/09 habia 2.812 guias
// Forza de agosto y septiembre que nunca se habian consultado, y las Novedades
// de HN estaban congeladas porque la deteccion lee de ese tracking.

import { normalizeForzaGuide } from "./forza";

/**
 * Una guia de Forza tiene la forma FD + digitos. Honduras despacha tambien por
 * c807 Xpress (6595-...), Cargo Expreso (BH...-1) y antes Boxful (BFT-...):
 * consultarlas en Forza solo gasta cupo y tasa.
 */
export function isForzaGuide(raw: string): boolean {
  return /^FD\d{6,}$/i.test(String(raw ?? "").trim());
}

/** Guia Forza de un pedido de Shopify. */
export interface ForzaOrderGuide {
  guide: string;
  /** Fecha del pedido, epoch ms. */
  orderedAt: number;
}

/** Guia ya presente en forza_tracking. */
export interface ForzaTrackedGuide {
  guide: string;
  /** latest_group guardado: "delivered", "returned" y "cancelled" son finales. */
  group: string;
  /** checked_at, epoch ms (0 si no se sabe). */
  checkedAt: number;
  /** Leida con el historial completo de Forza (migracion 0048). */
  historial?: boolean;
}

const FINALES = new Set(["delivered", "returned", "cancelled"]);

export interface ForzaSyncPlanInput {
  orderGuides: ForzaOrderGuide[];
  tracked: ForzaTrackedGuide[];
  nowMs: number;
  /** Tope de consultas de la corrida. */
  limit: number;
  /** No reconsultar lo leido hace menos de esto. */
  freshWindowMs: number;
  /**
   * Parte del tope reservada para guias nunca leidas; el resto queda para
   * re-leer las que siguen en camino. Si un grupo no llena su parte, el otro
   * usa lo que sobra.
   */
  newShare?: number;
  /**
   * Parte del tope reservada para releer las cerradas sin historial (ver punto
   * 3 de planForzaSync). Sin reserva no les tocaba nunca: las ~230 guias en
   * camino se releen cada hora y se llevaban todo el cupo.
   */
  historialShare?: number;
}

/**
 * Lista ordenada de guias (normalizadas FD...) a consultar.
 *
 * 1. Nunca leidas, de la mas reciente a la mas vieja: son las que todavia se
 *    pueden gestionar, y en regimen normal son los despachos del dia.
 * 2. Ya leidas sin estado final, de la que lleva mas tiempo sin leerse a la
 *    mas reciente, para que ninguna se quede sin turno. Solo las de pedidos
 *    vigentes (`orderGuides`: no cancelados, dentro de la ventana de
 *    descubrimiento). La ventana (90 dias) es mas larga que la de novedades (60,
 *    ver lib/forza-novedades.ts), asi que ninguna guia que todavia se pueda
 *    gestionar se queda sin leer. Antes se releian sin limite y la parte de las
 *    vivas se gastaba en guias de enero que quedaron en "Creado" y nunca se van
 *    a mover.
 *
 * 3. Con lo que sobra, las cerradas que se leyeron antes de que Kairo leyera el
 *    historial completo de Forza (sin `historial`), de la del pedido mas
 *    reciente a la mas vieja: una sola vez cada una, para que el estado
 *    (entregada o devuelta: Forza mostraba la devolucion como "Entregado") y los
 *    intentos de entrega queden bien tambien en las que ya no se mueven.
 *
 * El reparto evita el hambre que ya sufrio Moovin: con miles de guias nuevas
 * atrasadas, las que ya estaban en camino igual reciben su parte en cada
 * corrida.
 */
export function planForzaSync(input: ForzaSyncPlanInput): string[] {
  const limit = Math.max(0, Math.floor(input.limit));
  if (limit === 0) return [];
  const share = Math.min(1, Math.max(0, input.newShare ?? 0.75));

  const known = new Map<string, ForzaTrackedGuide>();
  for (const t of input.tracked) {
    const guide = normalizeForzaGuide(t.guide);
    if (guide) known.set(guide, t);
  }

  const enPedidos = new Map<string, number>();
  const nuevas: Array<{ guide: string; orderedAt: number }> = [];
  for (const o of input.orderGuides) {
    if (!isForzaGuide(o.guide)) continue;
    const guide = normalizeForzaGuide(o.guide);
    if (enPedidos.has(guide)) continue;
    enPedidos.set(guide, o.orderedAt);
    if (!known.has(guide)) nuevas.push({ guide, orderedAt: o.orderedAt });
  }
  nuevas.sort((a, b) => b.orderedAt - a.orderedAt);

  const vivas = Array.from(known.entries())
    .filter(([guide]) => enPedidos.has(guide))
    .filter(([, t]) => !FINALES.has(t.group))
    .filter(([, t]) => input.nowMs - t.checkedAt >= input.freshWindowMs)
    .sort((a, b) => a[1].checkedAt - b[1].checkedAt)
    .map(([guide]) => guide);

  const sinHistorial = Array.from(known.entries())
    .filter(([guide, t]) => enPedidos.has(guide) && FINALES.has(t.group) && !t.historial)
    .filter(([, t]) => input.nowMs - t.checkedAt >= input.freshWindowMs)
    .sort((a, b) => (enPedidos.get(b[0]) ?? 0) - (enPedidos.get(a[0]) ?? 0))
    .map(([guide]) => guide);
  const historialShare = Math.min(1, Math.max(0, input.historialShare ?? 0.25));
  const reservaHistorial = Math.min(sinHistorial.length, Math.round(limit * historialShare));
  const cupo = limit - reservaHistorial;

  const vivasGarantizadas = Math.min(vivas.length, cupo - Math.round(cupo * share));
  const tomarNuevas = Math.min(nuevas.length, cupo - vivasGarantizadas);
  const tomarVivas = Math.min(vivas.length, cupo - tomarNuevas);
  const tomarSinHistorial = Math.min(sinHistorial.length, limit - tomarNuevas - tomarVivas);

  return [
    ...nuevas.slice(0, tomarNuevas).map((n) => n.guide),
    ...vivas.slice(0, tomarVivas),
    ...sinHistorial.slice(0, tomarSinHistorial),
  ];
}
