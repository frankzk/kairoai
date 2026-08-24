// Tipos y etiquetas de la bitacora de gestion del pedido.
//
// Modulo PURO (sin imports de servidor) para que el drawer lo importe sin
// arrastrar Supabase al bundle del cliente. El acceso a la tabla vive en
// lib/order-events-db.ts.

export type OrderEventKind = "contacto" | "nota" | "decision";

export type OrderEventOutcome =
  | ""
  | "contesto"
  | "no_contesta"
  | "buzon"
  | "numero_malo"
  | "confirmado"
  | "reagendar"
  | "autorizar_despacho"
  | "retener"
  | "anular";

export interface OrderEvent {
  id: number;
  store_id: number;
  order_name: string;
  guide_number: string;
  kind: OrderEventKind;
  outcome: OrderEventOutcome;
  message: string;
  staff_id: number | null;
  staff_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Etiquetas de la UI, en un solo lugar para que API y drawer no se desincronicen. */
export const ORDER_EVENT_OUTCOME_LABEL: Record<string, string> = {
  contesto: "Contestó",
  no_contesta: "No contesta",
  buzon: "Buzón de voz",
  numero_malo: "Número equivocado",
  confirmado: "Pedido confirmado",
  reagendar: "Reagendar entrega",
  autorizar_despacho: "Autorizó despacho",
  retener: "Retener",
  anular: "Anular pedido",
};

const OUTCOMES_BY_KIND: Record<OrderEventKind, OrderEventOutcome[]> = {
  contacto: ["contesto", "no_contesta", "buzon", "numero_malo", "confirmado", "reagendar"],
  decision: ["autorizar_despacho", "retener", "anular"],
  nota: [""],
};

/**
 * Valida el par kind/outcome antes de escribir: el CHECK de la tabla acepta
 * cualquier outcome para cualquier kind, asi que la regla de cual va con cual
 * vive aca (y se testea).
 */
export function isValidOrderEvent(kind: string, outcome: string): boolean {
  const allowed = OUTCOMES_BY_KIND[kind as OrderEventKind];
  if (!allowed) return false;
  return allowed.includes((outcome ?? "") as OrderEventOutcome);
}
