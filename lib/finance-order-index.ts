// Fase 1 del rediseño escalable de /api/finance/orders.
//
// Hoy el endpoint baja TODO el dataset de la tienda (blob JSONB en
// finance_dataset_cache), lo descomprime en memoria y filtra/cuenta/pagina en
// JavaScript sobre las ~15k filas. Es O(todo) por request y no escala a 100k+.
//
// Este módulo materializa, POR PEDIDO, los campos DERIVADOS que hoy se calculan
// en memoria (estado de seguimiento efectivo, bucket del filtro, conteo de
// liquidación, fecha, texto de búsqueda) para poder guardarlos como FILAS reales
// en la tabla `finance_order_index` (migración 0024) e indexarlos. Con eso el
// endpoint pasa a filtrar/paginar/contar en SQL — O(página) sin importar el
// total.
//
// IMPORTANTE (paridad): la derivación aquí replica EXACTAMENTE `resolveRows` de
// app/api/finance/orders/route.ts:
//   traces  = getSettlementTracesForLogisticsRow(row, settlementTraceByKey)
//   status  = mergeDispatchIntoTracking(getEffectiveTrackingStatus(row, traces),
//                                        row.dispatch_view, row)
//   filter  = getTrackingFilterFromStatus(status, row)
// y el texto de búsqueda replica matchesOrderSearch. Cualquier cambio en esas
// funciones debe reflejarse aquí, o los números dejarán de coincidir con la UI.

import { mergeDispatchIntoTracking } from "./dispatch";
import { normalizeSearchText } from "./order-matching";
import {
  getEffectiveTrackingStatus,
  getSettlementTracesForLogisticsRow,
  getTrackingFilterFromStatus,
  type SettlementTrace,
  type TrackableOrderRow,
} from "./finance-orders";

// Una fila de la tabla índice. `detail` es exactamente el RowWithTraces que hoy
// devuelve el endpoint por fila ({ ...row, traces }), para que la Fase 2 lo
// devuelva tal cual sin recomponer nada (contrato de UI idéntico).
export interface FinanceOrderIndexRecord {
  order_key: string;
  tracking_filter: string;
  effective_status: string;
  settlement_count: number;
  is_delivered: boolean;
  order_date: string | null; // YYYY-MM-DD de shopify_created_at, o null
  shopify_created_at: string | null;
  cod_amount: number;
  guide_number: string;
  courier: string;
  match_status: string;
  // Dos textos de búsqueda que reproducen matchesOrderSearch en SQL:
  //  - search_lower: valores en minúscula, unidos por '\n'. Reproduce la rama
  //    `text.includes(rawQuery)` (rawQuery = query.trim().toLowerCase(), nunca
  //    trae '\n', así que un LIKE '%rawQuery%' no cruza el separador → equivale
  //    al includes POR CAMPO).
  //  - search_compact: normalizeSearchText por campo, unidos por '\n'. Reproduce
  //    `compactText.includes(compactQuery)` por el mismo argumento (compactQuery
  //    es alfanumérico, sin '\n').
  search_lower: string;
  search_compact: string;
  detail: TrackableOrderRow & { traces: SettlementTrace[] };
}

// Clave de fecha (YYYY-MM-DD), igual que getOrderDateKey en el endpoint/page.
function orderDateKey(row: TrackableOrderRow): string | null {
  return row.shopify_created_at ? row.shopify_created_at.slice(0, 10) : null;
}

// Campos que matchesOrderSearch inspecciona, en el mismo orden. Se usan para
// construir search_lower / search_compact.
function searchFields(row: TrackableOrderRow): string[] {
  return [
    row.order_name,
    row.shopify_order_name,
    row.shopify_order_number ? String(row.shopify_order_number) : "",
    row.shopify_order_number ? `#MCRC${row.shopify_order_number}` : "",
    row.guide_number,
    row.customer_name,
    row.shopify_note ?? "",
    ...(row.package_items ?? []).flatMap((item) => [item.sku ?? "", item.title]),
  ].map((value) => String(value ?? ""));
}

// Deriva la fila índice de un pedido. Misma semántica que resolveRows.
export function buildOrderIndexRecord(
  row: TrackableOrderRow,
  settlementTraceByKey: Map<string, SettlementTrace[]>
): FinanceOrderIndexRecord {
  const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
  const status = mergeDispatchIntoTracking(
    getEffectiveTrackingStatus(row, traces),
    row.dispatch_view ?? null,
    row
  );
  const trackingFilter = getTrackingFilterFromStatus(status, row);
  const fields = searchFields(row);

  return {
    order_key: row.row_key,
    tracking_filter: trackingFilter,
    effective_status: status,
    settlement_count: traces.length,
    is_delivered: status === "delivered",
    order_date: orderDateKey(row),
    shopify_created_at: row.shopify_created_at ?? null,
    cod_amount: Number(row.cod_amount ?? 0),
    guide_number: row.guide_number ?? "",
    courier: row.courier ?? "",
    match_status: row.match_status ?? "",
    search_lower: fields.map((value) => value.toLowerCase()).join("\n"),
    search_compact: fields.map((value) => normalizeSearchText(value)).join("\n"),
    detail: { ...row, traces },
  };
}

// Deriva todas las filas índice de una tienda a partir del dataset ensamblado.
export function buildOrderIndexRecords(
  rows: TrackableOrderRow[],
  settlementTraceByKey: Map<string, SettlementTrace[]>
): FinanceOrderIndexRecord[] {
  return rows.map((row) => buildOrderIndexRecord(row, settlementTraceByKey));
}
