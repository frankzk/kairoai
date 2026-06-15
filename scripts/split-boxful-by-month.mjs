// Divide un Excel logistico de Boxful en un archivo por mes, segun la columna
// "Creado en". Sirve para esquivar el timeout de Vercel (504
// FUNCTION_INVOCATION_TIMEOUT) al importar archivos grandes: se sube un mes a la
// vez por la UI en lugar de un rango de varios meses en un solo request.
//
// Uso:
//   node scripts/split-boxful-by-month.mjs "01-11-2025 hasta 31-01-2026.xlsx"
//
// Genera, junto al original:
//   01-11-2025 hasta 31-01-2026__2025-11.xlsx
//   01-11-2025 hasta 31-01-2026__2025-12.xlsx
//   01-11-2025 hasta 31-01-2026__2026-01.xlsx
//
// La logica de fecha replica parseDate() de app/api/finance/logistics/route.ts
// para que el agrupado por mes coincida con como el importador interpreta las
// filas. Las filas sin fecha legible van a un archivo "__sin-fecha.xlsx" para no
// perder ninguna.

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const input = process.argv[2];
if (!input) {
  console.error('Uso: node scripts/split-boxful-by-month.mjs "<archivo.xlsx>"');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`No existe el archivo: ${input}`);
  process.exit(1);
}

// Mismo criterio que parseDate() del importador: admite dd/mm/yyyy y dd-mm-yyyy
// (toma mes=parts[1], anio=parts[2]); si no, cae a Date() para ISO u otros.
function monthKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return "sin-fecha";
  const parts = raw.split(/[/-]/).map((n) => Number(n));
  if (parts.length === 3 && parts[2] > 1900) {
    const [, month, year] = parts;
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "sin-fecha";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

const workbook = XLSX.read(fs.readFileSync(input), { cellDates: false });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
const header = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })[0] || [];

if (!rows.length) {
  console.error("El archivo no tiene filas de datos.");
  process.exit(1);
}

const groups = new Map();
for (const row of rows) {
  const key = monthKey(row["Creado en"]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const base = path.basename(input).replace(/\.(xlsx|xls)$/i, "");
const dir = path.dirname(input);
const summary = [];

for (const [key, groupRows] of [...groups.entries()].sort()) {
  const outWorkbook = XLSX.utils.book_new();
  const outSheet = XLSX.utils.json_to_sheet(groupRows, header.length ? { header } : {});
  XLSX.utils.book_append_sheet(outWorkbook, outSheet, sheetName.slice(0, 31) || "Hoja1");
  const outName = path.join(dir, `${base}__${key}.xlsx`);
  fs.writeFileSync(outName, XLSX.write(outWorkbook, { type: "buffer", bookType: "xlsx" }));
  summary.push({ mes: key, filas: groupRows.length, archivo: path.basename(outName) });
}

console.table(summary);
console.log(`Total: ${rows.length} filas -> ${groups.size} archivo(s) generados junto al original.`);
