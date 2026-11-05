// Lector del CSV product_table (ShipHero/Boxful) para el inventario de
// Marketing. Puro: corre igual en el navegador (vista previa) y en el
// servidor (que vuelve a leer el archivo y nunca confía en la vista previa).
//
// Tolerante con lo que produce Excel: BOM, línea "sep=;", fin de línea CRLF,
// comillas RFC 4180, separador coma, punto y coma o tabulador, y encabezados en
// inglés o español.
import type { MarketingStock } from "./marketing-source-types";

export interface InventoryCsvRow {
  /** 1-based physical line where the row starts. */
  line: number;
  sku: string;
  skuKey: string;
  name: string;
  warehouse: string;
  available: number;
  onHand: number | null;
  allocated: number | null;
}
export interface InventoryCsvIssue {
  line: number;
  message: string;
}
export type InventoryStockEntry = MarketingStock & { name: string };
export interface InventoryCsvResult {
  fatal: string | null;
  delimiter: "," | ";" | "\t";
  columns: {
    sku: string;
    available: string;
    availableFrom: "available" | "on_hand";
    name: string | null;
    warehouse: string | null;
    onHand: string | null;
    allocated: string | null;
  };
  /** Valid rows; SKUs repeated in the same warehouse are removed. */
  rows: InventoryCsvRow[];
  /** One entry per SKU, summed across distinct warehouses (warehouseId "varias"). */
  stock: InventoryStockEntry[];
  errors: InventoryCsvIssue[];
  /** Fully empty lines. */
  skipped: number;
}

export const INVENTORY_CSV_MAX_BYTES = 1_000_000;
export const INVENTORY_CSV_MAX_ROWS = 20_000;

const ALIASES = {
  sku: [
    "sku",
    "sku_code",
    "codigo",
    "codigo_sku",
    "code",
    "item_sku",
    "product_sku",
    "variant_sku",
    "referencia",
  ],
  available: [
    "available",
    "disponible",
    "disponibles",
    "available_qty",
    "qty_available",
    "quantity_available",
    "stock_disponible",
    "cantidad_disponible",
  ],
  onHand: [
    "on_hand",
    "onhand",
    "en_mano",
    "stock",
    "existencias",
    "quantity",
    "qty",
    "cantidad",
    "inventario",
  ],
  name: [
    "name",
    "product",
    "product_name",
    "producto",
    "nombre",
    "descripcion",
    "description",
    "title",
    "item",
    "item_name",
  ],
  warehouse: ["warehouse", "warehouse_name", "bodega", "almacen"],
  allocated: ["allocated", "reservado", "asignado", "comprometido"],
} as const;

export const normalHeader = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const inventorySkuKey = (sku: string) => sku.trim().toLowerCase();

/** Digit groups of three after the first group, e.g. `1.234.567`. */
function grouped(value: string, separator: string) {
  const parts = value.split(separator);
  return (
    /^\d{1,3}$/.test(parts[0]) &&
    (parts.length === 1 || parts[0] !== "0") &&
    parts.slice(1).every((part) => /^\d{3}$/.test(part))
  );
}

/**
 * Number in either locale. With both `.` and `,`, the last one is the decimal
 * separator. A lone separator followed by exactly 3 digits is a thousands
 * separator (`1.079`, `1,079`); followed by 1–2 digits it is decimal. Spaces and
 * NBSP are removed (`1 079`). Negative values are kept.
 */
export function parseInventoryNumber(raw: string): number | null {
  let text = raw.replace(/[\s  ]/g, "");
  if (!text) return null;
  let sign = 1;
  if (text.startsWith("-")) {
    sign = -1;
    text = text.slice(1);
  } else if (text.startsWith("+")) text = text.slice(1);
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  const lastDot = text.lastIndexOf("."),
    lastComma = text.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const parts = text.split(decimal);
    if (parts.length !== 2 || !grouped(parts[0], thousands)) return null;
    normalized = `${parts[0].split(thousands).join("")}.${parts[1]}`;
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (!separator) normalized = text;
    else {
      const parts = text.split(separator);
      if (parts.length > 2) {
        if (!grouped(text, separator)) return null;
        normalized = parts.join("");
      } else if (parts[1].length === 3 && /^[1-9]\d{0,2}$/.test(parts[0]))
        normalized = parts.join("");
      else normalized = `${parts[0]}.${parts[1]}`;
    }
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? sign * value : null;
}

