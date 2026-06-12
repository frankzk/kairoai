import * as XLSX from "xlsx";

// Tipos de celda que sheet_to_json acepta; cualquier otro (p. ej. t="f" en los
// exports de Boxful) hace que la libreria aborte con "unrecognized type".
const KNOWN_CELL_TYPES = new Set(["z", "e", "s", "d", "b", "n"]);

export function readWorkbook(data: ArrayBuffer): XLSX.WorkBook {
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  return sanitizeWorkbook(workbook);
}

export function sanitizeWorkbook(workbook: XLSX.WorkBook): XLSX.WorkBook {
  for (const name of workbook.SheetNames) {
    sanitizeSheet(workbook.Sheets[name]);
  }
  return workbook;
}

function sanitizeSheet(sheet: XLSX.WorkSheet | undefined) {
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
      cell.v = cell.w ?? (value == null ? "" : String(value));
    }
  }
}
