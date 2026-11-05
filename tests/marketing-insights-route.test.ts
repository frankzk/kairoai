import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  identity: {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  } as { id: number; nombre: string; permisos: string[]; tiendas: string[] },
  listRows: vi.fn(),
  repeat: vi.fn(),
  dataset: vi.fn(),
  catalog: vi.fn(),
  statuses: vi.fn(),
  ageGender: vi.fn(),
  settings: vi.fn(),
  tiktok: { data: [] as unknown[], error: null as null | { message: string } },
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/marketing-order-facts-db", () => ({
  listOrderFactRows: mocks.listRows,
  readRepeatOrders: mocks.repeat,
}));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
}));
vi.mock("@/lib/finance-orders", () => ({
  buildFinanceControlCenter: () => ({ orders: [] }),
}));
vi.mock("@/lib/marketing-product-groups-db", () => ({
  readMarketingProductCatalog: mocks.catalog,
}));
vi.mock("@/lib/marketing-meta-accounts", () => ({
  readMetaAccountStatuses: mocks.statuses,
  readMetaAgeGender: mocks.ageGender,
}));
vi.mock("@/lib/marketing-charlie-settings", () => ({
  readCharlieSettings: mocks.settings,
}));
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: () => {
      // Newest first (as ordered by fecha desc), minus "not in" advertisers.
      let skip: string[] = [];
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        not: (column: string, op: string, value: unknown) => {
          if (column === "advertiser_id" && op === "in")
            skip = String(value).replace(/[()"]/g, "").split(",");
          return query;
        },
        limit: (n: number) =>
          Promise.resolve(
            mocks.tiktok.error
              ? { data: null, error: mocks.tiktok.error }
              : {
                  data: ((mocks.tiktok.data ?? []) as Array<{
                    advertiser_id?: unknown;
                  }>)
                    .filter((row) => !skip.includes(String(row.advertiser_id)))
                    .slice(0, n),
                  error: null,
                },
          ),
      };
      return query;
    },
  }),
}));
import { GET } from "../app/api/marketing/insights/route";
import { clearInsightCache } from "../lib/marketing-insights-server";
import { marketingDate, shiftDate } from "../lib/marketing-dates";

const today = marketingDate();
const request = (query: string, store = "mireva-cr") =>
  new NextRequest(
    `https://kairo.test/api/marketing/insights?store=${store}&${query}`,
  );
const fx = {
  rate: 517.3,
  date: today,
  source: "hacienda",
  checkedAt: new Date().toISOString(),
  message: "",
  pen: { rate: 3.52, date: today, source: "bcrp" },
};

