import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  identity: {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  } as {
    id: number;
    nombre: string;
    permisos: string[];
    tiendas: string[];
  },
  rpc: vi.fn(),
  inputs: vi.fn(),
  snapshots: [] as Array<Record<string, unknown>>,
  items: {} as Record<string, Array<Record<string, unknown>>>,
  error: null as null | { code?: string; message: string },
  /** Simulates the database before 20261105120400 (no backorder/incoming columns). */
  oldSchema: false,
  selects: [] as string[],
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/marketing-data", () => ({ getMarketingInputs: mocks.inputs }));
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let columns = "";
      const query = {
        select: (value: string) => {
          columns = value;
          mocks.selects.push(`${table}:${value}`);
          return query;
        },
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        order: () => query,
        limit: () => query,
        range: () => query,
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(
            mocks.error
              ? { data: null, error: mocks.error }
              : mocks.oldSchema && /backorder|incoming/.test(columns)
                ? {
                    data: null,
                    error: { code: "42703", message: "private column detail" },
                  }
              : table === "marketing_inventory_snapshots"
                ? { data: mocks.snapshots, error: null }
                : {
                    data: mocks.items[String(filters.snapshot_id)] ?? [],
                    error: null,
                  },
          ).then(resolve, reject),
      };
      return query;
    },
  }),
}));
import { GET, POST } from "../app/api/marketing/inventory/route";

