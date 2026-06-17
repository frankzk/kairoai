// Importador de archivos de liquidacion / logistica con formato pluggable.
//
// Hasta ahora el parseo estaba hardcodeado al export de Boxful y DUPLICADO entre
// app/api/finance/settlements/route.ts y app/api/finance/logistics/route.ts
// (helpers text/money/parseDate incluidos). Aqui queda centralizado detras de un
// pequeno registro de "adaptadores de formato": cada formato sabe detectarse
// (`detect`) y parsear (`parse`) a una fila canonica. Hoy el unico adaptador es
// Boxful; sumar un formato nuevo es agregar un adaptador con su `detect`/`parse`
// (los especificos van primero; Boxful queda de ultimo como catch-all).
//
// Modulo puro (sin DB ni React): la asignacion de Shopify y el armado de la fila
// de BD siguen en las rutas. Testeable con workbooks sinteticos.

import * as XLSX from "xlsx";
import { sheetToJson } from "@/lib/xlsx";
import type { InternalOrderStatus, LogisticsPackageItem, SettlementRow } from "@/lib/finance-types";

// ---------------------------------------------------------------------------
// Filas canonicas (movidas VERBATIM desde las rutas)
// ---------------------------------------------------------------------------

export interface ParsedSettlementRow {
  raw: Record<string, unknown>;
  guide_number: string;
  order_name: string;
  store_order_number: string;
  customer_name: string;
  first_name: string;
  last_name: string;
  customer_phone: string;
  created_on: string | null;
  courier: string;
  service_type: string;
  cod_amount: number;
  cod_commission: number;
  card_commission: number;
  delivery_cost: number;
  pick_pack_cost: number;
  packaging_cost: number;
  amount_to_liquidate: number;
  settlement_status: string;
  internal_status: InternalOrderStatus;
}

export interface ParsedLogisticsRow {
  raw: Record<string, unknown>;
  guide_number: string;
  order_name: string;
  store_order_number: string;
  customer_name: string;
  first_name: string;
  last_name: string;
  customer_phone: string;
  created_on: string | null;
  courier: string;
  boxful_status: string;
  service_type: string;
  cod_amount: number;
  cod_commission: number;
  delivery_cost: number;
  total_cost: number;
  liquidated_on: string | null;
  finalized_on: string | null;
  label_url: string;
  package_items: LogisticsPackageItem[];
}

export interface ParsedConsolidated {
  total_collected: number;
  total_to_liquidate: number;
}

// ---------------------------------------------------------------------------
// Helpers de celda (deduplicados de las dos rutas)
// ---------------------------------------------------------------------------

export function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function money(value: unknown): number {
  const raw = text(value);
  if (!raw || raw === "-") return 0;
  return Number(raw.replace(/,/g, "").replace(/[^0-9.-]/g, "")) || 0;
}

export function parseDate(value: string): string | null {
  if (!value || value === "-") return null;
  const parts = value.split(/[/-]/).map(Number);
  if (parts.length === 3 && parts[2] > 1900) {
    const [day, month, year] = parts;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Clave de deduplicacion de una fila de liquidacion: guia (preferida) u orden.
// Coincide con el backfill SQL de la migracion 0015
// (COALESCE(NULLIF(BTRIM(guide),''), NULLIF(BTRIM(order),''), 'id:'||id)) para que
// el upsert por (store_id, dedup_key) encuentre las filas ya existentes. El
// fallback 'id:'||id del SQL es SOLO para filas preexistentes sin guia ni orden;
// el import nunca produce clave vacia porque parseBoxfulSettlement descarta las
// filas sin guia ni orden, asi que aca no hace falta replicar ese fallback.
export function dedupKey(guide: string | null | undefined, order: string | null | undefined): string {
  const g = String(guide ?? "").trim();
  if (g) return g;
  return String(order ?? "").trim();
}

// Operaciones de BD inyectadas para persistir un import de liquidaciones con
// rollback seguro (se inyectan para poder testear el rollback sin tocar Supabase).
export interface SettlementPersistDeps {
  // Filas existentes con esas dedup_keys (pre-imagenes de OTROS archivos).
  listByDedupKeys: (storeId: number, keys: string[]) => Promise<SettlementRow[]>;
  upsertByDedup: (rows: Array<Omit<SettlementRow, "id" | "created_at">>) => Promise<void>;
  restoreById: (rows: SettlementRow[]) => Promise<void>;
  deleteImport: (importId: number, storeId: number) => Promise<void>;
}

// Persiste las filas del import con upsert idempotente por (store_id, dedup_key)
// y rollback SEGURO. El upsert puede ACTUALIZAR (re-apuntar) filas de otro archivo
// que compartan dedup_key; por eso, antes de upsertar se capturan sus pre-imagenes
// y, si algun lote falla, se restauran ANTES de borrar el import nuevo — asi el
// cascade del delete solo alcanza las filas recien insertadas, nunca las ajenas.
export async function persistSettlementRowsWithRollback(args: {
  rows: Array<Omit<SettlementRow, "id" | "created_at">>;
  storeId: number;
  importId: number;
  batchSize: number;
  concurrency: number;
  deps: SettlementPersistDeps;
}): Promise<void> {
  const { rows, storeId, importId, batchSize, concurrency, deps } = args;
  const dedupKeys = rows.map((row) => row.dedup_key).filter((key): key is string => Boolean(key));
  let preimages: SettlementRow[] = [];
  try {
    preimages = await deps.listByDedupKeys(storeId, dedupKeys);
    const batches: (typeof rows)[] = [];
    for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize));
    for (let i = 0; i < batches.length; i += concurrency) {
      await Promise.all(batches.slice(i, i + concurrency).map(deps.upsertByDedup));
    }
  } catch (insertError) {
    if (preimages.length) await deps.restoreById(preimages).catch(() => undefined);
    await deps.deleteImport(importId, storeId).catch(() => undefined);
    const detail = insertError instanceof Error ? insertError.message : String(insertError);
    throw new Error(`No se pudieron guardar las filas (import revertido): ${detail}`);
  }
}