beforeEach(() => {
  clearInsightCache();
  mocks.identity = {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  mocks.listRows.mockReset().mockResolvedValue({
    rows: [
      {
        created_at: new Date().toISOString(),
        status: "Cancelado",
        cancelled_at: new Date().toISOString(),
        reason: "Cliente canceló, tel 8888-1234",
        sales_channel: "whatsapp",
        labels: [],
        creator: null,
        department: "Heredia",
        city: null,
        shopify_number: null,
        items: [{ product_name: "Her Loss" }],
        product_name: null,
      },
    ],
    truncated: false,
  });
  mocks.repeat
    .mockReset()
    .mockResolvedValue({ status: "pending_migration", days: [] });
  mocks.dataset.mockReset().mockResolvedValue({
    rows: [],
    matchedSettlementRows: [],
    imports: [],
    settlementTraceByKey: new Map(),
  });
  mocks.catalog.mockReset().mockRejectedValue(new Error("catalog down"));
  mocks.statuses.mockReset().mockResolvedValue([
    {
      accountId: "111",
      name: "CR3",
      state: "activa",
      statusCode: 1,
      disableReason: null,
      currency: "USD",
      amountSpent: 10,
      spendCap: null,
    },
  ]);
  mocks.ageGender
    .mockReset()
    .mockResolvedValue({ rows: [], failed: ["222"], configured: true });
  mocks.settings.mockReset().mockResolvedValue({ fx });
  mocks.tiktok = {
    data: [
      {
        advertiser_id: "9",
        advertiser_name: "Mireva TikTok",
        fecha: shiftDate(today, -1),
        updated_at: "2026-11-05T14:45:00Z",
      },
      {
        advertiser_id: "9",
        advertiser_name: "Mireva TikTok",
        fecha: shiftDate(today, -2),
        updated_at: "2026-11-04T14:45:00Z",
      },
    ],
    error: null,
  };
});

describe("marketing insights route", () => {
  it("requires Marketing, Costa Rica and a known section", async () => {
    expect((await GET(request("section=pedidos", "mireva-hn"))).status).toBe(
      403,
    );
    mocks.identity.permisos = [];
    expect((await GET(request("section=pedidos"))).status).toBe(403);
    mocks.identity.permisos = ["marketing"];
    expect((await GET(request("section=otra"))).status).toBe(400);
    expect((await GET(request(""))).status).toBe(400);
  });

  it("rejects long or future ranges", async () => {
    expect(
      (
        await GET(
          request(`section=pedidos&from=${shiftDate(today, -100)}&to=${today}`),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          request(`section=pedidos&from=${today}&to=${shiftDate(today, 1)}`),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await GET(
          request(
            `section=segmentacion&from=${shiftDate(today, -40)}&to=${shiftDate(today, -1)}`,
          ),
        )
      ).status,
    ).toBe(400);
    // Age and gender only up to yesterday (complete days).
    expect(
      (await GET(request(`section=segmentacion&from=${today}&to=${today}`)))
        .status,
    ).toBe(400);
    expect(mocks.listRows).not.toHaveBeenCalled();
    expect(mocks.ageGender).not.toHaveBeenCalled();
  });

  it("returns anonymous facts with at least 5 weeks loaded and a pending repeat RPC", async () => {
    const response = await GET(request("section=pedidos"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      from: shiftDate(today, -6),
      to: today,
      loadedFrom: shiftDate(today, -35),
      repeat: { status: "pending_migration", days: [] },
      truncated: false,
      products: ["Her Loss"],
      facts: [[today, 1, "cliente_cancelo", "bot", "Heredia", [0]]],
    });
    expect(JSON.stringify(body)).not.toContain("8888");
    const [storeId, fromIso, toIso] = mocks.listRows.mock.calls[0];
    expect(storeId).toBe(1);
    expect(fromIso).toBe(
      new Date(Date.parse(`${shiftDate(today, -35)}T06:00:00Z`)).toISOString(),
    );
    expect(toIso).toBe(
      new Date(Date.parse(`${shiftDate(today, 1)}T06:00:00Z`)).toISOString(),
    );
  });

  it("serves the cache and refreshes on request", async () => {
    await GET(request("section=pedidos"));
    await GET(request("section=pedidos"));
    expect(mocks.listRows).toHaveBeenCalledTimes(1);
    await GET(request("section=pedidos&refresh=1"));
    expect(mocks.listRows).toHaveBeenCalledTimes(2);
    // Another period is another entry.
    await GET(
      request(`section=pedidos&from=${shiftDate(today, -13)}&to=${today}`),
    );
    expect(mocks.listRows).toHaveBeenCalledTimes(3);
  });

  it("answers a friendly 503 on a provider error and does not cache it", async () => {
    mocks.listRows.mockRejectedValueOnce(new Error("private database detail"));
    const failed = await GET(request("section=pedidos"));
    expect(failed.status).toBe(503);
    const text = JSON.stringify(await failed.json());
    expect(text).toContain("No se pudieron leer los pedidos de iComfly");
    expect(text).not.toContain("private");
    expect((await GET(request("section=pedidos"))).status).toBe(200);
  });

  it("builds product insights without the catalog (plain keys)", async () => {
    const response = await GET(request("section=productos"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      today,
      variantAware: false,
      units: {},
      waiting: {},
    });
    expect(mocks.dataset).toHaveBeenCalledTimes(1);
  });

  it("reports account status, the TikTok feed and the applied rates", async () => {
    const body = await (await GET(request("section=cuentas"))).json();
    expect(body).toMatchObject({
      meta: [{ accountId: "111", state: "activa" }],
      metaError: false,
      tiktok: [
        {
          advertiserId: "9",
          name: "Mireva TikTok",
          lastDate: shiftDate(today, -1),
          updatedAt: "2026-11-05T14:45:00.000Z",
        },
      ],
      tiktokError: false,
      fx: { rate: 517.3, pen: { rate: 3.52 } },
    });
    clearInsightCache();
    mocks.statuses.mockRejectedValue(new Error("private"));
    mocks.tiktok.error = { message: "private" };
    const degraded = await (await GET(request("section=cuentas"))).json();
    expect(degraded).toMatchObject({
      meta: null,
      metaError: true,
      tiktok: [],
      tiktokError: true,
    });
  });

  it("keeps an advertiser whose feed stopped behind 1,000 newer rows", async () => {
    mocks.tiktok.data = [
      ...Array.from({ length: 1000 }, (_, i) => ({
        advertiser_id: "9",
        advertiser_name: "Mireva TikTok",
        fecha: shiftDate(today, -1 - Math.floor(i / 30)),
        updated_at: "2026-11-05T14:45:00Z",
      })),
      {
        advertiser_id: "10",
        advertiser_name: "Mireva TikTok 2",
        fecha: "2026-10-01",
        updated_at: "2026-10-02T14:45:00Z",
      },
    ];
    const body = await (await GET(request("section=cuentas"))).json();
    expect(body.tiktok).toEqual([
      expect.objectContaining({ advertiserId: "9", lastDate: shiftDate(today, -1) }),
      expect.objectContaining({ advertiserId: "10", lastDate: "2026-10-01" }),
    ]);
  });

  it("loads age and gender for complete days only, listing failed accounts", async () => {
    const response = await GET(request("section=segmentacion"));
    expect(await response.json()).toEqual({
      from: shiftDate(today, -7),
      to: shiftDate(today, -1),
      rows: [],
      failed: ["222"],
      configured: true,
    });
    expect(mocks.ageGender).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      shiftDate(today, -7),
      shiftDate(today, -1),
    );
  });
});
