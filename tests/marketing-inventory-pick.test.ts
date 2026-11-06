import { describe, expect, it } from "vitest";
import { pickInventory } from "../lib/marketing-inventory-pick";
import type { MarketingInventory, MarketingSource } from "../lib/marketing-source-types";

const ready = (origin: "csv" | "shiphero", snapshotDate?: string): MarketingSource<MarketingInventory> => ({
  status: "ready",
  checkedAt: "2026-11-06T16:00:00Z",
  message: origin === "csv" ? "Inventario del archivo product_table del 6 nov." : "Inventario de ShipHero del 5 nov, 10:13.",
  data: { stock: [], origin, ...(snapshotDate ? { snapshotDate } : {}) },
});
const pending: MarketingSource<MarketingInventory> = { status: "pending", checkedAt: "x", message: "Pendiente de configurar acceso de lectura.", data: null };

describe("pickInventory", () => {
  it("keeps ShipHero over an older or same-day CSV", () => {
    const ship = ready("shiphero", "2026-11-06");
    expect(pickInventory(ship, ready("csv", "2026-11-05"))).toBe(ship);
    expect(pickInventory(ship, ready("csv", "2026-11-06"))).toBe(ship);
  });

  it("uses a strictly newer CSV (the sync is broken) and says so", () => {
    const picked = pickInventory(ready("shiphero", "2026-11-05"), ready("csv", "2026-11-06"));
    expect(picked.data?.origin).toBe("csv");
    expect(picked.message).toBe("Inventario del archivo product_table del 6 nov (más reciente que ShipHero).");
  });

  it("uses the CSV when ShipHero is pending, and the pending source when both are missing", () => {
    expect(pickInventory(pending, ready("csv", "2026-11-01")).data?.origin).toBe("csv");
    expect(pickInventory(pending, pending)).toBe(pending);
  });

  it("keeps the state of a pending Kairo connection on the CSV it falls back to", () => {
    const waiting = { ...pending, message: "ShipHero conectado. Falta elegir qué inventario leer.", connection: "needs_scope" as const };
    const picked = pickInventory(waiting, ready("csv", "2026-11-06"));
    expect(picked).toMatchObject({ data: { origin: "csv" }, connection: "needs_scope" });
    const newer = pickInventory({ ...ready("shiphero", "2026-11-05"), connection: "reconnect" }, ready("csv", "2026-11-06"));
    expect(newer).toMatchObject({ data: { origin: "csv" }, connection: "reconnect" });
  });

  it("a live static-env read (no snapshotDate) always wins, as before", () => {
    const live = ready("shiphero");
    expect(pickInventory(live, ready("csv", "2026-11-06"))).toBe(live);
  });
});