export function inferEarliestCreatedOn(rows: Array<{ created_on: string | null }>): string | null {
  const dates = rows
    .map((row) => row.created_on)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates[0] ?? null;
}

function mapSettlementStatus(status: string): InternalOrderStatus {
  const lower = status.toLowerCase();
  if (lower.includes("entregado") && !lower.includes("no entregado")) return "delivered";
  if (lower.includes("no entregado") || lower.includes("devuelto")) return "not_delivered";
  return "pending";
}

// Encabezados (primera fila) de una hoja, para detectar el formato.
function sheetHeaderSet(sheet: XLSX.WorkSheet | undefined): Set<string> {
  if (!sheet) return new Set();
  const headerRows = sheetToJson<unknown[]>(sheet, { header: 1, defval: "" });
  const first = Array.isArray(headerRows[0]) ? headerRows[0] : [];
  return new Set(first.map((value) => text(value)).filter(Boolean));
}

// ---------------------------------------------------------------------------
// Adaptador Boxful (logica movida VERBATIM desde las rutas)
// ---------------------------------------------------------------------------

function parseBoxfulSettlement(workbook: XLSX.WorkBook): ParsedSettlementRow[] {
  const sheet = workbook.Sheets.Envios ?? workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheetToJson<Record<string, unknown>>(sheet, { defval: "", raw: false });

  return rows
    .map((raw) => {
      const firstName = text(raw.Nombre);
      const lastName = text(raw.Apellido);
      const settlementStatus = text(raw.Estado);
      return {
        raw,
        guide_number: text(raw["No. Guia"]),
        order_name: text(raw.Orden),
        store_order_number: text(raw["No. Orden tienda"]),
        customer_name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
        customer_phone: text(raw.Telefono),
        created_on: parseDate(text(raw["Creado en"])),
        courier: text(raw.Courier),
        service_type: text(raw["Tipo de Servicio"]),
        cod_amount: money(raw["Monto COD"]),
        cod_commission: money(raw["Monto de comision COD"]),
        card_commission: money(raw["Com. Tarjeta"]),
        delivery_cost: money(raw["Costo de entrega"]),
        pick_pack_cost: money(raw["Pick&Pack"]),
        packaging_cost: money(raw.Empaque),
        amount_to_liquidate: money(raw["A Liquidar"]),
        settlement_status: settlementStatus,
        internal_status: mapSettlementStatus(settlementStatus),
      };
    })
    .filter((row) => row.order_name || row.guide_number);
}

function parseBoxfulConsolidated(workbook: XLSX.WorkBook): ParsedConsolidated {
  const sheet = workbook.Sheets.Consolidado;
  if (!sheet) return { total_collected: 0, total_to_liquidate: 0 };

  const rows = sheetToJson<Record<string, unknown>>(sheet, {
    header: ["description", "amount"],
    defval: "",
    raw: false,
  });

  let totalCollected = 0;
  let totalToLiquidate = 0;
  for (const row of rows) {
    const description = text(row.description).toLowerCase();
    if (description.includes("total colectado")) totalCollected = money(row.amount);
    if (description.includes("monto a liquidar") || description.includes("total a recibir")) {
      totalToLiquidate = money(row.amount);
    }
  }
  return { total_collected: totalCollected, total_to_liquidate: totalToLiquidate };
}