/** RFC 4180 records with the physical line where each one starts. */
function readRecords(
  text: string,
  delimiter: string,
  firstLine: number,
): Array<{ line: number; cells: string[] }> {
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = firstLine;
  let start = firstLine;
  let touched = false;
  const endRecord = () => {
    cells.push(cell);
    records.push({ line: start, cells });
    cells = [];
    cell = "";
    touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      touched = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
      touched = true;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      start = line;
    } else {
      cell += char;
      touched = true;
    }
  }
  if (touched || cell) endRecord();
  return records;
}

function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  const counts: Record<"," | ";" | "\t", number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of headerLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "," || char === ";" || char === "\t"))
      counts[char]++;
  }
  return ([";", "\t"] as const).reduce<"," | ";" | "\t">(
    (best, d) => (counts[d] > counts[best] ? d : best),
    ",",
  );
}

const emptyColumns = (): InventoryCsvResult["columns"] => ({
  sku: "",
  available: "",
  availableFrom: "available",
  name: null,
  warehouse: null,
  onHand: null,
  allocated: null,
});

export function parseInventoryCsv(input: string): InventoryCsvResult {
  const result: InventoryCsvResult = {
    fatal: null,
    delimiter: ",",
    columns: emptyColumns(),
    rows: [],
    stock: [],
    errors: [],
    skipped: 0,
  };
  const fail = (message: string) => ({ ...result, fatal: message });
  if (new TextEncoder().encode(input).length > INVENTORY_CSV_MAX_BYTES)
    return fail("El archivo pesa más de 1 MB.");
  let text = input.replace(/^﻿/, "");
  if (!text.trim()) return fail("El archivo está vacío.");
  let firstLine = 1;
  const sep = /^sep=(.)[ \t]*(\r\n|\n|\r|$)/i.exec(text);
  let forced: "," | ";" | "\t" | null = null;
  if (sep) {
    if (sep[1] === "," || sep[1] === ";" || sep[1] === "\t") forced = sep[1];
    text = text.slice(sep[0].length);
    firstLine = 2;
  }
  // Leading blank lines before the header do not count as data.
  while (/^[ \t]*(\r\n|\n|\r)/.test(text)) {
    text = text.replace(/^[ \t]*(\r\n|\n|\r)/, "");
    firstLine++;
  }
  if (!text.trim()) return fail("El archivo está vacío.");
  const headerLine = /^[^\r\n]*/.exec(text)![0];
  result.delimiter = forced ?? detectDelimiter(headerLine);
  const [header, ...records] = readRecords(text, result.delimiter, firstLine);
  const headers = header.cells.map((cell) => normalHeader(cell));
  const find = (aliases: readonly string[]) => {
    for (const alias of aliases) {
      const index = headers.indexOf(alias);
      if (index >= 0) return index;
    }
    return -1;
  };
  const label = (index: number) =>
    index >= 0 ? header.cells[index].trim() : null;
  const skuIndex = find(ALIASES.sku);
  if (skuIndex < 0)
    return fail("No se encontró la columna de SKU (sku, SKU, Sku, código).");
  const availableIndex = find(ALIASES.available);
  const onHandIndex = find(ALIASES.onHand);
  if (availableIndex < 0 && onHandIndex < 0)
    return fail(
      "No se encontró la columna de disponibles (Available, Disponible u On hand).",
    );
  const nameIndex = find(ALIASES.name),
    warehouseIndex = find(ALIASES.warehouse),
    allocatedIndex = find(ALIASES.allocated);
  const useIndex = availableIndex >= 0 ? availableIndex : onHandIndex;
  result.columns = {
    sku: label(skuIndex)!,
    available: label(useIndex)!,
    availableFrom: availableIndex >= 0 ? "available" : "on_hand",
    name: label(nameIndex),
    warehouse: label(warehouseIndex),
    onHand: label(onHandIndex),
    allocated: label(allocatedIndex),
  };
  const data = records.filter((record) => {
    const empty = record.cells.every((cell) => !cell.trim());
    if (empty) result.skipped++;
    return !empty;
  });
  if (data.length > INVENTORY_CSV_MAX_ROWS)
    return fail("El archivo tiene más de 20.000 filas.");
  const cellAt = (cells: string[], index: number) =>
    index >= 0 ? (cells[index] ?? "").trim() : "";
  const valid: InventoryCsvRow[] = [];
  for (const record of data) {
    const sku = cellAt(record.cells, skuIndex).slice(0, 100);
    if (!sku) {
      result.errors.push({ line: record.line, message: "Fila sin SKU" });
      continue;
    }
    const available = parseInventoryNumber(cellAt(record.cells, useIndex));
    if (available == null) {
      result.errors.push({
        line: record.line,
        message: "Disponible vacío o no es un número",
      });
      continue;
    }
    valid.push({
      line: record.line,
      sku,
      skuKey: inventorySkuKey(sku),
      name: cellAt(record.cells, nameIndex).slice(0, 300),
      warehouse: cellAt(record.cells, warehouseIndex).slice(0, 100),
      available,
      onHand:
        onHandIndex >= 0
          ? parseInventoryNumber(cellAt(record.cells, onHandIndex))
          : null,
      allocated:
        allocatedIndex >= 0
          ? parseInventoryNumber(cellAt(record.cells, allocatedIndex))
          : null,
    });
  }
  // The same SKU twice in the same warehouse cannot be trusted: drop both.
  const byPlace = new Map<string, InventoryCsvRow[]>();
  for (const row of valid) {
    const key = `${row.skuKey}\u0000${row.warehouse.toLowerCase()}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), row]);
  }
  for (const rows of Array.from(byPlace.values()))
    if (rows.length > 1)
      for (const row of rows)
        result.errors.push({
          line: row.line,
          message: "SKU repetido en la misma bodega",
        });
  result.rows = valid.filter(
    (row) =>
      byPlace.get(`${row.skuKey}\u0000${row.warehouse.toLowerCase()}`)!
        .length === 1,
  );
  result.errors.sort((a, b) => a.line - b.line);
  const bySku = new Map<
    string,
    { entry: InventoryStockEntry; warehouses: Set<string> }
  >();
  for (const row of result.rows) {
    const current = bySku.get(row.skuKey) ?? {
      entry: {
        sku: row.sku,
        name: row.name,
        warehouseId: "",
        onHand: 0,
        available: 0,
        allocated: 0,
      },
      warehouses: new Set<string>(),
    };
    current.entry.available += row.available;
    current.entry.onHand += row.onHand ?? row.available;
    current.entry.allocated += row.allocated ?? 0;
    if (!current.entry.name && row.name) current.entry.name = row.name;
    current.warehouses.add(row.warehouse);
    bySku.set(row.skuKey, current);
  }
  result.stock = Array.from(bySku.values()).map(({ entry, warehouses }) => {
    const list = Array.from(warehouses);
    return {
      ...entry,
      available: Math.round(entry.available * 1000) / 1000,
      onHand: Math.round(entry.onHand * 1000) / 1000,
      allocated: Math.round(entry.allocated * 1000) / 1000,
      warehouseId: list.length > 1 ? "varias" : list[0] ? list[0] : "csv",
    };
  });
  return result;
}

/** Warehouses of each SKU in the parsed rows (for storage). */
export function inventoryWarehouses(rows: InventoryCsvRow[]) {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.skuKey) ?? [];
    if (row.warehouse && !list.includes(row.warehouse))
      list.push(row.warehouse);
    map.set(row.skuKey, list);
  }
  return map;
}

/** Catalog keys are `sku:<lowercase sku>`, the same key the orders use. */
export function matchInventoryToCatalog(
  stock: Array<{ sku: string; name?: string }>,
  catalog: Array<{ key: string; sku: string; name: string }>,
): {
  matched: number;
  unmatched: Array<{ sku: string; name: string }>;
  catalogWithoutStock: number;
} {
  const keys = new Set(catalog.map((item) => item.key));
  const stocked = new Set<string>();
  let matched = 0;
  const unmatched: Array<{ sku: string; name: string }> = [];
  for (const item of stock) {
    const key = `sku:${inventorySkuKey(item.sku)}`;
    stocked.add(key);
    if (keys.has(key)) matched++;
    else unmatched.push({ sku: item.sku, name: item.name ?? "" });
  }
  return {
    matched,
    unmatched,
    catalogWithoutStock: catalog.filter(
      (item) => item.key.startsWith("sku:") && !stocked.has(item.key),
    ).length,
  };
}
