import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TrackableOrderRow } from "../lib/finance-orders";
const mocks = vi.hoisted(() => ({ dataset: vi.fn() }));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
}));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (p: URLSearchParams) =>
    p.get("store") === "mireva-cr"
      ? { id: 1, code: "mireva-cr", timezone: "America/Costa_Rica" }
      : null,
}));
const now = new Date("2026-11-06T15:30:45.250Z");
const row = (at: string): TrackableOrderRow => ({
  row_key: at,
  source: "shopify",
  order_name: at,
  guide_number: "",
  customer_name: "Prueba",
  boxful_status: "",
  internal_status: "pending",
  match_status: "matched",
  cod_amount: 1000,
  shopify_order_name: at,
  shopify_order_number: null,
  shopify_financial_status: "pending",
  shopify_fulfillment_status: "",
  shopify_cancelled_at: null,
  shopify_created_at: at,
  package_items: [],
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.dataset.mockResolvedValue({
    rows: [
      row("2026-11-06T08:00:00Z"),
      row("2026-11-06T15:30:45.249Z"),
      row("2026-11-06T15:30:45.250Z"),
      row("2026-11-05T08:00:00Z"),
      row("2026-11-05T15:30:45.249Z"),
      row("2026-11-05T15:30:45.250Z"),
      row("2026-11-05T21:00:00Z"),
    ],
    settlementTraceByKey: new Map(),
  });
});
afterEach(() => vi.useRealTimers());
describe("API de KPI: ventana y valores usan el mismo corte", () => {
  it("excluye pedidos de ayer posteriores al corte y respeta el limite exclusivo", async () => {
    const { GET } = await import("../app/api/finance/kpis/route");
    const r = await GET(
      new NextRequest(
        "http://localhost/api/finance/kpis?store=mireva-cr&period=today",
      ),
    );
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.current.generated).toBe(2);
    expect(b.previous.generated).toBe(2);
    expect(b.window.prevEnd).toBe(Date.parse("2026-11-05T15:30:45.250Z"));
    expect(b.timeZone).toBe("America/Costa_Rica");
    expect(b.window.cutoffLabel).toBe("Hasta las 09:30");
  });
  it("ayer conserva el dia completo y la respuesta cacheada conserva su corte real", async () => {
    const { GET } = await import("../app/api/finance/kpis/route");
    const request = new NextRequest(
      "http://localhost/api/finance/kpis?store=mireva-cr&period=yesterday",
    );
    const b = await (await GET(request)).json();
    expect(b.current.generated).toBe(4);
    expect(b.previous.generated).toBe(0);
    const today = new NextRequest(
      "http://localhost/api/finance/kpis?store=mireva-cr&period=today",
    );
    const first = await (await GET(today)).json();
    vi.setSystemTime(new Date(now.getTime() + 10000));
    const cached = await (await GET(today)).json();
    expect(cached.window.curEnd).toBe(first.window.curEnd);
    expect(cached.current.generated).toBe(first.current.generated);
  });
});
