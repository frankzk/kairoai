// Definicion del dataset de finanzas y helpers de (de)serializacion por
// seccion. Modulo puro (sin DB ni env) para poder probarlo en vitest.
//
// El dataset se guarda en L2 (finance_dataset_cache) dividido en secciones
// (una fila por store_id+section) para que cada ruta descargue solo lo que
// usa: el payload completo llego a ~8MB gzip (~68MB JSON) con ~15k pedidos,
// y orders/ solo necesita rows+settlementTraceByKey (~1.6MB gzip).
//
// La fila legacy (section='full', pre-0021) se mantiene como fallback de
// lectura/escritura mientras no existan filas por seccion.

import type {
  DoubleSettlementAnomaly,
  SettlementTrace,
  ShopifyOrderSummary,
  TrackableOrderRow,
} from "@/lib/finance-orders";
import type { LogisticsRow, SettlementImport, SettlementRow } from "@/lib/finance-types";

export interface OrdersDataset {
  rows: TrackableOrderRow[];
  settlementTraceByKey: Map<string, SettlementTrace[]>;
  shopifyOrders: ShopifyOrderSummary[];
  matchedSettlementRows: SettlementRow[];
  imports: SettlementImport[];
  logisticsRows: LogisticsRow[];
  liquidationAlertRows: LogisticsRow[];
  doubleSettlementAnomalies: DoubleSettlementAnomaly[];
}

export type DatasetSection = keyof OrdersDataset;

export const DATASET_SECTIONS: readonly DatasetSection[] = [
  "rows",
  "settlementTraceByKey",
  "shopifyOrders",
  "matchedSettlementRows",
  "imports",
  "logisticsRows",
  "liquidationAlertRows",
  "doubleSettlementAnomalies",
];

// Fila legacy (0013): el dataset completo en una sola fila por tienda.
export const LEGACY_FULL_SECTION = "full";

// settlementTraceByKey es un Map; JSON no lo representa, asi que viaja como
// arreglo de entradas [clave, trazas]. El resto de secciones ya son datos
// planos (strings/numbers/null/arreglos de objetos) y viajan por JSONB sin
// perdida (las fechas son strings ISO).
type SettlementTraceEntries = Array<[string, SettlementTrace[]]>;

export function serializeSection(
  section: DatasetSection,
  value: OrdersDataset[DatasetSection]
): unknown {
  if (section === "settlementTraceByKey") {
    return Array.from((value as Map<string, SettlementTrace[]>).entries());
  }
  return value;
}

export function deserializeSection(
  section: DatasetSection,
  payload: unknown
): OrdersDataset[DatasetSection] {
  if (section === "settlementTraceByKey") {
    return new Map<string, SettlementTrace[]>((payload as SettlementTraceEntries) ?? []);
  }
  return payload as OrdersDataset[DatasetSection];
}

// Serializa el dataset completo en el formato legacy de una sola pieza
// (compatible con la fila 'full' de 0013).
export type SerializedFullDataset = {
  [K in DatasetSection]: unknown;
};

export function serializeFullDataset(data: OrdersDataset): SerializedFullDataset {
  const out = {} as SerializedFullDataset;
  for (const section of DATASET_SECTIONS) {
    out[section] = serializeSection(section, data[section]);
  }
  return out;
}

export function deserializeFullDataset(payload: SerializedFullDataset): OrdersDataset {
  const data = {} as OrdersDataset;
  for (const section of DATASET_SECTIONS) {
    (data[section] as OrdersDataset[DatasetSection]) = deserializeSection(section, payload[section]);
  }
  return data;
}

// Recorta un dataset a las secciones pedidas (para responder tras servir
// desde la fila legacy o desde L1).
export function pickSections<S extends DatasetSection>(
  data: OrdersDataset,
  sections: readonly S[]
): Pick<OrdersDataset, S> {
  const out = {} as Pick<OrdersDataset, S>;
  for (const section of sections) {
    out[section] = data[section];
  }
  return out;
}
