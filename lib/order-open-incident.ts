// Novedad abierta de un pedido, para mostrarla en la tabla de pedidos sin ir a
// Novedades. Puro: el cruce se prueba sin base.
//
// POR QUE EXISTE: la guia BH262231336-1 (#MIRH20584) llevaba 11 dias sin
// movimiento y ya tenia una novedad reprogramada, pero en Pedidos figuraba
// "En ruta" sin ninguna senal. Quien gestiona desde Pedidos tiene que ver que
// el pedido ya esta en la bandeja de Novedades, con su causa y su estado.

import { normalizeMatchKey } from "./order-matching";
import { TERMINAL_STATUSES, type Incident } from "./incidents-types";

export type OrderOpenIncident = Pick<
  Incident,
  "id" | "source" | "status" | "category" | "detail" | "reprogramada_para" | "guide_number" | "order_name" | "updated_at"
>;

export interface OpenIncidentIndex {
  byGuide: Map<string, OrderOpenIncident>;
  byOrder: Map<string, OrderOpenIncident>;
}

/** La mas recientemente tocada gana si una guia o un pedido tiene mas de una. */
function keepLatest(map: Map<string, OrderOpenIncident>, key: string, incident: OrderOpenIncident): void {
  if (!key) return;
  const current = map.get(key);
  if (!current || String(incident.updated_at ?? "") > String(current.updated_at ?? "")) map.set(key, incident);
}

export function buildOpenIncidentIndex(incidents: OrderOpenIncident[]): OpenIncidentIndex {
  const index: OpenIncidentIndex = { byGuide: new Map(), byOrder: new Map() };
  for (const incident of incidents) {
    // La consulta ya las excluye; se vuelve a filtrar por si llega otra lista.
    if (TERMINAL_STATUSES.includes(incident.status)) continue;
    keepLatest(index.byGuide, normalizeMatchKey(incident.guide_number), incident);
    keepLatest(index.byOrder, normalizeMatchKey(incident.order_name), incident);
  }
  return index;
}

/**
 * Primero por guia (la novedad es de ese envio); si no, por pedido: un pedido
 * reenviado con otra guia sigue teniendo la novedad del envio anterior abierta.
 */
export function findOpenIncident(
  index: OpenIncidentIndex,
  row: { guide_number?: string; order_name?: string; shopify_order_name?: string }
): OrderOpenIncident | null {
  return (
    index.byGuide.get(normalizeMatchKey(row.guide_number ?? "")) ??
    index.byOrder.get(normalizeMatchKey(row.shopify_order_name ?? "")) ??
    index.byOrder.get(normalizeMatchKey(row.order_name ?? "")) ??
    null
  );
}
