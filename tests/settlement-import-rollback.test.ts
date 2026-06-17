import { describe, expect, it, vi } from "vitest";
import {
  persistSettlementRowsWithRollback,
  type SettlementPersistDeps,
} from "../lib/finance-import";
import type { SettlementRow } from "../lib/finance-types";

const makeRow = (dedup_key: string) =>
  ({ dedup_key }) as unknown as Omit<SettlementRow, "id" | "created_at">;
const makePreimage = (id: number, dedup_key: string) =>
  ({ id, dedup_key, import_id: 5 }) as unknown as SettlementRow;

describe("persistSettlementRowsWithRollback", () => {
  it("éxito: upserta por lotes y no dispara rollback", async () => {
    const deps: SettlementPersistDeps = {
      listByDedupKeys: vi.fn().mockResolvedValue([]),
      upsertByDedup: vi.fn().mockResolvedValue(undefined),
      restoreById: vi.fn().mockResolvedValue(undefined),
      deleteImport: vi.fn().mockResolvedValue(undefined),
    };
    await persistSettlementRowsWithRollback({
      rows: [makeRow("G1"), makeRow("G2")],
      storeId: 1,
      importId: 99,
      batchSize: 250,
      concurrency: 4,
      deps,
    });
    expect(deps.upsertByDedup).toHaveBeenCalledTimes(1); // 2 filas < batchSize ⇒ 1 lote
    expect(deps.restoreById).not.toHaveBeenCalled();
    expect(deps.deleteImport).not.toHaveBeenCalled();
  });

  it("fallo con colisión cross-archivo: restaura las pre-imágenes ANTES de borrar el import nuevo", async () => {
    const preimage = makePreimage(7, "G1");
    const deps: SettlementPersistDeps = {
      listByDedupKeys: vi.fn().mockResolvedValue([preimage]),
      upsertByDedup: vi.fn().mockRejectedValue(new Error("boom")),
      restoreById: vi.fn().mockResolvedValue(undefined),
      deleteImport: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      persistSettlementRowsWithRollback({
        rows: [makeRow("G1")],
        storeId: 1,
        importId: 99,
        batchSize: 250,
        concurrency: 4,
        deps,
      })
    ).rejects.toThrow(/import revertido/i);
    // La fila del otro archivo se restaura (no se pierde por el cascade del delete).
    expect(deps.restoreById).toHaveBeenCalledWith([preimage]);
    expect(deps.deleteImport).toHaveBeenCalledWith(99, 1);
  });

  it("fallo sin colisiones: borra el import nuevo y no restaura nada", async () => {
    const deps: SettlementPersistDeps = {
      listByDedupKeys: vi.fn().mockResolvedValue([]),
      upsertByDedup: vi.fn().mockRejectedValue(new Error("boom")),
      restoreById: vi.fn().mockResolvedValue(undefined),
      deleteImport: vi.fn().mockResolvedValue(undefined),
    };
    await expect(
      persistSettlementRowsWithRollback({
        rows: [makeRow("G1")],
        storeId: 1,
        importId: 99,
        batchSize: 250,
        concurrency: 4,
        deps,
      })
    ).rejects.toThrow(/import revertido/i);
    expect(deps.restoreById).not.toHaveBeenCalled();
    expect(deps.deleteImport).toHaveBeenCalledWith(99, 1);
  });
});
