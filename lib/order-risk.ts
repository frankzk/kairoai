// Alertas del pedido ANTES de despacharlo: lo que el sistema ya sabe del
// cliente y que la asesora no ve cuando manda a imprimir la guia.
//
// Cada regla salio de medir la base, no de intuicion (19.325 pedidos de
// Mireva Costa Rica, agosto 2026):
//
//   - Demora en despachar: 68% de entrega el mismo dia o al dia siguiente,
//     60,7% entre 2 y 3 dias, 54,3% entre 4 y 7, y 38,6% pasados los 8.
//   - Devolucion previa del cliente: 64,8% sin devoluciones, 52,9% con una,
//     25% con dos.
//   - Duplicados: 31 pedidos del mismo telefono con menos de 24 h de
//     diferencia; 56 mas entre 24 y 72 h.
//
// Modulo PURO (sin BD ni red) para poder testear los umbrales.

export type OrderAlertLevel = "alta" | "media" | "favor";

export type OrderAlertId =
  | "devolucion_previa"
  | "pedido_frio"
  | "paquete_en_calle"
  | "posible_duplicado"
  | "sin_telefono"
  | "cliente_confiable";

export interface OrderAlert {
  id: OrderAlertId;
  level: OrderAlertLevel;
  /** Que pasa, en una linea. */
  title: string;
  /** El dato que lo respalda. */
  detail: string;
  /** Que hacer. */
  action: string;
}

export interface OrderRiskInput {
  /** Fecha del pedido (ISO). */
  created_at: string | null;
  /** Ya tiene guia: si esta despachado, "pedido frio" no aplica. */
  dispatched: boolean;
  phone: string;
  /** Pedidos anteriores del mismo cliente que terminaron devueltos. */
  previous_returned: number;
  /** Pedidos anteriores entregados. */
  previous_delivered: number;
  /** Paquetes del mismo cliente circulando ahora. */
  in_transit: number;
  /**
   * Otro pedido del mismo cliente dentro de las 72 h. La ventana la resuelve
   * quien arma el input, que es el que tiene la lista completa.
   */
  duplicate_within_72h: boolean;
}

/** Umbral de "pedido frio", en dias desde la compra sin despachar. */
export const COLD_ORDER_DAYS = 5;
/** A partir de aca la caida es fuerte (38,6% de entrega). */
export const VERY_COLD_ORDER_DAYS = 8;

const DAY_MS = 86_400_000;

