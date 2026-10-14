// Pedidos de Honduras despachados con Cargo Expreso o c807 Xpress.
//
// POR QUE EXISTE: Shopify rotula sus guias como "Transportadora" y la tabla de
// pedidos las tomaba por Forza: #MIRH20584 (guia BH262231336-1) salia como
// "FDBH262231336-1", con el enlace de rastreo de Forza y "En ruta", cuando
// Cargo Expreso no la movia hacia 11 dias y ya tenia una novedad reprogramada.

import { describe, expect, it } from "vitest";
import {
  buildEnRouteGuides,
  buildShipmentTrackingMap,
  buildVisibleOrderRows,
  getEffectiveTrackingStatus,
  resolveCourierFamily,
  type ShopifyOrderSummary,
} from "../lib/finance-orders";
import type { LogisticsRow, ShipmentTrackingRow } from "../lib/finance-types";
import {
  buildShipmentTrackingUrl,
  detectShipmentCourier,
  resolveShipmentCourier,
  shipmentGroupToStatus,
} from "../lib/shipment-couriers";
import { FINANCE_STORES } from "../lib/store-config";

const HN = FINANCE_STORES.find((store) => store.code === "mireva-hn")!;
const CR = FINANCE_STORES.find((store) => store.code === "mireva-cr")!;

function shopifyOrder(number: number, trackingNumber: string, trackingCompany = "Transportadora"): ShopifyOrderSummary {
  return {
    id: String(number),
    order_number: number,
    name: `#MIRH${number}`,
    customer_name: "Elvin alvarenga",
    phone: "+50498679131",
    products: "",
    total: "990",
    total_price: 990,
    currency: "HNL",
    financial_status: "pending",
    fulfillment_status: "fulfilled",
    cancelled_at: null,
    tracking_number: trackingNumber,
    tracking_company: trackingCompany,
    created_at: "2026-10-01T12:00:00Z",
    line_items: [],
  };
}

function tracking(guide: string, overrides: Partial<ShipmentTrackingRow> = {}): ShipmentTrackingRow {
  return {
    store_id: HN.id,
    guide_number: guide,
    tracking_number: guide,
    latest_status: "EN RUTA BODEGA DESTINO",
    latest_code: "E",
    latest_group: "in_progress",
    latest_at: "2026-10-03T09:55:15.000Z",
    has_incident: false,
    incident_reason: "",
    delivery_address: "",
    receiver_name: "",
    events: [
      { code: "E", group: "in_progress", title: "Salida de bodega (SPS)", description: "", date: "2026-10-03T09:55:15.000Z", note: "SPS" },
      { code: "R", group: "pending", title: "Recolectado", description: "", date: "2026-10-02T15:00:00.000Z", note: "" },
    ],
    checked_at: "2026-10-14T13:40:15.547Z",
    ...overrides,
  };
}

function rowsFor(orders: ShopifyOrderSummary[], shipments: ShipmentTrackingRow[] = [], logistics: LogisticsRow[] = []) {
  return buildVisibleOrderRows(logistics, orders, HN, new Map(), new Map(), new Map(), buildShipmentTrackingMap(shipments));
}

describe("guias de Cargo Expreso y c807", () => {
  it("se reconocen por su formato, sin confundirse con Forza, Moovin ni WYN", () => {
    expect(detectShipmentCourier("BH262231336-1")).toBe("cargoexpreso");
    expect(detectShipmentCourier(" bh262231336-1 ")).toBe("cargoexpreso");
    expect(detectShipmentCourier("6595-13968-20260928110658")).toBe("c807");
    expect(detectShipmentCourier("FD28516415")).toBeNull();
    expect(detectShipmentCourier("28516415")).toBeNull();
    expect(detectShipmentCourier("MLCR000136520SD")).toBeNull();
    expect(detectShipmentCourier("")).toBeNull();
  });

  it("se reconocen tambien por el nombre cuando la guia no lo dice", () => {
    expect(resolveShipmentCourier("Cargo Expreso", "GUIA-RARA")).toBe("cargoexpreso");
    expect(resolveShipmentCourier("c807 Xpress", "")).toBe("c807");
    expect(resolveShipmentCourier("Forza", "28516415")).toBeNull();
    expect(resolveShipmentCourier("Transportadora", "BH262231336-1")).toBe("cargoexpreso");
  });

  it("enlazan a la pagina de rastreo de su courier, no a la de Forza", () => {
    expect(buildShipmentTrackingUrl("c807", "6595-13968-20260928110658")).toBe(
      "https://c807xpress.com/tracking/?guia=6595-13968-20260928110658"
    );
    expect(buildShipmentTrackingUrl("cargoexpreso", "BH262231336-1")).toContain("cargoexpreso.com");
  });

  it("mapean el estado del rastreo al de Kairo", () => {
    expect(shipmentGroupToStatus("delivered")).toBe("delivered");
    expect(shipmentGroupToStatus("returned")).toBe("not_delivered");
    expect(shipmentGroupToStatus("failed")).toBe("incident");
    expect(shipmentGroupToStatus("in_progress")).toBe("en_route");
    expect(shipmentGroupToStatus("pending")).toBe("");
    expect(shipmentGroupToStatus(undefined)).toBe("");
  });
});

