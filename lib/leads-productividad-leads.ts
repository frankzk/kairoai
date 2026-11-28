// La regla de la columna "Leads" de Productividad, y el desglose de esos leads.
//
// Que cuenta "Leads" (lo que en el tablero se lee como "los leads que vio"):
// los leads DISTINTOS con al menos una gestion registrada a nombre de la
// asesora (lead_calls.vendedora) en la tienda y en el periodo [from, to).
// Gestion = resultado de llamada (state_change), WhatsApp enviado (note),
// pedido creado (sale), deshacer (undo) o llamadas viejas (call). Abrir la
// ficha sin registrar nada NO cuenta: no hay registro de "vistas".
//
// Esta regla vive en UN solo lugar: la usan el conteo de la tabla
// (`getProductivity`) y la lista que se abre al apretar el numero
// (`getLeadsDeAsesora`). Asi la lista siempre tiene tantos leads como dice el
// numero (tests/leads-productividad-leads.test.ts).
//
// Sin acceso a la base: se prueba sola.

import { MAX_CUSTOM_RANGE_DAYS } from "./leads-metrics";

/** Una fila de lead_calls, con lo minimo que mira la regla. */
export interface GestionDeProductividad {
  vendedora: number | null;
  kind: string;
  lead_id: number;
  occurred_at?: string | null;
}

/** Lo que una asesora hizo sobre UN lead en el periodo. */
export interface LeadDeAsesora {
  lead_id: number;
  gestiones: number;
  pedidos: number;
  /** Primera y ultima gestion suya sobre el lead en el periodo (ISO). */
  primera: string | null;
  ultima: string | null;
  /** Gestiones por tipo (kind de lead_calls). */
  tipos: Record<string, number>;
}

export interface ResumenAsesora {
  gestiones: number;
  pedidos: number;
  leads: Map<number, LeadDeAsesora>;
}

/**
 * Suma un lote de gestiones al resumen por asesora (se llama por pagina).
 * Las filas sin asesora no cuentan para nadie.
 */
export function acumularGestiones(
  acc: Map<number, ResumenAsesora>,
  filas: readonly GestionDeProductividad[]
): Map<number, ResumenAsesora> {
  for (const fila of filas) {
    if (fila.vendedora == null) continue;
    let a = acc.get(fila.vendedora);
    if (!a) {
      a = { gestiones: 0, pedidos: 0, leads: new Map() };
      acc.set(fila.vendedora, a);
    }
    a.gestiones += 1;
    if (fila.kind === "sale") a.pedidos += 1;
    let l = a.leads.get(fila.lead_id);
    if (!l) {
      l = { lead_id: fila.lead_id, gestiones: 0, pedidos: 0, primera: null, ultima: null, tipos: {} };
      a.leads.set(fila.lead_id, l);
    }
    l.gestiones += 1;
    if (fila.kind === "sale") l.pedidos += 1;
    l.tipos[fila.kind] = (l.tipos[fila.kind] ?? 0) + 1;
    const t = fila.occurred_at ?? null;
    if (t) {
      if (!l.primera || Date.parse(t) < Date.parse(l.primera)) l.primera = t;
      if (!l.ultima || Date.parse(t) > Date.parse(l.ultima)) l.ultima = t;
    }
  }
  return acc;
}

/** Los leads de una asesora, el de gestion mas reciente primero. */
export function leadsOrdenados(resumen: ResumenAsesora | undefined): LeadDeAsesora[] {
  if (!resumen) return [];
  return Array.from(resumen.leads.values()).sort(
    (a, b) => (Date.parse(b.ultima ?? "") || 0) - (Date.parse(a.ultima ?? "") || 0) || b.lead_id - a.lead_id
  );
}

/** Tope de gestiones que se leen para UNA asesora (10 paginas de 1.000). */
export const MAX_GESTIONES_LISTA = 10_000;
/** Tope de leads de los que se trae la ficha (en tandas de LOTE_LEADS). */
export const MAX_LEADS_LISTA = 500;
export const LOTE_LEADS = 125;

/**
 * Columnas del lead que necesita la lista y la ficha del tablero (la misma
 * forma que `LeadRow` en components/LeadsBoard.tsx), mas lo que piden los ejes
 * (lib/leads-segment.ts). Nada de textos largos que la lista no muestre.
 */
export const COLUMNAS_LEAD_LISTA = [
  "id", "store_id", "phone", "name", "status", "category", "status_source", "auto_reason", "labels",
  "last_message_text", "last_message_sender", "unread_count", "chatbot_disabled", "last_interaction_at",
  "next_followup_at", "needs_attention", "has_order", "cart_value", "cart_item_count", "cart_summary",
  "shopify_cart_open", "shopify_draft_cart_count", "has_cart_signal", "inbound_count", "crm_conversation_id",
  "first_seen_at", "created_at", "claimed_by",
].join(",");

/**
 * El periodo EXACTO de la tabla (from/to ISO que devolvio /api/leads/productivity).
 * Se reusa tal cual para que "Hoy" no avance entre el numero y la lista. Se
 * valida igual que los rangos a mano: ordenado y de a lo sumo un año (+1 dia
 * de margen por el corte local).
 */
export function periodoExacto(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined
): { fromIso: string; toIso: string } | null {
  const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
  if (!fromRaw || !toRaw || !isoRe.test(fromRaw) || !isoRe.test(toRaw)) return null;
  const a = Date.parse(fromRaw);
  const b = Date.parse(toRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  if (b - a > (MAX_CUSTOM_RANGE_DAYS + 1) * 86_400_000) return null;
  return { fromIso: new Date(a).toISOString(), toIso: new Date(b).toISOString() };
}

const TIPO_LABEL: Record<string, [string, string]> = {
  state_change: ["resultado", "resultados"],
  note: ["WhatsApp", "WhatsApp"],
  sale: ["pedido", "pedidos"],
  call: ["llamada", "llamadas"],
  undo: ["deshecho", "deshechos"],
};

/** "2 resultados · 1 WhatsApp · 1 pedido" (los tipos conocidos primero). */
export function resumenTipos(tipos: Record<string, number>): string {
  const orden = ["sale", "state_change", "note", "call", "undo"];
  const claves = Object.keys(tipos).sort((a, b) => {
    const ia = orden.indexOf(a);
    const ib = orden.indexOf(b);
    return (ia < 0 ? orden.length : ia) - (ib < 0 ? orden.length : ib) || a.localeCompare(b);
  });
  return claves
    .filter((k) => tipos[k] > 0)
    .map((k) => {
      const n = tipos[k];
      const [uno, varios] = TIPO_LABEL[k] ?? [k, k];
      return `${n} ${n === 1 ? uno : varios}`;
    })
    .join(" · ");
}

/** El texto del boton del numero: "Ver los 25 leads que gestionó Ana". */
export function etiquetaVerLeads(n: number, nombre: string): string {
  return n === 1 ? `Ver el lead que gestionó ${nombre}` : `Ver los ${n} leads que gestionó ${nombre}`;
}
