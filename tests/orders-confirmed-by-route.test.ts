import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildKairoConfirmationIndex } from "../lib/order-confirmations";
const mocks = vi.hoisted(() => ({ dataset: vi.fn(), confirmations: vi.fn() }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (p: URLSearchParams) =>
    ["mireva-cr", "mireva-hn"].includes(p.get("store") || "")
      ? {
          id: p.get("store") === "mireva-cr" ? 1 : 2,
          code: p.get("store"),
          timezone: "America/Costa_Rica",
        }
      : null,
}));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
  isOrdersDatasetUnavailableError: () => false,
}));
vi.mock("@/lib/order-confirmations-db", () => ({
  readKairoConfirmationIndex: mocks.confirmations,
}));
vi.mock("@/lib/finance-orders", () => ({
  buildEnRouteGuides: () => ({}),
  expectsSettlement: () => true,
  getEffectiveTrackingStatus: (r: { testStatus: string }) => r.testStatus,
  getSettlementTracesForLogisticsRow: () => [],
  getTrackingFilterFromStatus: (s: string) => s,
  matchesOrderSearch: (r: { order_name: string }, q: string) =>
    r.order_name.includes(q),
}));
vi.mock("@/lib/dispatch", () => ({
  mergeDispatchIntoTracking: (s: string) => s,
}));
import { GET } from "../app/api/finance/orders/route";
const rows = [
  {
    row_key: "a",
    order_name: "#MCRC100",
    testStatus: "en_route",
    shopify_created_at: "2026-11-01T12:00:00Z",
  },
  {
    row_key: "b",
    order_name: "#MCRC200",
    testStatus: "delivered",
    shopify_created_at: "2026-11-01T12:00:00Z",
    dispatch_confirmed_by: "Rosa Tipiani",
  },
  {
    row_key: "c",
    order_name: "IC-W3",
    shopify_order_name: "#MCRC300",
    testStatus: "not_delivered",
    shopify_created_at: "2026-10-01T12:00:00Z",
  },
];
const events = ["#MCRC100", "#MCRC300", "#MCRC100"].map((order_name) => ({
  order_name,
  kind: "contacto",
  outcome: "confirmado",
  staff_id: 23,
  staff_name: "Rosa Tipiani",
  created_at: "2026-11-04T12:00:00Z",
}));
const request = (q: string) =>
  new NextRequest("http://localhost/api/finance/orders?store=mireva-cr&" + q);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataset.mockResolvedValue({ rows, settlementTraceByKey: new Map() });
  mocks.confirmations.mockImplementation(async (storeId: number) =>
    buildKairoConfirmationIndex(storeId === 1 ? events : []),
  );
});
describe("filtro de confirmaciones en Kairo", () => {
  it("filtra antes de conteos y paginación; devuelve la evidencia local", async () => {
    const res = await GET(request("confirmed_by=23&pageSize=1&metadata=1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].confirmation_kairo).toMatchObject({
      staffId: 23,
      staffName: "Rosa Tipiani",
    });
    expect(body.trackingCounts).toMatchObject({
      all: 2,
      en_route: 1,
      not_delivered: 1,
      delivered: 0,
    });
    expect(body.confirmationActors).toEqual([{ id: 23, name: "Rosa Tipiani" }]);
    expect(mocks.confirmations).toHaveBeenCalledWith(1);
  });
  it("la exportación usa el mismo conjunto, sin sumar eventos duplicados", async () => {
    const body = await (await GET(request("confirmed_by=23&all=1"))).json();
    expect(body.total).toBe(2);
    expect(body.rows.map((r: { row_key: string }) => r.row_key)).toEqual([
      "a",
      "c",
    ]);
    expect(
      body.rows.every(
        (r: { confirmation_kairo: { staffId: number } }) =>
          r.confirmation_kairo.staffId === 23,
      ),
    ).toBe(true);
  });
  it("se combina con estado, búsqueda y período de creación", async () => {
    expect(
      (
        await (
          await GET(request("confirmed_by=23&status=en_route&q=MCRC100"))
        ).json()
      ).total,
    ).toBe(1);
    const body = await (
      await GET(request("confirmed_by=23&period=month&month=2026-11"))
    ).json();
    expect(body.total).toBe(1);
    expect(body.rows[0].row_key).toBe("a");
  });
  it("no cambia la tabla sin selección y la metadata solo contiene actores de la tienda", async () => {
    const body = await (await GET(request("metadata=1"))).json();
    expect(body.total).toBe(3);
    expect(
      body.rows.every((r: Record<string, unknown>) => !r.confirmation_kairo),
    ).toBe(true);
    const hn = await GET(
      new NextRequest(
        "http://localhost/api/finance/orders?store=mireva-hn&confirmed_by=23",
      ),
    );
    expect((await hn.json()).total).toBe(0);
    expect(mocks.confirmations).toHaveBeenLastCalledWith(2);
  });
  it("rechaza IDs inválidos y no muestra todos los clientes si falla la atribución", async () => {
    for (const id of ["0", "-1", "23abc", "1.2", "9007199254740993"])
      expect((await GET(request("confirmed_by=" + id))).status).toBe(400);
    expect(mocks.dataset).not.toHaveBeenCalled();
    mocks.confirmations.mockRejectedValue(
      new Error("No se pudieron consultar las confirmaciones de Kairo."),
    );
    const res = await GET(request("confirmed_by=23"));
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("rows");
  });
});
