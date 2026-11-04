import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { exigenciaDe, cumple } from "../lib/permisos";
const mocks = vi.hoisted(() => ({
  dataset: vi.fn(),
  origins: vi.fn(),
  control: vi.fn(),
  allowed: true,
}));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (p: URLSearchParams) =>
    mocks.allowed && p.get("store") === "mireva-cr"
      ? { id: 1, code: "mireva-cr" }
      : null,
}));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
}));
vi.mock("@/lib/marketing-attribution-db", () => ({
  listMarketingOrigins: mocks.origins,
}));
vi.mock("@/lib/finance-orders", () => ({
  buildFinanceControlCenter: mocks.control,
}));
import { GET } from "../app/api/marketing/attribution/route";
const req = (q = "store=mireva-cr&from=2026-11-01&to=2026-11-04") =>
  new NextRequest(`http://localhost/api/marketing/attribution?${q}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.dataset.mockResolvedValue({
    rows: [],
    matchedSettlementRows: [],
    imports: [],
    settlementTraceByKey: new Map(),
  });
  mocks.control.mockReturnValue({ orders: [] });
  mocks.origins.mockResolvedValue([]);
});
describe("UTM de Marketing: tienda, permiso y cobertura", () => {
  it("usa el permiso Marketing ya existente sin conceder Gestión", () => {
    const p = exigenciaDe("/api/marketing/attribution");
    expect(cumple(p, ["marketing"])).toBe(true);
    expect(cumple(p, ["pedidos"])).toBe(false);
  });
  it("solo consulta la tienda autorizada y el rango UTC de Costa Rica", async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect(mocks.origins).toHaveBeenCalledWith(
      1,
      "2026-11-01T06:00:00.000Z",
      "2026-11-05T06:00:00.000Z",
    );
    expect(await r.json()).toMatchObject({
      totalOrders: 0,
      withUtm: 0,
      groups: [],
    });
  });
  it("no consulta si el rango o tienda son inválidos", async () => {
    expect(
      (await GET(req("store=mireva-hn&from=2026-11-01&to=2026-11-04"))).status,
    ).toBe(400);
    expect(
      (await GET(req("store=mireva-cr&from=2026-01-01&to=2026-11-04"))).status,
    ).toBe(400);
    mocks.allowed = false;
    expect((await GET(req())).status).toBe(400);
    expect(mocks.origins).not.toHaveBeenCalled();
  });
  it("un fallo de origen no se presenta como cero pedidos con UTM", async () => {
    mocks.origins.mockRejectedValue(Error("private"));
    const r = await GET(req());
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("private");
  });
});
