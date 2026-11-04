import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cumple, exigenciaDe } from "../lib/permisos";

const mocks = vi.hoisted(() => ({
  dataset: vi.fn(),
  expenses: vi.fn(),
  costs: vi.fn(),
  versions: vi.fn(),
  config: vi.fn(),
  origins: vi.fn(),
  storeAllowed: true,
}));
vi.mock("@/lib/marketing-attribution-db", () => ({
  listMarketingOrigins: mocks.origins,
}));
vi.mock("@/lib/marketing-charlie-settings", () => ({
  readCharlieConfig: mocks.config,
}));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) => {
    const code = params.get("store");
    return mocks.storeAllowed && ["mireva-cr", "mireva-hn"].includes(code || "")
      ? { id: code === "mireva-cr" ? 1 : 2, code }
      : null;
  },
}));
vi.mock("@/lib/finance", () => ({
  listExpenses: mocks.expenses,
  listProductCosts: mocks.costs,
  listProductCostVersions: mocks.versions,
}));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
  isOrdersDatasetUnavailableError: (error: unknown) =>
    error instanceof Error && error.name === "OrdersDatasetUnavailableError",
}));
import { GET } from "../app/api/marketing/summary/route";

const request = (query: string) =>
  new NextRequest(`http://localhost/api/marketing/summary?${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.storeAllowed = true;
  mocks.dataset.mockResolvedValue({
    rows: [],
    matchedSettlementRows: [],
    imports: [],
    settlementTraceByKey: new Map(),
  });
  mocks.origins.mockResolvedValue([]);
  mocks.expenses.mockResolvedValue([]);
  mocks.costs.mockResolvedValue([]);
  mocks.versions.mockResolvedValue([]);
  mocks.config.mockResolvedValue({
    crc_per_usd: null,
    rate_date: null,
    hero_product_keys: [],
  });
});

describe("marketing API isolation and availability", () => {
  it("serves operations and potential revenue from one dataset read without exposing raw inputs", async () => {
    const response = await GET(
      request(
        "store=mireva-cr&from=2026-11-01&to=2026-11-04&include_charlie=1",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.dataset).toHaveBeenCalledTimes(1);
    expect(mocks.costs).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body).toMatchObject({
      totals: { generated: 0 },
      charlieBusiness: { totalOrders: 0, basis: "created_potential" },
    });
    expect(body.charlieBusiness.days).toHaveLength(7);
    expect(body).not.toHaveProperty("orders");
    expect(body).not.toHaveProperty("phones");
  });
  it("preserves the operational summary if revenue configuration is unavailable", async () => {
    mocks.config.mockRejectedValue(new Error("private database failure"));
    const response = await GET(
      request("store=mireva-cr&month=2026-11&include_charlie=1"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.charlieBusiness).toBeNull();
    expect(body.charlieError).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("private database failure");
  });
  it("rejects missing, unsupported or unauthorized stores before reading data", async () => {
    for (const query of ["month=2026-10", "store=mireva-hn&month=2026-10"]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    mocks.storeAllowed = false;
    expect((await GET(request("store=mireva-cr&month=2026-10"))).status).toBe(
      400,
    );
    expect(mocks.dataset).not.toHaveBeenCalled();
  });

  it("rejects malformed calendar months without loading the dataset", async () => {
    for (const month of ["", "2026-13", "2026-1", "2026-10-01"]) {
      expect(
        (await GET(request(`store=mireva-cr&month=${month}`))).status,
      ).toBe(400);
    }
    expect(mocks.dataset).not.toHaveBeenCalled();
  });

  it("scopes every reader to Costa Rica and returns only aggregate data", async () => {
    const result = await GET(request("store=mireva-cr&month=2026-10"));
    expect(result.status).toBe(200);
    expect(mocks.expenses).toHaveBeenCalledWith("ads", 1);
    expect(mocks.costs).toHaveBeenCalledWith(1);
    expect(mocks.versions).toHaveBeenCalledWith(undefined, 1);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toMatchObject({
      store: "mireva-cr",
      currency: "CRC",
      totals: { generated: 0, registeredAdSpend: null },
    });
  });

  it("returns failure rather than fabricated zero metrics when the dataset is unavailable", async () => {
    const error = new Error("Dataset unavailable");
    error.name = "OrdersDatasetUnavailableError";
    mocks.dataset.mockRejectedValue(error);
    const response = await GET(request("store=mireva-cr&month=2026-10"));
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty("error");
  });

  it("requires marketing permission on both the page and API", () => {
    for (const route of [
      "/admin/marketing",
      "/api/marketing/summary",
      "/api/marketing/sources",
    ]) {
      expect(cumple(exigenciaDe(route), ["marketing"])).toBe(true);
      expect(cumple(exigenciaDe(route), ["finanzas"])).toBe(false);
      expect(cumple(exigenciaDe(route), ["pedidos"])).toBe(false);
      expect(cumple(exigenciaDe(route), ["leads"])).toBe(false);
    }
  });

  it("bounds a stalled reader and responds with a retryable error", async () => {
    vi.useFakeTimers();
    try {
      mocks.dataset.mockImplementation(() => new Promise(() => {}));
      const pending = GET(request("store=mireva-cr&month=2026-10"));
      await vi.advanceTimersByTimeAsync(45_001);
      const result = await pending;
      expect(result.status).toBe(503);
      expect(await result.json()).toHaveProperty("error");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Report summary UTM coverage", () => {
  it("reuses one canonical order snapshot for orders, revenue and attribution and keeps identities private", async () => {
    const response = await GET(
      request(
        "store=mireva-cr&from=2026-11-03&to=2026-11-03&include_charlie=1&include_attribution=1",
      ),
    );
    const body = await response.json();
    expect(mocks.dataset).toHaveBeenCalledTimes(1);
    expect(mocks.origins).toHaveBeenCalledWith(
      1,
      "2026-11-03T06:00:00.000Z",
      "2026-11-04T06:00:00.000Z",
    );
    expect(body.attribution).toMatchObject({
      totalOrders: 0,
      linkedCampaign: 0,
      groups: [],
    });
    expect(body).not.toHaveProperty("orders");
    expect(body).not.toHaveProperty("phones");
  });
  it("preserves orders when the origin reader fails and does not fabricate channel zeros", async () => {
    mocks.origins.mockRejectedValue(new Error("private provider failure"));
    const response = await GET(
      request("store=mireva-cr&month=2026-11&include_attribution=1"),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.attribution).toBeNull();
    expect(body.attributionError).toBeTruthy();
    expect(body.totals.generated).toBe(0);
    expect(JSON.stringify(body)).not.toContain("private provider failure");
  });
});

it("does not block available operations behind a stalled optional UTM reader", async () => {
  vi.useFakeTimers();
  try {
    mocks.origins.mockImplementation(() => new Promise(() => {}));
    const pending = GET(
      request("store=mireva-cr&month=2026-11&include_attribution=1"),
    );
    await vi.advanceTimersByTimeAsync(4001);
    const response = await pending,
      body = await response.json();
    expect(response.status).toBe(200);
    expect(body.attribution).toBeNull();
    expect(body.totals.generated).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
