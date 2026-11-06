// The sources route end to end for the inventory: Kairo connection snapshot →
// static SHIPHERO_CR_* → uploaded product_table CSV. ShipHero is never called
// live here (static env not set); the DB reads are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type {
  MarketingInventory,
  MarketingSource,
} from "../lib/marketing-source-types";
import type { InventorySnapshot } from "../lib/marketing-inventory-db";

const mocks = vi.hoisted(() => ({
  shiphero: null as unknown,
  shipheroFails: false,
  csv: { latest: null, previous: null } as {
    latest: unknown;
    previous: unknown;
  },
  csvFails: false,
}));

vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: () => ({ id: 1, code: "mireva-cr" }),
}));
vi.mock("@/lib/tiktok-diario", () => ({ leerCuentasTiktok: async () => [] }));
vi.mock("@/lib/marketing-origin-catalog", () => ({
  rememberOriginCatalog: async () => {},
}));
vi.mock("@/lib/shiphero-connection", () => ({
  readShipHeroInventory: async () => {
    if (mocks.shipheroFails) throw new Error("db down");
    return mocks.shiphero;
  },
}));
vi.mock("@/lib/marketing-inventory-db", () => ({
  readInventorySnapshots: async () => {
    if (mocks.csvFails) throw new Error("db down");
    return mocks.csv;
  },
}));

import { GET } from "../app/api/marketing/sources/route";

const fetcher = vi.fn();
const request = () =>
  new NextRequest(
    "https://kairo.test/api/marketing/sources?store=mireva-cr&month=2026-11&scope=basic",
  );
const ship = (
  snapshotDate: string,
  over: Partial<MarketingSource<MarketingInventory>> = {},
): MarketingSource<MarketingInventory> => ({
  status: "ready",
  checkedAt: `${snapshotDate}T12:13:00Z`,
  message: `Inventario de ShipHero del ${snapshotDate}.`,
  data: {
    stock: [{ sku: "SH1", warehouseId: "w", onHand: 1, available: 1, allocated: 0 }],
    origin: "shiphero",
    snapshotDate,
    previous: null,
  },
  ...over,
});
const csvSnapshot = (snapshotDate: string): InventorySnapshot => ({
  id: `csv-${snapshotDate}`,
  snapshotDate,
  source: "csv",
  fileName: "product_table.csv",
  uploadedAt: `${snapshotDate}T15:00:00.000Z`,
  uploadedBy: "Ana",
  rowCount: 1,
  errorCount: 0,
  availableColumn: "Available",
  backorderColumn: "",
  incomingColumn: "",
  stock: [{ sku: "CSV1", warehouseId: "csv", onHand: 2, available: 2, allocated: 0 }],
});

async function inventory() {
  const res = await GET(request());
  expect(res.status).toBe(200);
  return (await res.json()).shiphero as MarketingSource<MarketingInventory>;
}

beforeEach(() => {
  mocks.shiphero = null;
  mocks.shipheroFails = false;
  mocks.csv = { latest: null, previous: null };
  mocks.csvFails = false;
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  for (const key of [
    "SHIPHERO_CR_ACCESS_TOKEN",
    "SHIPHERO_CR_ACCOUNT_ID",
    "SHIPHERO_CR_WAREHOUSE_ID",
    "META_CR_ACCESS_TOKEN",
    "TIKTOK_CR_ACCESS_TOKEN",
  ])
    vi.stubEnv(key, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/marketing/sources: inventory", () => {
  it("a ready ShipHero snapshot with no CSV is served as is", async () => {
    mocks.shiphero = ship("2026-11-06");
    expect(await inventory()).toMatchObject({
      status: "ready",
      data: { origin: "shiphero", stock: [{ sku: "SH1" }] },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a pending connection with a CSV uses the CSV and keeps the connection state", async () => {
    mocks.shiphero = {
      status: "pending",
      checkedAt: "x",
      message: "ShipHero conectado. Falta elegir qué inventario leer.",
      data: null,
      connection: "needs_scope",
    };
    mocks.csv = { latest: csvSnapshot("2026-11-05"), previous: null };
    expect(await inventory()).toMatchObject({
      status: "ready",
      connection: "needs_scope",
      data: { origin: "csv", stock: [{ sku: "CSV1" }] },
    });
  });

  it("disconnected (no source from the connection): a same-day CSV is used", async () => {
    mocks.shiphero = null; // readShipHeroInventory gives null once disconnected
    mocks.csv = { latest: csvSnapshot("2026-11-06"), previous: null };
    const source = await inventory();
    expect(source).toMatchObject({ status: "ready", data: { origin: "csv" } });
    expect(source.connection).toBeUndefined();
  });

  it("a ShipHero snapshot beats a same-day CSV and loses to a newer one", async () => {
    mocks.shiphero = ship("2026-11-06");
    mocks.csv = { latest: csvSnapshot("2026-11-06"), previous: null };
    expect((await inventory()).data?.origin).toBe("shiphero");
    mocks.shiphero = ship("2026-11-05", { connection: "reconnect" });
    expect(await inventory()).toMatchObject({
      data: { origin: "csv" },
      connection: "reconnect",
      message: "Inventario del archivo product_table del 6 nov (más reciente que ShipHero).",
    });
  });

  it("a CSV read error keeps the saved ShipHero snapshot", async () => {
    mocks.shiphero = ship("2026-11-06");
    mocks.csvFails = true;
    expect((await inventory()).data?.origin).toBe("shiphero");
  });

  it("nothing at all: pending, and a failed connection read falls back to the CSV", async () => {
    expect((await inventory()).status).toBe("pending");
    mocks.shipheroFails = true;
    mocks.csv = { latest: csvSnapshot("2026-11-04"), previous: null };
    expect((await inventory()).data?.origin).toBe("csv");
  });
});
