import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cumple, exigenciaDe } from "../lib/permisos";

const mocks = vi.hoisted(() => ({ dataset: vi.fn(), expenses: vi.fn(), costs: vi.fn(), versions: vi.fn(), storeAllowed: true }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) => {
    const code = params.get("store");
    return mocks.storeAllowed && ["mireva-cr", "mireva-hn"].includes(code || "")
      ? { id: code === "mireva-cr" ? 1 : 2, code } : null;
  },
}));
vi.mock("@/lib/finance", () => ({ listExpenses: mocks.expenses, listProductCosts: mocks.costs, listProductCostVersions: mocks.versions }));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
  isOrdersDatasetUnavailableError: (error: unknown) => error instanceof Error && error.name === "OrdersDatasetUnavailableError",
}));
import { GET } from "../app/api/marketing/summary/route";

const request = (query: string) => new NextRequest(`http://localhost/api/marketing/summary?${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.storeAllowed = true;
  mocks.dataset.mockResolvedValue({ rows: [], matchedSettlementRows: [], imports: [], settlementTraceByKey: new Map() });
  mocks.expenses.mockResolvedValue([]);
  mocks.costs.mockResolvedValue([]);
  mocks.versions.mockResolvedValue([]);
});

describe("marketing API isolation and availability", () => {
  it("rejects missing, unsupported or unauthorized stores before reading data", async () => {
    for (const query of ["month=2026-10", "store=mireva-hn&month=2026-10"]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    mocks.storeAllowed = false;
    expect((await GET(request("store=mireva-cr&month=2026-10"))).status).toBe(400);
    expect(mocks.dataset).not.toHaveBeenCalled();
  });

  it("rejects malformed calendar months without loading the dataset", async () => {
    for (const month of ["", "2026-13", "2026-1", "2026-10-01"]) {
      expect((await GET(request(`store=mireva-cr&month=${month}`))).status).toBe(400);
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
    expect(await result.json()).toMatchObject({ store: "mireva-cr", currency: "CRC", totals: { generated: 0, registeredAdSpend: null } });
  });

  it("returns failure rather than fabricated zero metrics when the dataset is unavailable", async () => {
    const error = new Error("Dataset unavailable");
    error.name = "OrdersDatasetUnavailableError";
    mocks.dataset.mockRejectedValue(error);
    const response = await GET(request("store=mireva-cr&month=2026-10"));
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty("error");
  });

  it("requires financial permission on both the page and API", () => {
    for (const route of ["/admin/marketing", "/api/marketing/summary", "/api/marketing/sources"]) {
      expect(cumple(exigenciaDe(route), ["finanzas"])).toBe(true);
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
