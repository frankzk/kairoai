"use client";
import { useId, useState } from "react";
import {
  INVENTORY_CSV_MAX_BYTES,
  matchInventoryToCatalog,
  parseInventoryCsv,
  type InventoryCsvResult,
} from "@/lib/marketing-inventory-csv";
import { shiftDate } from "@/lib/marketing-dates";
import type { MarketingSummary } from "@/lib/marketing";
import { sendMarketing, type MarketingInventoryStatus } from "./useMarketing";
import { count, shortDate, timeCr } from "./format";
import r from "./team-report.module.css";

type Status = {
  data: MarketingInventoryStatus | null;
  loading: boolean;
  error: string;
};

/** One line about the uploaded product_table, for the stock panel and "Completa el reporte". */
export function inventoryStatusText(status: Status): {
  text: string;
  warning: string | null;
} {
  if (status.loading)
    return { text: "Consultando el inventario…", warning: null };
  if (!status.data)
    return {
      text: status.error || "No se pudo consultar el inventario guardado.",
      warning: null,
    };
  if (status.data.status === "pending_migration")
    return {
      text:
        status.data.message || "Pendiente: aplicar migración del inventario.",
      warning: null,
    };
  const latest = status.data.latest;
  if (!latest)
    return {
      text: "Sube el product_table para ver los días de stock.",
      warning: null,
    };
  return {
    text: `Último archivo: ${shortDate(latest.snapshotDate)} · ${timeCr(latest.uploadedAt)} · ${latest.uploadedBy} · ${count(latest.skus)} SKU`,
    warning:
      latest.snapshotDate < shiftDate(status.data.today, -1)
        ? `El inventario es del ${shortDate(latest.snapshotDate)}. Sube el archivo de hoy.`
        : null,
  };
}

/** Upload of the daily product_table CSV (ShipHero/Boxful export) while the ShipHero API is not connected. */
export function InventoryUpload({
  status,
  catalog,
  canEdit,
  onSaved,
}: {
  status: Status;
  catalog: MarketingSummary["catalog"];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const inputId = useId();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [parsed, setParsed] = useState<InventoryCsvResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const line = inventoryStatusText(status);
  const pending = status.data?.status === "pending_migration";
  const match =
    parsed && !parsed.fatal
      ? matchInventoryToCatalog(parsed.stock, catalog)
      : null;
  function reset() {
    setFile(null);
    setParsed(null);
    setError("");
  }
  async function choose(selected: File | undefined) {
    reset();
    setDone("");
    if (!selected) return;
    if (selected.size > INVENTORY_CSV_MAX_BYTES) {
      setError("El archivo pesa más de 1 MB.");
      return;
    }
    try {
      const text = await selected.text();
      const result = parseInventoryCsv(text);
      if (result.fatal) setError(result.fatal);
      else if (!result.stock.length)
        setError("El archivo no tiene filas válidas de inventario.");
      else {
        setFile({ name: selected.name, text });
        setParsed(result);
      }
    } catch {
      setError("No se pudo leer el archivo.");
    }
  }
  async function submit() {
    if (!file) return;
    setBusy(true);
    setError("");
    const result = await sendMarketing<{
      skus: number;
      unmatched: number | null;
    }>("/api/marketing/inventory?store=mireva-cr", "POST", {
      fileName: file.name.slice(0, 200),
      csv: file.text,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    setDone(`Inventario guardado: ${count(result.data.skus)} SKU.`);
    onSaved();
  }
  return (
    <div className={r.upload}>
      <p>{line.text}</p>
      {line.warning && (
        <p role="alert" className={r.warnText}>
          {line.warning}
        </p>
      )}
      {done && <p role="status">{done}</p>}
      {canEdit && !pending && !file && (
        <label htmlFor={inputId} className={r.field}>
          Subir product_table (CSV)
          <input
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && (
        <p role="alert" className={r.risk}>
          {error}
        </p>
      )}
      {parsed && match && (
        <div className={r.preview}>
          <p>
            <strong>{file?.name}</strong>
            <br />
            {count(parsed.rows.length)} filas · {count(match.matched)} SKU del
            catálogo · {count(match.unmatched.length)} sin coincidencia ·{" "}
            {count(parsed.errors.length)} con error
          </p>
          <p>
            {parsed.columns.backorder || parsed.columns.incoming
              ? `Columnas extra: ${[
                  parsed.columns.backorder &&
                    `Esperando (${parsed.columns.backorder})`,
                  parsed.columns.incoming &&
                    `En camino (${parsed.columns.incoming})`,
                ]
                  .filter(Boolean)
                  .join(" · ")}`
              : "Sin columnas de esperando ni en camino."}
          </p>
          {parsed.columns.availableFrom === "on_hand" && (
            <p className={r.warnText}>
              El archivo no trae Disponible; se usa On hand.
            </p>
          )}
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Primeras filas del archivo"
          >
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Bodega</th>
                  <th>Disponible</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 8).map((row) => (
                  <tr key={`${row.line}:${row.skuKey}`}>
                    <th scope="row">{row.sku}</th>
                    <td>{row.name || "—"}</td>
                    <td>{row.warehouse || "—"}</td>
                    <td>{count(row.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.errors.length > 0 && (
            <ul className={r.errors}>
              {parsed.errors.slice(0, 20).map((issue) => (
                <li key={`${issue.line}:${issue.message}`}>
                  Línea {issue.line}: {issue.message}
                </li>
              ))}
              {parsed.errors.length > 20 && (
                <li>y {count(parsed.errors.length - 20)} más</li>
              )}
            </ul>
          )}
          {match.unmatched.length > 0 && (
            <details className={r.rules}>
              <summary>
                {count(match.unmatched.length)} SKU sin coincidencia en el
                catálogo
              </summary>
              <p className={r.caption}>
                {match.unmatched
                  .slice(0, 100)
                  .map((item) => item.sku)
                  .join(", ")}
                {match.unmatched.length > 100 ? "…" : ""}
              </p>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={submit} disabled={busy}>
              {busy ? "Guardando…" : "Guardar inventario de hoy"}
            </button>
            <button onClick={reset} disabled={busy}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
