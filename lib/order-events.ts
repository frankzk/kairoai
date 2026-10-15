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
  | "pendiente_abono"
  | "autorizar_despacho"
  | "retener"
  | "anular"
  | "ultimo_intento";

/** Por donde se hizo el intento (vacio en notas y decisiones). */
export type OrderEventCanal = "" | "llamada" | "whatsapp" | "mensaje";

export const ORDER_EVENT_CANALES: Array<{ value: Exclude<OrderEventCanal, "">; label: string }> = [
  { value: "llamada", label: "Llamada" },
  { value: "whatsapp", label: "Llamada WhatsApp" },
  { value: "mensaje", label: "Mensaje" },
];

export function isValidCanal(canal: string): canal is OrderEventCanal {
  return ["", "llamada", "whatsapp", "mensaje"].includes(canal);
}

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
  canal?: OrderEventCanal;
  /** Fecha acordada con el cliente (Volver a contactar / Pendiente de abono). */
  fecha_pactada?: string | null;
  /** Cuando vuelve a tocar tras No contesto / Se deja mensaje. */
  recordatorio_at?: string | null;
}

/** Etiquetas de la UI, en un solo lugar para que API y drawer no se desincronicen. */
export const ORDER_EVENT_OUTCOME_LABEL: Record<string, string> = {
  contesto: "Contestó",
  no_contesta: "No contestó",
  buzon: "Se deja mensaje",
  numero_malo: "Número equivocado",
  confirmado: "Pedido confirmado",
  reagendar: "Volver a contactar",
  pendiente_abono: "Pendiente de abono",
  autorizar_despacho: "Autorizó despacho",
  retener: "Retener",
  anular: "Anular pedido",
  ultimo_intento: "Último intento",
};

const OUTCOMES_BY_KIND: Record<OrderEventKind, OrderEventOutcome[]> = {
  contacto: ["contesto", "no_contesta", "buzon", "numero_malo", "confirmado", "reagendar", "pendiente_abono"],
  decision: ["autorizar_despacho", "retener", "anular", "ultimo_intento"],
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
