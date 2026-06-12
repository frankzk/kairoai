import * as XLSX from "xlsx";

// Tipos de celda que sheet_to_json acepta; cualquier otro (p. ej. t="f" en los
// exports de Boxful) hace que la libreria aborte con "unrecognized type".
const KNOWN_CELL_TYPES = new Set(["z", "e", "s", "d", "b", "n"]);

export function readWorkbook(data: ArrayBuffer): XLSX.WorkBook {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  sanitizeWorkbook(workbook);
  return workbook;
}

export function sheetToJson<T>(sheet: XLSX.WorkSheet | undefined, opts: XLSX.Sheet2JSONOpts): T[] {
  sanitizeSheet(sheet);
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<T>(sheet, opts);
}

export function sanitizeWorkbook(workbook: XLSX.WorkBook): void {
  for (const name of workbook.SheetNames) {
    sanitizeSheet(workbook.Sheets[name]);
  }
}

export function sanitizeSheet(sheet: XLSX.WorkSheet | undefined): void {
  if (!sheet) return;
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address] as XLSX.CellObject | undefined;
    if (!cell || typeof cell !== "object") continue;
    if (!cell.t || KNOWN_CELL_TYPES.has(cell.t)) continue;

    const value = cell.v;
    if (typeof value === "number" && Number.isFinite(value)) {
      cell.t = "n";
    } else if (typeof value === "boolean") {
      cell.t = "b";
    } else if (value instanceof Date) {
      cell.t = "d";
    } else {
      cell.t = "s";
      cell.v = extractFormulaDisplayValue(cell.f) || cell.w || (value == null ? "" : String(value));
      cell.w = String(cell.v ?? "");
    }
  }
}

function extractFormulaDisplayValue(formula?: string): string {
  if (!formula) return "";
  const hyperlinkMatch = formula.match(/^HYPERLINK\(\s*"([^"]+)"/i);
  if (hyperlinkMatch?.[1]) return hyperlinkMatch[1];
  return "";
}
