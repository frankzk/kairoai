// Exporta filas (objetos planos) a un archivo .xlsx descargable desde el cliente.
// Carga la libreria xlsx de forma diferida (solo al exportar) para no sumarla al
// bundle inicial. Las columnas salen de las claves de cada objeto.
export async function exportXlsx(
  filename: string,
  rows: Array<Record<string, unknown>>,
  sheetName = "Datos"
): Promise<void> {
  if (!rows.length) return;
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const blob = new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