export function daysSinceOrder(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

const LEVEL_ORDER: Record<OrderAlertLevel, number> = { alta: 0, media: 1, favor: 2 };

/**
 * Alertas del pedido, lo mas grave primero. La verde ("cliente confiable") va
 * siempre al final: informa, no interrumpe.
 */
export function orderAlerts(input: OrderRiskInput, now: number = Date.now()): OrderAlert[] {
  const alerts: OrderAlert[] = [];
  const dias = daysSinceOrder(input.created_at, now);

  if (input.previous_returned > 0) {
    const tasa = input.previous_returned === 1 ? "53%" : "25%";
    alerts.push({
      id: "devolucion_previa",
      level: "alta",
      title:
        input.previous_returned === 1
          ? "Este cliente ya devolvio 1 paquete"
          : `Este cliente ya devolvio ${input.previous_returned} paquetes`,
      detail: `Su probabilidad de entrega baja a ${tasa}, contra 65% de un cliente sin devoluciones.`,
      action: "Confirmar por WhatsApp antes de imprimir la guia.",
    });
  }

  // Solo aplica a lo que todavia no salio: un pedido ya despachado no se
  // "enfria" mas por esperar.
  if (!input.dispatched && dias >= COLD_ORDER_DAYS) {
    const muyFrio = dias >= VERY_COLD_ORDER_DAYS;
    alerts.push({
      id: "pedido_frio",
      level: "alta",
      title: `${dias} dias sin despachar`,
      detail: muyFrio
        ? "Pasados los 8 dias la entrega cae al 39%, contra 68% despachando el mismo dia."
        : "Entre 4 y 7 dias la entrega baja al 54%, contra 68% despachando el mismo dia.",
      action: muyFrio
        ? "Reconfirmar la compra o anular: a esta altura la mayoria ya no lo recibe."
        : "Despachar hoy o reconfirmar con el cliente.",
    });
  }

  if (input.in_transit > 0) {
    alerts.push({
      id: "paquete_en_calle",
      level: "media",
      title:
        input.in_transit === 1
          ? "Ya tiene otro paquete en la calle"
          : `Ya tiene ${input.in_transit} paquetes en la calle`,
      detail: "Cobrarle dos veces contra entrega en la misma semana sube el rechazo.",
      action: "Revisar si conviene esperar a que reciba el primero.",
    });
  }

  if (input.duplicate_within_72h) {
    alerts.push({
      id: "posible_duplicado",
      level: "media",
      title: "Posible pedido duplicado",
      detail: "Hay otro pedido del mismo telefono dentro de las 72 horas.",
      action: "Confirmar con el cliente si quiere los dos antes de despachar.",
    });
  }

  if (!String(input.phone ?? "").trim()) {
    alerts.push({
      id: "sin_telefono",
      level: "media",
      title: "Sin telefono para contactar",
      detail: "Si el mensajero no puede llamar, la entrega depende de que el cliente este en casa.",
      action: "Buscar el numero en la conversacion antes de despachar.",
    });
  }

  if (input.previous_delivered > 0 && input.previous_returned === 0) {
    alerts.push({
      id: "cliente_confiable",
      level: "favor",
      title:
        input.previous_delivered === 1
          ? "Cliente recurrente: ya recibio y pago 1 pedido"
          : `Cliente recurrente: ya recibio y pago ${input.previous_delivered} pedidos`,
      detail: "Sin devoluciones en su historial.",
      action: "Despachar sin gestion adicional.",
    });
  }

  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** Forma minima de un pedido del historial (evita acoplar con customer-history). */
export interface HistoryOrderLike {
  name: string;
  created_at: string | null;
  /** delivered | returned | in_transit | cancelled | pending */
  state: string;
}

const DUPLICATE_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Arma el input de las alertas a partir del historial del cliente. El pedido
 * que se esta mirando se excluye de su propio historial: si no, se contaria a
 * si mismo como duplicado y como paquete en la calle.
 */
export function riskInputFromHistory(opts: {
  orderName: string;
  createdAt: string | null;
  dispatched: boolean;
  phone: string;
  history: HistoryOrderLike[];
}): OrderRiskInput {
  const current = String(opts.orderName ?? "").trim().toUpperCase();
  const otros = opts.history.filter(
    (o) => String(o.name ?? "").trim().toUpperCase() !== current
  );
  const propio = Date.parse(String(opts.createdAt ?? ""));

  return {
    created_at: opts.createdAt,
    dispatched: opts.dispatched,
    phone: opts.phone,
    previous_returned: otros.filter((o) => o.state === "returned").length,
    previous_delivered: otros.filter((o) => o.state === "delivered").length,
    in_transit: otros.filter((o) => o.state === "in_transit").length,
    duplicate_within_72h: Number.isNaN(propio)
      ? false
      : otros.some((o) => {
          const t = Date.parse(String(o.created_at ?? ""));
          return !Number.isNaN(t) && Math.abs(t - propio) < DUPLICATE_WINDOW_MS;
        }),
  };
}

/**
 * Semaforo del pedido para la columna de la lista: manda la alerta mas grave.
 * "ok" cuando no hay nada que mirar.
 */
export type OrderRiskLevel = "alta" | "media" | "favor" | "ok";

export function orderRiskLevel(alerts: OrderAlert[]): OrderRiskLevel {
  if (alerts.some((a) => a.level === "alta")) return "alta";
  if (alerts.some((a) => a.level === "media")) return "media";
  if (alerts.some((a) => a.level === "favor")) return "favor";
  return "ok";
}
