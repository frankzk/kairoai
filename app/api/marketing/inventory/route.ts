// Inventario de Marketing desde el CSV product_table (ShipHero/Boxful).
// GET: última foto y la anterior (solo datos de la subida) + reposiciones.
// POST: sube el archivo; el servidor lo vuelve a leer (nunca confía en la
// vista previa del navegador). Con dryRun solo devuelve el resumen.
import { NextRequest } from "next/server";
import {
  canEditMarketing,
  marketingAccess,
  marketingAuthor,
  marketingReply,
  readJsonBody,
} from "@/lib/marketing-access";
import { getMarketingInputs } from "@/lib/marketing-data";
import { marketingDate, presetPeriod } from "@/lib/marketing-dates";
import {
  INVENTORY_CSV_MAX_BYTES,
  matchInventoryToCatalog,
  parseInventoryCsv,
} from "@/lib/marketing-inventory-csv";
import {
  InventoryStorageError,
  readInventorySnapshots,
  restockedSkus,
  saveInventorySnapshot,
  type InventorySnapshot,
} from "@/lib/marketing-inventory-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// JSON escaping (quotes, CR/LF) can double a CSV of up to 1 MB; the CSV
// itself is checked against INVENTORY_CSV_MAX_BYTES below.
const MAX_BODY_CHARS = 2 * INVENTORY_CSV_MAX_BYTES + 10_000;
/** The catalog check only counts unmatched SKUs: past this it is skipped. */
const CATALOG_TIMEOUT_MS = 15_000;
const PENDING = "Pendiente: aplicar migración del inventario.";

const meta = (snapshot: InventorySnapshot | null) =>
  snapshot
    ? {
        snapshotDate: snapshot.snapshotDate,
        fileName: snapshot.fileName,
        uploadedAt: snapshot.uploadedAt,
        uploadedBy: snapshot.uploadedBy,
        rowCount: snapshot.rowCount,
        errorCount: snapshot.errorCount,
        availableColumn: snapshot.availableColumn,
        backorderColumn: snapshot.backorderColumn,
        incomingColumn: snapshot.incomingColumn,
        skus: snapshot.stock.length,
      }
    : null;

export async function GET(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!allowed)
    return marketingReply(
      { error: "Se requiere Marketing y acceso a Mireva Costa Rica." },
      403,
    );
  try {
    const { latest, previous } = await readInventorySnapshots(allowed.store.id);
    return marketingReply({
      status: "ok",
      today: marketingDate(),
      latest: meta(latest),
      previous: meta(previous),
      restocked: latest
        ? restockedSkus(latest.stock, previous?.stock ?? null)
        : [],
    });
  } catch (error) {
    if (error instanceof InventoryStorageError && error.pendingMigration)
      return marketingReply({
        status: "pending_migration",
        message: PENDING,
        today: marketingDate(),
        latest: null,
        previous: null,
        restocked: [],
      });
    return marketingReply(
      { error: "No se pudo consultar el inventario guardado." },
      503,
    );
  }
}

export async function POST(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!canEditMarketing(allowed))
    return marketingReply(
      { error: "No tienes permiso para modificar Marketing." },
      403,
    );
  const read = await readJsonBody(req, MAX_BODY_CHARS);
  if ("error" in read) return read.error;
  const { fileName, csv, dryRun } = read.body;
  if (
    typeof fileName !== "string" ||
    fileName.length > 200 ||
    typeof csv !== "string" ||
    (dryRun !== undefined && typeof dryRun !== "boolean")
  )
    return marketingReply(
      { error: "Envía el nombre del archivo y su contenido CSV." },
      400,
    );
  if (new TextEncoder().encode(csv).length > INVENTORY_CSV_MAX_BYTES)
    return marketingReply({ error: "El archivo pesa más de 1 MB." }, 400);
  const parsed = parseInventoryCsv(csv);
  if (parsed.fatal) return marketingReply({ error: parsed.fatal }, 400);
  if (!parsed.stock.length)
    return marketingReply(
      { error: "El archivo no tiene filas válidas de inventario." },
      400,
    );
  // The catalog only counts unmatched SKUs; a slow catalog must not block the
  // upload, so after CATALOG_TIMEOUT_MS it is skipped (catalogChecked: false).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const catalog = await Promise.race([
    getMarketingInputs(allowed.store, presetPeriod("today"))
      .then((input) => input.summary.catalog)
      .catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), CATALOG_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const match = catalog ? matchInventoryToCatalog(parsed.stock, catalog) : null;
  const snapshotDate = marketingDate();
  const summary = {
    snapshotDate,
    rows: parsed.rows.length,
    skus: parsed.stock.length,
    errors: parsed.errors.length,
    unmatched: match ? match.unmatched.length : null,
    catalogChecked: Boolean(match),
  };
  if (dryRun)
    return marketingReply({
      dryRun: true,
      ...summary,
      matched: match?.matched ?? null,
      catalogWithoutStock: match?.catalogWithoutStock ?? null,
      availableFrom: parsed.columns.availableFrom,
      // Includes the optional extras: columns.backorder / columns.incoming (header or null).
      columns: parsed.columns,
      errorList: parsed.errors.slice(0, 50),
      unmatchedSkus: match?.unmatched.slice(0, 100) ?? [],
    });
  try {
    await saveInventorySnapshot(allowed.store.id, {
      snapshotDate,
      fileName: fileName.replace(/[\u0000-\u001f\u007f]/g, "").trim(),
      parsed,
      unmatched: match?.unmatched.length ?? 0,
      uploadedBy: marketingAuthor(allowed.actor),
    });
    return marketingReply({ saved: true, ...summary });
  } catch (error) {
    return marketingReply(
      {
        error:
          error instanceof InventoryStorageError && error.pendingMigration
            ? PENDING
            : "No se pudo guardar el inventario. Vuelve a intentarlo.",
      },
      503,
    );
  }
}