const request = (body?: unknown, store = "mireva-cr") =>
  new NextRequest(
    `https://kairo.test/api/marketing/inventory?store=${store}`,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
const csv =
  "SKU,Name,Available\nHER.LOSS,Her Loss,400\nNUEVO,Nuevo,3\nX,,abc\n";

beforeEach(() => {
  mocks.identity = {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  mocks.rpc.mockReset().mockResolvedValue({ data: "snap-1", error: null });
  mocks.inputs.mockReset().mockResolvedValue({
    summary: {
      catalog: [{ key: "sku:her.loss", sku: "HER.LOSS", name: "Her Loss" }],
    },
  });
  mocks.snapshots = [];
  mocks.items = {};
  mocks.error = null;
  mocks.oldSchema = false;
  mocks.selects = [];
});

describe("inventory upload route", () => {
  it("requires Marketing, Costa Rica and edit rights", async () => {
    expect((await GET(request(undefined, "mireva-hn"))).status).toBe(403);
    mocks.identity.permisos = [];
    expect((await GET(request())).status).toBe(403);
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    expect((await GET(request())).status).toBe(200);
    expect((await POST(request({ fileName: "a.csv", csv }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns 400 for a fatal file and never calls the RPC", async () => {
    const result = await POST(
      request({ fileName: "a.csv", csv: "Nombre,Disponible\nA,1" }),
    );
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain("columna de SKU");
    expect((await POST(request({ fileName: 5, csv }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("previews with dryRun without saving", async () => {
    const result = await POST(
      request({ fileName: "product_table.csv", csv, dryRun: true }),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toMatchObject({
      dryRun: true,
      rows: 2,
      skus: 2,
      errors: 1,
      matched: 1,
      unmatched: 1,
      unmatchedSkus: [{ sku: "NUEVO", name: "Nuevo" }],
      availableFrom: "available",
      errorList: [{ line: 4, message: "Disponible vacío o no es un número" }],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("saves the server-parsed snapshot for today's CR date with the audit author", async () => {
    const result = await POST(request({ fileName: "product_table.csv", csv }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      saved: true,
      rows: 2,
      errors: 1,
      unmatched: 1,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "marketing_replace_inventory_snapshot",
      expect.objectContaining({
        p_store: 1,
        p_date: expect.stringMatching(/^20\d{2}-\d{2}-\d{2}$/),
        p_meta: expect.objectContaining({
          uploaded_by: "7:Ana",
          error_count: 1,
          unmatched_count: 1,
          available_column: "Available",
        }),
        p_items: [
          expect.objectContaining({ sku: "HER.LOSS", available: 400 }),
          expect.objectContaining({ sku: "NUEVO", available: 3 }),
        ],
      }),
    );
  });

  it("saves without the catalog check when the catalog is slow", async () => {
    vi.useFakeTimers();
    try {
      mocks.inputs.mockReturnValue(new Promise(() => {}));
      const pending = POST(request({ fileName: "product_table.csv", csv }));
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        saved: true,
        unmatched: null,
        catalogChecked: false,
      });
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a fully quoted CSV close to 1 MB once JSON-escaped", async () => {
    // 19 000 rows (limit 20 000), every field quoted, quotes inside the
    // name and CRLF: about 38% longer once JSON-escaped.
    const line = '"S000000","Gel de magnesio ""A"" ""B"" ""C""","15"\r\n';
    const big =
      '"SKU","Name","Available"\r\n' +
      Array.from({ length: 19_000 }, (_, i) =>
        line.replace("000000", String(i).padStart(6, "0")),
      ).join("");
    expect(new TextEncoder().encode(big).length).toBeLessThanOrEqual(1_000_000);
    expect(
      JSON.stringify({ fileName: "a.csv", csv: big }).length,
    ).toBeGreaterThan(1_200_000);
    const result = await POST(
      request({ fileName: "a.csv", csv: big, dryRun: true }),
    );
    expect(result.status).toBe(200);
  });

  it("reports a pending migration without leaking database details", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "private detail" },
    });
    const saved = await POST(request({ fileName: "a.csv", csv }));
    expect(saved.status).toBe(503);
    const body = JSON.stringify(await saved.json());
    expect(body).toContain("Pendiente");
    expect(body).not.toContain("private detail");
    mocks.error = { code: "42P01", message: "private detail" };
    const read = await GET(request());
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      status: "pending_migration",
      latest: null,
    });
  });

  it("returns snapshot metadata and restocked SKUs, never the items", async () => {
    mocks.snapshots = [
      {
        id: "s2",
        snapshot_date: "2026-11-05",
        source: "csv",
        file_name: "b.csv",
        uploaded_at: "2026-11-05T14:10:00Z",
        uploaded_by: "7:Ana",
        row_count: 2,
        error_count: 0,
        available_column: "Available",
      },
      {
        id: "s1",
        snapshot_date: "2026-11-04",
        source: "csv",
        file_name: "a.csv",
        uploaded_at: "2026-11-04T14:10:00Z",
        uploaded_by: "8:Luis",
        row_count: 2,
        error_count: 0,
        available_column: "Available",
      },
    ];
    mocks.items = {
      s2: [
        {
          sku: "HER.LOSS",
          warehouses: ["Boxful"],
          available: 400,
          on_hand: null,
          allocated: null,
        },
        {
          sku: "TURK",
          warehouses: [],
          available: 93,
          on_hand: 93,
          allocated: 0,
        },
      ],
      s1: [
        {
          sku: "HER.LOSS",
          warehouses: ["Boxful"],
          available: 100,
          on_hand: null,
          allocated: null,
        },
        {
          sku: "TURK",
          warehouses: [],
          available: 100,
          on_hand: 100,
          allocated: 0,
        },
      ],
    };
    const result = await GET(request());
    const body = await result.json();
    expect(body).toMatchObject({
      status: "ok",
      latest: { snapshotDate: "2026-11-05", uploadedBy: "Ana", skus: 2 },
      previous: { snapshotDate: "2026-11-04", uploadedBy: "Luis" },
      restocked: [{ sku: "HER.LOSS", delta: 300 }],
    });
    expect(body.latest.stock).toBeUndefined();
  });

  it("previews and saves the optional Backorder and Incoming columns", async () => {
    const extra =
      "SKU,Name,Available,Backorder,Incoming\nHER.LOSS,Her Loss,0,85,\nNUEVO,Nuevo,3,,40\n";
    const preview = await POST(
      request({ fileName: "product_table.csv", csv: extra, dryRun: true }),
    );
    expect(await preview.json()).toMatchObject({
      columns: { backorder: "Backorder", incoming: "Incoming" },
    });
    const saved = await POST(
      request({ fileName: "product_table.csv", csv: extra }),
    );
    expect(saved.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "marketing_replace_inventory_snapshot",
      expect.objectContaining({
        p_meta: expect.objectContaining({
          backorder_column: "Backorder",
          incoming_column: "Incoming",
        }),
        p_items: [
          expect.objectContaining({
            sku: "HER.LOSS",
            backorder: 85,
            incoming: null,
          }),
          expect.objectContaining({ sku: "NUEVO", backorder: null, incoming: 40 }),
        ],
      }),
    );
  });

  it("reads the extra columns and falls back to the old schema without them", async () => {
    mocks.snapshots = [
      {
        id: "s2",
        snapshot_date: "2026-11-05",
        source: "csv",
        file_name: "b.csv",
        uploaded_at: "2026-11-05T14:10:00Z",
        uploaded_by: "7:Ana",
        row_count: 1,
        error_count: 0,
        available_column: "Available",
        backorder_column: "Backorder",
        incoming_column: "",
      },
    ];
    mocks.items = {
      s2: [
        {
          sku: "HER.LOSS",
          warehouses: [],
          available: 0,
          on_hand: null,
          allocated: null,
          backorder: 85,
          incoming: null,
        },
      ],
    };
    const fresh = await (await GET(request())).json();
    expect(fresh.latest).toMatchObject({
      backorderColumn: "Backorder",
      incomingColumn: "",
    });
    expect(mocks.selects.some((q) => q.includes("backorder,incoming"))).toBe(
      true,
    );
    mocks.oldSchema = true;
    mocks.selects = [];
    // The old schema has no header columns either.
    delete mocks.snapshots[0].backorder_column;
    delete mocks.snapshots[0].incoming_column;
    const old = await GET(request());
    expect(old.status).toBe(200);
    const body = await old.json();
    expect(body).toMatchObject({
      status: "ok",
      latest: { backorderColumn: "", incomingColumn: "" },
    });
    expect(JSON.stringify(body)).not.toContain("private column detail");
    // Retried with the old column list (the snapshot read without extras).
    expect(
      mocks.selects.filter((q) => q.startsWith("marketing_inventory_snapshots"))
        .length,
    ).toBe(2);
  });
});
