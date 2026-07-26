// Historial del cliente para el drawer de leads: normaliza un pedido de
// Shopify + su tracking en vivo de Moovin a la forma que consume la UI.
//
// Modulo PURO (sin acceso a BD) para poder testear el mapeo de estados y para
// que los componentes cliente lo importen sin arrastrar Supabase al bundle.

/** Estado real del pedido, agrupado por lo que de verdad paso. */
export type CustomerOrderState =
  | "delivered"
  | "in_transit"
  | "returned"
  | "cancelled"
  | "pending";

export interface CustomerOrderItem {
  title: string;
  quantity: number;
}

export interface CustomerOrder {
  name: string;
  created_at: string | null;
  total: number;
  currency: string;
  items: CustomerOrderItem[];
  address: string;
  /** Guia del courier (id_package de Moovin, viene de Shopify). */
  guide: string;
  courier: string;
  /** Estado normalizado para agrupar. */
  state: CustomerOrderState;
  /** Texto que ve la asesora ("En ruta para entregar", "Entregado"...). */
  state_label: string;
  /** Fecha del ultimo evento de tracking. */
  state_at: string | null;
  has_incident: boolean;
  incident_reason: string;
}

export interface CustomerSummary {
  orders: number;
  total_spent: number;
  delivered: number;
  returned: number;
  in_transit: number;
  cancelled: number;
  currency: string;
}

export const ORDER_STATE_ORDER: CustomerOrderState[] = [
  "in_transit",
  "delivered",
  "returned",
  "cancelled",
  "pending",
];

export const ORDER_STATE_LABEL: Record<CustomerOrderState, string> = {
  in_transit: "En camino",
  delivered: "Entregados",
  returned: "Devueltos",
  cancelled: "Anulados",
  pending: "Sin despachar",
};

/**
 * Estado real del pedido. Precedencia:
 *   1. cancelado en Shopify manda (nunca se despacho de verdad)
 *   2. el ultimo evento del courier (dato en vivo, el mas confiable)
 *   3. fulfillment de Shopify como respaldo cuando no hay tracking
 * `moovinGroup` viene de moovin_tracking.latest_group.
 */
export function resolveOrderState(input: {
  cancelled: boolean;
  moovinGroup?: string | null;
  hasIncident?: boolean;
  fulfillmentStatus?: string | null;
  guide?: string | null;
}): CustomerOrderState {
  if (input.cancelled) return "cancelled";

  switch (input.moovinGroup) {
    case "delivered":
      return "delivered";
    case "returned":
      return "returned";
    // Una incidencia no es una devolucion todavia: el paquete sigue en poder
    // del courier y puede reintentarse, asi que cuenta como "en camino".
    case "failed":
    case "in_progress":
      return "in_transit";
    default:
      break;
  }

  if (input.fulfillmentStatus === "fulfilled" || input.guide) return "in_transit";
  return "pending";
}

/** Texto para la asesora: prioriza el evento literal del courier. */
export function resolveOrderStateLabel(input: {
  state: CustomerOrderState;
  moovinStatus?: string | null;
  hasIncident?: boolean;
  incidentReason?: string | null;
}): string {
  if (input.state === "cancelled") return "Anulado";
  if (input.hasIncident) {
    const reason = (input.incidentReason ?? "").trim();
    return reason ? `Incidencia: ${reason}` : "Incidencia en la entrega";
  }
  const live = (input.moovinStatus ?? "").trim();
  if (live) return live;
  if (input.state === "delivered") return "Entregado";
  if (input.state === "returned") return "Devuelto";
  if (input.state === "in_transit") return "Despachado";
  return "Sin despachar";
}

export function buildCustomerSummary(
  orders: CustomerOrder[],
  fallbackCurrency: string
): CustomerSummary {
  const summary: CustomerSummary = {
    orders: orders.length,
    // Solo cuenta como gastado lo que de verdad llego al cliente: sumar
    // devoluciones y anulados inflaria el valor del cliente.
    total_spent: 0,
    delivered: 0,
    returned: 0,
    in_transit: 0,
    cancelled: 0,
    currency: orders[0]?.currency || fallbackCurrency,
  };
  for (const order of orders) {
    if (order.state === "delivered") {
      summary.delivered += 1;
      summary.total_spent += order.total;
    } else if (order.state === "returned") {
      summary.returned += 1;
    } else if (order.state === "in_transit") {
      summary.in_transit += 1;
    } else if (order.state === "cancelled") {
      summary.cancelled += 1;
    }
  }
  return summary;
}

/** Agrupa por estado real respetando ORDER_STATE_ORDER; omite grupos vacios. */
export function groupOrdersByState(
  orders: CustomerOrder[]
): Array<{ state: CustomerOrderState; label: string; orders: CustomerOrder[] }> {
  return ORDER_STATE_ORDER.map((state) => ({
    state,
    label: ORDER_STATE_LABEL[state],
    orders: orders.filter((o) => o.state === state),
  })).filter((group) => group.orders.length > 0);
}