function parseBoxfulPackageItems(raw: Record<string, unknown>): LogisticsPackageItem[] {
  const items: LogisticsPackageItem[] = [];
  for (let i = 1; i <= 4; i++) {
    const title = text(raw[`Paquete ${i}`]);
    if (!title) continue;
    items.push({
      title,
      quantity: Number(text(raw[`Cantidad Paquete ${i}`]) || 0),
      price: money(raw[`Precio Paquete ${i}`]),
    });
  }
  return items;
}

function parseBoxfulLogistics(workbook: XLSX.WorkBook): ParsedLogisticsRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheetToJson<Record<string, unknown>>(sheet, { defval: "", raw: false });

  return rows
    .map((raw) => {
      const firstName = text(raw.Nombre);
      const lastName = text(raw.Apellido);
      return {
        raw,
        guide_number: text(raw["No. Guia"]),
        order_name: text(raw.Orden),
        store_order_number: text(raw["No. Orden tienda"]),
        customer_name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
        customer_phone: text(raw.Telefono),
        created_on: parseDate(text(raw["Creado en"])),
        courier: text(raw.Courier),
        boxful_status: text(raw.Estado),
        service_type: text(raw["Tipo de Servicio"]),
        cod_amount: money(raw["Monto COD"]),
        cod_commission: money(raw["Monto de comision COD"]),
        delivery_cost: money(raw["Costo de entrega"]),
        total_cost: money(raw.Total),
        liquidated_on: parseDate(text(raw["Liquidado en"])),
        finalized_on: parseDate(text(raw["Finalización"])),
        label_url: text(raw.Etiqueta),
        package_items: parseBoxfulPackageItems(raw),
      };
    })
    .filter((row) => row.guide_number || row.order_name);
}

function detectBoxfulSettlement(workbook: XLSX.WorkBook): boolean {
  const sheet = workbook.Sheets.Envios ?? workbook.Sheets[workbook.SheetNames[0]];
  const headers = sheetHeaderSet(sheet);
  return headers.has("No. Guia") && (headers.has("A Liquidar") || headers.has("Monto COD"));
}

function detectBoxfulLogistics(workbook: XLSX.WorkBook): boolean {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const headers = sheetHeaderSet(sheet);
  return headers.has("No. Guia") && headers.has("Estado");
}

// ---------------------------------------------------------------------------
// Registro de formatos + deteccion
// ---------------------------------------------------------------------------

export interface SettlementFormat {
  id: string;
  label: string;
  detect: (workbook: XLSX.WorkBook) => boolean;
  parse: (workbook: XLSX.WorkBook) => ParsedSettlementRow[];
  parseConsolidated: (workbook: XLSX.WorkBook) => ParsedConsolidated;
}

export interface LogisticsFormat {
  id: string;
  label: string;
  detect: (workbook: XLSX.WorkBook) => boolean;
  parse: (workbook: XLSX.WorkBook) => ParsedLogisticsRow[];
}

// Orden = prioridad de deteccion. Los formatos especificos van primero; Boxful
// queda de ultimo (hoy es el unico). Para sumar un formato: agregar su adaptador
// ANTES de Boxful con un `detect` que reconozca sus columnas.
export const SETTLEMENT_FORMATS: SettlementFormat[] = [
  {
    id: "boxful",
    label: "Boxful",
    detect: detectBoxfulSettlement,
    parse: parseBoxfulSettlement,
    parseConsolidated: parseBoxfulConsolidated,
  },
];

export const LOGISTICS_FORMATS: LogisticsFormat[] = [
  {
    id: "boxful",
    label: "Boxful",
    detect: detectBoxfulLogistics,
    parse: parseBoxfulLogistics,
  },
];

export function parseSettlementWorkbook(workbook: XLSX.WorkBook): {
  format: string;
  rows: ParsedSettlementRow[];
  consolidated: ParsedConsolidated;
} {
  const format = SETTLEMENT_FORMATS.find((candidate) => candidate.detect(workbook));
  if (!format) {
    throw new Error(
      "Formato de liquidacion no reconocido. Se esperaba un export de Boxful con columnas como 'No. Guia' y 'A Liquidar'."
    );
  }
  return {
    format: format.id,
    rows: format.parse(workbook),
    consolidated: format.parseConsolidated(workbook),
  };
}

export function parseLogisticsWorkbook(workbook: XLSX.WorkBook): {
  format: string;
  rows: ParsedLogisticsRow[];
} {
  const format = LOGISTICS_FORMATS.find((candidate) => candidate.detect(workbook));
  if (!format) {
    throw new Error(
      "Formato de logistica no reconocido. Se esperaba un export de Boxful con columnas como 'No. Guia' y 'Estado'."
    );
  }
  return { format: format.id, rows: format.parse(workbook) };
}