describe("tabla de pedidos de Honduras", () => {
  it("#MIRH20584: Cargo Expreso, guia sin FD y estado de su rastreo", () => {
    const [row] = rowsFor([shopifyOrder(20584, "BH262231336-1")], [tracking("BH262231336-1")]);
    expect(row.guide_number).toBe("BH262231336-1");
    expect(row.courier).toBe("Cargo Expreso");
    expect(row.forza_group).toBe("");
    expect(row.shipment_courier).toBe("cargoexpreso");
    expect(row.shipment_status).toBe("EN RUTA BODEGA DESTINO");
    expect(row.shipment_at).toBe("2026-10-03T09:55:15.000Z");
    expect(getEffectiveTrackingStatus(row, [])).toBe("en_route");
  });

  it("sin rastreo guardado todavia, igual es Cargo Expreso (no ofrece el rastreo de Forza)", () => {
    const [row] = rowsFor([shopifyOrder(20585, "BH262231337-1")]);
    expect(row.courier).toBe("Cargo Expreso");
    expect(row.shipment_courier).toBe("cargoexpreso");
    expect(row.shipment_group).toBeUndefined();
    expect(getEffectiveTrackingStatus(row, [])).toBe("en_route");
  });

  it("un intento fallido sin volver a salir es incidencia; si volvio a salir, reintento", () => {
    const fallo = { code: "D", group: "failed", title: "Intento de entrega fallido: 005 Nadie en casa", description: "005 Nadie en casa", date: "2026-10-08T15:00:00.000Z", note: "" };
    const [incidencia] = rowsFor(
      [shopifyOrder(1, "BH000000001-1")],
      [tracking("BH000000001-1", { latest_group: "failed", latest_status: fallo.title, events: [fallo] })]
    );
    expect(incidencia.shipment_incidents).toBe(1);
    expect(getEffectiveTrackingStatus(incidencia, [])).toBe("incident");

    const salida = { code: "A", group: "in_progress", title: "Asignado a ruta de entrega", description: "", date: "2026-10-09T08:00:00.000Z", note: "" };
    const [reintento] = rowsFor(
      [shopifyOrder(2, "BH000000002-1")],
      [tracking("BH000000002-1", { latest_group: "in_progress", events: [salida, fallo] })]
    );
    expect(getEffectiveTrackingStatus(reintento, [])).toBe("en_route_retry");
  });

  it("devuelto o entregado segun el courier", () => {
    const [devuelto] = rowsFor([shopifyOrder(3, "BH000000003-1")], [tracking("BH000000003-1", { latest_group: "returned" })]);
    expect(getEffectiveTrackingStatus(devuelto, [])).toBe("not_delivered");
    const [entregado] = rowsFor(
      [shopifyOrder(4, "6595-13968-20260928110658", "c807 Xpress")],
      [tracking("6595-13968-20260928110658", { latest_group: "delivered", latest_status: "Entregado" })]
    );
    expect(entregado.courier).toBe("c807 Xpress");
    expect(entregado.guide_number).toBe("6595-13968-20260928110658");
    expect(getEffectiveTrackingStatus(entregado, [])).toBe("delivered");
  });

  it("las guias de Forza siguen igual", () => {
    const [row] = rowsFor([shopifyOrder(5, "28516415")]);
    expect(row.guide_number).toBe("FD28516415");
    expect(row.courier).toBe("Forza");
    expect(row.shipment_courier).toBeUndefined();
  });

  it("un archivo logistico que dice Cargo Expreso tampoco cae en Forza", () => {
    const logistics = {
      id: 9,
      store_id: HN.id,
      import_id: 1,
      guide_number: "BH262000588-1",
      order_name: "#MIRH900",
      store_order_number: "900",
      customer_name: "Cliente",
      customer_phone: "",
      created_on: "2026-01-10",
      courier: "Cargo Expreso",
      boxful_status: "En transito",
      internal_status: "pending",
      match_status: "matched",
      service_type: "",
      cod_amount: 990,
      cod_commission: 0,
      delivery_cost: 0,
      total_cost: 0,
      liquidated_on: null,
      finalized_on: null,
      label_url: "",
      package_items: [],
      shopify_order_id: "900",
      shopify_order_name: "#MIRH900",
      shopify_order_number: 900,
      shopify_financial_status: "pending",
      shopify_fulfillment_status: "fulfilled",
      shopify_cancelled_at: null,
      shopify_total: 990,
      shopify_created_at: "2026-01-10T12:00:00Z",
      created_at: "2026-01-11T12:00:00Z",
    } as LogisticsRow;
    const [row] = rowsFor([], [tracking("BH262000588-1", { latest_group: "delivered" })], [logistics]);
    expect(row.guide_number).toBe("BH262000588-1");
    expect(row.courier).toBe("Cargo Expreso");
    expect(getEffectiveTrackingStatus(row, [])).toBe("delivered");
  });

  it("el boton 'Forza (N)' ya no le pregunta a Forza por guias de otros couriers", () => {
    const rows = rowsFor([shopifyOrder(6, "BH262231336-1"), shopifyOrder(7, "28516415")], [tracking("BH262231336-1")]);
    const guides = buildEnRouteGuides(rows, new Map(), HN);
    expect(guides.forza.map((g) => g.guide)).toEqual(["FD28516415"]);
  });

  it("el comparativo de couriers los cuenta aparte de Forza", () => {
    expect(resolveCourierFamily("Cargo Expreso", "BH262231336-1")?.label).toBe("Cargo Expreso");
    expect(resolveCourierFamily("c807 Xpress", "6595-13968-20260928110658")?.label).toBe("c807 Xpress");
  });

  it("Costa Rica no cambia: Moovin sigue siendo Moovin", () => {
    const order = { ...shopifyOrder(8, "2641395", "Moovin"), name: "#MCRC8" };
    const [row] = buildVisibleOrderRows([], [order], CR, new Map(), new Map());
    expect(row.courier).toBe("Moovin");
    expect(row.shipment_courier).toBeUndefined();
  });
});
