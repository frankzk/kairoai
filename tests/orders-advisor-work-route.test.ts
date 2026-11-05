import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AdvisorIcomflyRow } from "../lib/advisor-work";
import type { TrackableOrderRow } from "../lib/finance-orders";
const mocks = vi.hoisted(() => ({
  dataset: vi.fn(),
  work: vi.fn(),
  actors: vi.fn(),
}));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
  isOrdersDatasetUnavailableError: () => false,
}));
vi.mock("@/lib/advisor-work-db", () => ({
  readAdvisorWorkData: mocks.work,
  readAdvisorWorkActors: mocks.actors,
}));
import { GET } from "../app/api/finance/orders/route";
const row = (
  key: string,
  name: string,
  extra: Partial<TrackableOrderRow> = {},
): TrackableOrderRow => ({
  row_key: key,
  source: "shopify",
  order_name: name,
  shopify_order_name: name,
  guide_number: "",
  customer_name: "Prueba",
  boxful_status: "",
  internal_status: "pending",
  match_status: "matched",
  cod_amount: 10000,
  shopify_order_number: null,
  shopify_financial_status: "pending",
  shopify_fulfillment_status: "",
  shopify_cancelled_at: null,
  shopify_created_at: "2026-11-01T15:00:00Z",
  package_items: [],
  ...extra,
});
const native = (
  id: string,
  over: Partial<AdvisorIcomflyRow> = {},
): AdvisorIcomflyRow => ({
  icomfly_order_id: id,
  order_number: id,
  shopify_display_number: "",
  tracking_number: "",
  confirmed_by_staff_id: 23,
  confirmed_by_name: "Rosa Tipiani",
  confirmed_at: "2026-11-02T15:00:00Z",
  requested_by_staff_id: null,
  requested_by_name: "",
  requested_at: null,
  ...over,
});
const rows = [
  row("shopify-icomfly-1", "IC-W7"),
  row("boxful-2", "MCRC100", {
    guide_number: "G1",
    internal_status: "en_route",
  }),
  row("shopify-icomfly-3", "IC-W9"),
  row("local-4", "MCRC400", { shopify_created_at: "2026-10-20T15:00:00Z" }),
  row("unrelated", "MCRC999"),
];
const events = ["MCRC100", "MCRC100", "MCRC400"].map((order_name) => ({
  order_name,
  kind: "contacto",
  outcome: "confirmado",
  staff_id: 23,
  staff_name: "Rosa Tipiani",
  created_at: "2026-11-02T15:00:00Z",
}));
const records = [
  native("1"),
  native("2", {
    shopify_display_number: "MCRC100",
    requested_by_staff_id: 23,
    requested_by_name: "Rosa Tipiani",
  }),
  native("3", {
    confirmed_by_staff_id: null,
    requested_by_staff_id: 23,
    requested_by_name: "Rosa Tipiani",
  }),
];
const get = async (q: string, store = "mireva-cr") =>
  GET(
    new NextRequest(
      "http://localhost/api/finance/orders?store=" + store + "&" + q,
    ),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataset.mockResolvedValue({ rows, settlementTraceByKey: new Map() });
  mocks.work.mockImplementation(async (store: number) =>
    store === 1 ? { events, native: records } : { events: [], native: [] },
  );
  mocks.actors.mockResolvedValue([{ id: 23, name: "Rosa Tipiani" }]);
});
describe("trabajo de asesora en Pedidos", () => {
  it("une confirmaciones y despacho de ambas fuentes antes de contar o paginar", async () => {
    const r = await get(
      "worked_by=23&advisor_activity=both&pageSize=1&metadata=1",
    );
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.total).toBe(4);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].advisor_work.staffId).toBe(23);
    expect(b.trackingCounts).toMatchObject({ all: 4, en_route: 1, pending: 3 });
    expect(b.advisorActors).toEqual([{ id: 23, name: "Rosa Tipiani" }]);
    expect(b.unmatchedAdvisorOrders).toBe(0);
    expect(mocks.work).toHaveBeenCalledWith(1, 23);
  });
  it("separa confirmar de despacho y mantiene fecha nula sin inventar otra", async () => {
    const c = await (
      await get("worked_by=23&advisor_activity=confirmation&all=1")
    ).json();
    expect(c.total).toBe(3);
    const d = await (
      await get("worked_by=23&advisor_activity=dispatch&all=1")
    ).json();
    expect(d.total).toBe(2);
    expect(d.rows.map((r: TrackableOrderRow) => r.row_key)).toEqual([
      "boxful-2",
      "shopify-icomfly-3",
    ]);
    expect(
      d.rows[0].advisor_work.evidence.some(
        (e: { kind: string; at: string | null }) =>
          e.kind === "dispatch_request" && e.at === null,
      ),
    ).toBe(true);
  });
  it("combina periodo, estado, busqueda y exportacion; no cruza tiendas", async () => {
    const list = await (
      await get("worked_by=23&advisor_activity=both&status=en_route&q=MCRC100")
    ).json();
    const exp = await (
      await get(
        "worked_by=23&advisor_activity=both&status=en_route&q=MCRC100&all=1",
      )
    ).json();
    expect(list.total).toBe(1);
    expect(exp.rows.map((r: TrackableOrderRow) => r.row_key)).toEqual(
      list.rows.map((r: TrackableOrderRow) => r.row_key),
    );
    expect(
      (await (await get("worked_by=23&period=month&month=2026-11")).json())
        .total,
    ).toBe(3);
    expect((await (await get("worked_by=23", "mireva-hn")).json()).total).toBe(
      0,
    );
  });
  it("rechaza filtros invalidos y no devuelve una lista amplia si falla una fuente", async () => {
    for (const q of [
      "worked_by=0",
      "worked_by=23abc",
      "worked_by=9007199254740993",
      "worked_by=23&confirmed_by=23",
      "worked_by=23&advisor_activity=todo",
    ])
      expect((await get(q)).status).toBe(400);
    expect(mocks.work).not.toHaveBeenCalled();
    mocks.work.mockRejectedValue(
      new Error("No se pudo consultar la atribución de iComfly."),
    );
    const r = await get("worked_by=23");
    expect(r.status).toBe(500);
    expect(await r.json()).not.toHaveProperty("rows");
  });
});
