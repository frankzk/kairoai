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
  orders: [] as unknown[],
  origins: vi.fn(),
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: async () => ({
    rows: [],
    matchedSettlementRows: [],
    imports: [],
    settlementTraceByKey: new Map(),
  }),
}));
vi.mock("@/lib/finance-orders", () => ({
  buildFinanceControlCenter: () => ({ orders: mocks.orders }),
}));
vi.mock("@/lib/marketing-attribution-db", () => ({
  listMarketingOrigins: mocks.origins,
}));
import { GET } from "../app/api/marketing/control/route";
import { marketingDate, shiftDate } from "../lib/marketing-dates";

const today = marketingDate();
const at = (date: string, hour = 12) =>
  new Date(Date.parse(`${date}T06:00:00Z`) + hour * 3_600_000).toISOString();
const request = (query = "") =>
  new NextRequest(
    `https://kairo.test/api/marketing/control?store=mireva-cr${query}`,
  );

beforeEach(() => {
  mocks.identity = {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  const yesterday = shiftDate(today, -1);
  mocks.orders = [
    {
      order_key: "1",
      order_name: "IC-W1",
      guide_number: "g1",
      tracking_status: "delivered",
      created_at: at(yesterday),
      items: [{ sku: "MAG", title: "Magnesium", quantity: 1 }],
      customer_name: "Privado",
      phone: "+50688888888",
    },
    {
      order_key: "2",
      order_name: "IC-W2",
      guide_number: "g2",
      tracking_status: "annulled",
      created_at: at(yesterday, 13),
      items: [{ sku: "MAG", title: "Magnesium", quantity: 1 }],
    },
  ];
  mocks.origins
    .mockReset()
    .mockResolvedValue([
      {
        icomfly_order_id: "1",
        order_number: "x",
        store_web_seq: "1",
        shopify_display_number: null,
        tracking_number: "g1",
        ad_origin: {
          utm_source: "fb",
          utm_campaign: "CBO MAG---120200000000001",
          campaign_id: "120200000000001",
        },
      },
    ]);
});

describe("marketing control route", () => {
  it("defaults to the last 14 CR days with pace and only aggregates", async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await result.json();
    expect(body).toMatchObject({
      from: shiftDate(today, -13),
      to: today,
      today,
      origins: "ok",
    });
    expect(body.days).toHaveLength(14);
    expect(body.days[12]).toMatchObject({
      created: 2,
      real: 1,
      withCampaign: 1,
      byCampaign: { "meta:120200000000001": 1 },
    });
    expect(body.pace.days).toHaveLength(8);
    const text = JSON.stringify(body);
    for (const secret of ["IC-W1", "Privado", "+50688888888", "g1"])
      expect(text).not.toContain(secret);
  });

  it("omits pace for past periods and validates the range", async () => {
    const past = shiftDate(today, -3);
    const body = await (await GET(request(`&from=${past}&to=${past}`))).json();
    expect(body.pace).toBeNull();
    expect((await GET(request(`&from=${today}`))).status).toBe(400);
    expect(
      (await GET(request(`&from=${today}&to=${shiftDate(today, 1)}`))).status,
    ).toBe(400);
  });

  it("falls back to all-unlinked orders when origins fail", async () => {
    mocks.origins.mockRejectedValue(new Error("private detail"));
    const body = await (await GET(request())).json();
    expect(body.origins).toBe("error");
    expect(body.days[12]).toMatchObject({
      withCampaign: 0,
      unlinkedBySku: { "sku:mag": 1 },
    });
  });

  it("requires Marketing and Costa Rica", async () => {
    mocks.identity.permisos = [];
    expect((await GET(request())).status).toBe(403);
    mocks.identity.permisos = ["marketing"];
    expect(
      (
        await GET(
          new NextRequest(
            "https://kairo.test/api/marketing/control?store=mireva-hn",
          ),
        )
      ).status,
    ).toBe(403);
  });
});
