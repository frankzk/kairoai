import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { sanitizeWorkbook } from "../lib/xlsx";

// Simula el resultado de leer un export de Boxful: el parser de SheetJS pasa
// el atributo t="f" (fuera del estandar) tal cual a la celda, y sheet_to_json
// aborta con "unrecognized type f" si no se sanea.
function buildWorkbookWithBadCells(): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["No. Guia", "Orden", "Monto COD"],
    ["BX123456", "#MCRC11566", "25000"],
  ]);
  sheet.B2 = { t: "f" as XLSX.CellObject["t"], v: "#MCRC11566", w: "#MCRC11566" };
  sheet.C2 = { t: "f" as XLSX.CellObject["t"], v: "25000" };
  sheet.D2 = { t: "f" as XLSX.CellObject["t"] }; // sin valor
  const range = XLSX.utils.decode_range(sheet["!ref"] as string);
  range.e.c = Math.max(range.e.c, 3);
  sheet["!ref"] = XLSX.utils.encode_range(range);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Envios");
  return workbook;
}

describe("sanitizeWorkbook", () => {
  it("reproduce el fallo sin sanear", () => {
    const workbook = buildWorkbookWithBadCells();
    expect(() =>
      XLSX.utils.sheet_to_json(workbook.Sheets.Envios, { defval: "", raw: false })
    ).toThrow(/unrecognized type/);
  });

  it("convierte tipos desconocidos y permite leer todas las filas", () => {
    const workbook = sanitizeWorkbook(buildWorkbookWithBadCells());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Envios, {
      defval: "",
      raw: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]["No. Guia"]).toBe("BX123456");
    expect(rows[0]["Orden"]).toBe("#MCRC11566");
    expect(rows[0]["Monto COD"]).toBe("25000");
  });

  it("no altera celdas con tipos validos", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["a", 1, true]]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Hoja1");
    sanitizeWorkbook(workbook);
    expect(workbook.Sheets.Hoja1.A1).toMatchObject({ t: "s", v: "a" });
    expect(workbook.Sheets.Hoja1.B1).toMatchObject({ t: "n", v: 1 });
    expect(workbook.Sheets.Hoja1.C1).toMatchObject({ t: "b", v: true });
  });
});
