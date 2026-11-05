// Fotos diarias del inventario de Marketing (CSV product_table). Solo
// servidor. Tablas en supabase/migrations/20261105120000_marketing_inventory_snapshots.sql.
import { getDB } from "./db";
import {
  inventoryWarehouses,
  type InventoryCsvResult,
} from "./marketing-inventory-csv";
import type { MarketingStock } from "./marketing-source-types";

export interface InventorySnapshot {
  id: string;
  snapshotDate: string;
  source: "csv" | "shiphero";
  fileName: string;
  uploadedAt: string;
  /** Name only (`id:nombre` is stored; the id never leaves the server). */
  uploadedBy: string;
  rowCount: number;
  errorCount: number;
  availableColumn: string;
  stock: MarketingStock[];
}

/** Friendly error: the DB detail stays on the server. */
export class InventoryStorageError extends Error {
  constructor(readonly pendingMigration = false) {
    super(
      pendingMigration
        ? "Pendiente: aplicar migración del inventario."
        : "No se pudo consultar el inventario guardado.",
    );
    this.name = "InventoryStorageError";
  }
}

/** PostgREST/Postgres "relation or function does not exist" (migration not applied). */
export const isMissingRelation = (
  error: { code?: string } | null | undefined,
) => ["42P01", "42883", "PGRST202", "PGRST205"].includes(String(error?.code));

export const displayUploader = (value: string) => {
  const index = value.indexOf(":");
  return (
    index >= 0 && /^\d+$/.test(value.slice(0, index))
      ? value.slice(index + 1)
      : value
  ).trim();
};

export async function saveInventorySnapshot(
  storeId: number,
  input: {
    snapshotDate: string;
    fileName: string;
    parsed: InventoryCsvResult;
    unmatched: number;
    uploadedBy: string;
  },
): Promise<{ id: string }> {
  if (input.parsed.fatal) throw new Error("Inventario inválido");
  const warehouses = inventoryWarehouses(input.parsed.rows);
  const items = input.parsed.stock.map((entry) => {
    const key = entry.sku.trim().toLowerCase();
    return {
      sku: entry.sku.trim(),
      name: entry.name,
      warehouses: warehouses.get(key) ?? [],
      available: entry.available,
      on_hand: input.parsed.columns.onHand ? entry.onHand : null,
      allocated: input.parsed.columns.allocated ? entry.allocated : null,
    };
  });
  const { data, error } = await getDB().rpc(
    "marketing_replace_inventory_snapshot",
    {
      p_store: storeId,
      p_date: input.snapshotDate,
      p_meta: {
        file_name: input.fileName.slice(0, 200),
        error_count: input.parsed.errors.length,
        unmatched_count: input.unmatched,
        available_column: input.parsed.columns.available.slice(0, 60),
        uploaded_by: input.uploadedBy.slice(0, 200),
      },
      p_items: items,
    },
  );
  if (error) throw new InventoryStorageError(isMissingRelation(error));
  if (typeof data !== "string" || !data) throw new InventoryStorageError();
  return { id: data };
}

type SnapshotRow = {
  id: string;
  snapshot_date: string;
  source: "csv" | "shiphero";
  file_name: string;
  uploaded_at: string;
  uploaded_by: string;
  row_count: number;
  error_count: number;
  available_column: string;
};

async function readItems(snapshotId: string): Promise<MarketingStock[]> {
  const stock: MarketingStock[] = [];
  for (let page = 0; page < 25; page++) {
    const { data, error } = await getDB()
      .from("marketing_inventory_items")
      .select("sku,warehouses,available,on_hand,allocated")
      .eq("snapshot_id", snapshotId)
      .order("sku_key")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new InventoryStorageError(isMissingRelation(error));
    const rows = (data ?? []) as Array<{
      sku: string;
      warehouses: string[] | null;
      available: number | string;
      on_hand: number | string | null;
      allocated: number | string | null;
    }>;
    for (const row of rows) {
      const available = Number(row.available);
      const list = row.warehouses ?? [];
      stock.push({
        sku: row.sku,
        warehouseId: list.length > 1 ? "varias" : list[0] || "csv",
        available,
        onHand: row.on_hand == null ? available : Number(row.on_hand),
        allocated: row.allocated == null ? 0 : Number(row.allocated),
      });
    }
    if (rows.length < 1000) return stock;
  }
  throw new InventoryStorageError();
}

const snapshotOf = (
  row: SnapshotRow,
  stock: MarketingStock[],
): InventorySnapshot => ({
  id: row.id,
  snapshotDate: String(row.snapshot_date).slice(0, 10),
  source: row.source,
  fileName: row.file_name,
  uploadedAt: new Date(row.uploaded_at).toISOString(),
  uploadedBy: displayUploader(row.uploaded_by),
  rowCount: Number(row.row_count),
  errorCount: Number(row.error_count),
  availableColumn: row.available_column,
  stock,
});

/** Latest CSV snapshot and the one of the previous day with data. */
export async function readInventorySnapshots(
  storeId: number,
  options: { items?: boolean } = {},
): Promise<{
  latest: InventorySnapshot | null;
  previous: InventorySnapshot | null;
}> {
  const { data, error } = await getDB()
    .from("marketing_inventory_snapshots")
    .select(
      "id,snapshot_date,source,file_name,uploaded_at,uploaded_by,row_count,error_count,available_column",
    )
    .eq("store_id", storeId)
    .eq("source", "csv")
    .order("snapshot_date", { ascending: false })
    .limit(2);
  if (error) throw new InventoryStorageError(isMissingRelation(error));
  const rows = (data ?? []) as SnapshotRow[];
  const withItems = options.items !== false;
  const [latest, previous] = await Promise.all(
    [rows[0], rows[1]].map(async (row) =>
      row ? snapshotOf(row, withItems ? await readItems(row.id) : []) : null,
    ),
  );
  return { latest, previous };
}

/** SKU (lowercase) → available delta between snapshots (> 0 = entró reposición). */
export function restockedSkus(
  latest: MarketingStock[],
  previous: MarketingStock[] | null,
): Array<{ sku: string; delta: number }> {
  if (!previous) return [];
  const before = new Map(
    previous.map((item) => [item.sku.trim().toLowerCase(), item.available]),
  );
  return latest
    .map((item) => ({
      sku: item.sku,
      delta:
        Math.round(
          (item.available - (before.get(item.sku.trim().toLowerCase()) ?? 0)) *
            1000,
        ) / 1000,
    }))
    .filter((item) => item.delta > 0)
    .sort((a, b) => b.delta - a.delta);
}
