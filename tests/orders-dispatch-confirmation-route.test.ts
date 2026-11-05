import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  computeOpMetricsFromTrackableRows,
  type TrackableOrderRow,
} from "../lib/finance-orders";

const mocks = vi.hoisted(() => ({ dataset: vi.fn() }));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  getOrdersDataset: mocks.dataset,
  isOrdersDatasetUnavailableError: () => false,
}));
vi.mock("@/lib/order-events-db", () => ({
  listConfirmacionEvents: async () =>
    new Map([
      [
        "IC-REABIERTO",
        [
          {
            kind: "contacto",
            outcome: "confirmado",
            created_at: "2026-11-02T15:00:00Z",
          },
        ],
      ],
    ]),
  leerConfigConfirmacion: async () => ({
    activacion: "2026-09-15",
    cicloDias: 3,
    tz: "America/Costa_Rica",
  }),
}));
import { GET } from "../app/api/finance/orders/route";

function row(
  ref: string,
  status: string,
  extra: Partial<TrackableOrderRow> = {},
): TrackableOrderRow {
  return {
    row_key: ref,
    source: "shopify",
    order_name: ref,
    shopify_order_name: ref,
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
    icomfly_estado: status,
    ...extra,
  };
}
const rows = [
  row("IC-ENVIADO1", "Enviada", { dispatch_view: "despachado" }),
  row("IC-ENVIADO2", "Enviada", {
    dispatch_view: "despachado",
    dispatch_confirmed_by: "Asesora",
  }),
  row("IC-CONFIRMADO1", "Confirmada"),
  row("IC-CONFIRMADO2", "Confirmada", { dispatch_confirmed_by: "Asesora" }),
  row("IC-PENDIENTE", "Pendiente", { dispatch_confirmed_by: "Asesora" }),
  row("IC-REABIERTO", "Modificar Dirección", {
    dispatch_confirmed_by: "Asesora",
    shopify_financial_status: "paid",
  }),
  row("IC-GUIA", "Enviada", {
    dispatch_view: "despachado",
    guide_number: "G1",
    internal_status: "en_route",
  }),
  row("IC-ANULADO", "Cancelado", {
    internal_status: "annulled",
    shopify_cancelled_at: "2026-11-02T16:00:00Z",
  }),
  row("IC-RECOLECCION", "Enviada", {
    guide_number: "G2",
    internal_status: "en_route",
    dispatch_view: "despacho_solicitado",
  }),
];
async function get(query: string) {
  const res = await GET(
    new NextRequest(
      "http://localhost/api/finance/orders?store=mireva-cr&period=all&" + query,
    ),
  );
  expect(res.status).toBe(200);
  return res.json();
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataset.mockResolvedValue({ rows, settlementTraceByKey: new Map() });
});

describe("despacho solicitado y confirmacion comparten la clasificacion de Gestion", () => {
  it("rescata Enviada sin guia de una cache anterior y mantiene los pedidos con guia y anulados", async () => {
    const body = await get("status=despacho_solicitado&all=1");
    expect(body.trackingCounts).toMatchObject({
      all: 9,
      pending: 2,
      despacho_solicitado: 5,
      en_route: 1,
      annulled: 1,
    });
    expect(body.rows.map((r: TrackableOrderRow) => r.order_name)).toEqual([
      "IC-ENVIADO1",
      "IC-ENVIADO2",
      "IC-CONFIRMADO1",
      "IC-CONFIRMADO2",
      "IC-RECOLECCION",
    ]);
    expect((await get("status=despacho_solicitado&pageSize=1")).total).toBe(5);
  });
  it("Confirmada no requiere atribucion y la atribucion/evento viejo no confirma pedidos vueltos a gestion", async () => {
    const body = await get("status=pending&subetapa=confirmado&pageSize=100");
    expect(body.total).toBe(0);
    expect(body.confirmacionCounts.subetapa).toMatchObject({
      all: 2,
      confirmado: 0,
    });
    expect(body.rows).toEqual([]);
    const kpi = computeOpMetricsFromTrackableRows(rows, new Map());
    expect(kpi).toMatchObject({
      generated: 9,
      confirmed: 6,
      dispatched: 2,
      confirmedNotDispatched: 4,
      sentWithoutGuide: 2,
      inProgress: 2,
      annulled: 1,
    });
    const dispatch = await get("status=despacho_solicitado");
    expect(kpi.confirmedNotDispatched).toBe(
      dispatch.dispatchCounts.por_solicitar +
        dispatch.dispatchCounts.esperando_guia,
    );
  });
  it("filtra subetapas antes de paginar/exportar y limita sus conteos por busqueda", async () => {
    const q = "status=despacho_solicitado&dispatch_subetapa=por_solicitar";
    const paged = await get(q + "&pageSize=1");
    expect(paged.total).toBe(2);
    expect(paged.rows).toHaveLength(1);
    expect(paged.dispatchCounts).toEqual({
      all: 5,
      por_solicitar: 2,
      esperando_guia: 2,
      esperando_recoleccion: 1,
    });
    const exported = await get(q + "&all=1");
    expect(exported.rows.map((r: TrackableOrderRow) => r.order_name)).toEqual([
      "IC-CONFIRMADO1",
      "IC-CONFIRMADO2",
    ]);
    expect(
      (await get("status=despacho_solicitado&dispatch_subetapa=esperando_guia"))
        .total,
    ).toBe(2);
    expect(
      (
        await get(
          "status=despacho_solicitado&dispatch_subetapa=esperando_recoleccion",
        )
      ).total,
    ).toBe(1);
    expect((await get(q + "&q=IC-CONFIRMADO")).dispatchCounts).toEqual({
      all: 2,
      por_solicitar: 2,
      esperando_guia: 0,
      esperando_recoleccion: 0,
    });
    expect(
      (await get("status=en_route&dispatch_subetapa=por_solicitar")).total,
    ).toBe(1);
    expect(
      (await get("status=despacho_solicitado&dispatch_subetapa=desconocido"))
        .total,
    ).toBe(5);
  });
});
