// c807 Xpress y Cargo Expreso (Honduras) en el estado de los pedidos.
//
// POR QUE ESTE TEST EXISTE: Kairo ya rastreaba estas guias (courier_shipments),
// pero solo Novedades las leia. En Gestion → Pedidos quedaban "en reparto" para
// siempre: 105 guias desde julio. Ademas a la guia se le anteponia el "FD" de
// Forza (6595-13968-... -> FD6595-...), asi que tampoco cruzaba con su rastreo,
// y 80 de ellas aparecian como "Forza".

import { describe, expect, it } from "vitest";
import {
  buildVisibleOrderRows,
  getEffectiveTrackingStatus,
  type ShopifyOrderSummary,
} from "../lib/finance-orders";
import { FINANCE_STORES } from "../lib/store-config";
import type { ShipmentTrackingRow } from "../lib/finance-types";

const HN = FINANCE_STORES.find((s) => s.code === "mireva-hn")!;
const C807 = "6595-13968-20260922106527";
const CARGO = "BH262215954-1";

function pedido(n: number, tracking_number: string, tracking_company = "Forza"): ShopifyOrderSummary {
  return {
    id: String(n),
    order_number: n,
    name: `#MIRH${n}`,
    customer_name: "Cliente",
    phone: "+50499999999",
    products: "",
    total: "L 1,000",
    total_price: 1000,
    currency: "HNL",
    financial_status: "pending",
    fulfillment_status: "fulfilled",
    cancelled_at: null,
    tracking_number,
    tracking_company,
    created_at: "2026-09-22T15:00:00Z",
    line_items: [],
  };
}

function envio(guide: string, latest_group: string, fallos = 0): ShipmentTrackingRow {
  return {
    store_id: 2,
    guide_number: guide,
    tracking_number: guide,
    latest_status: "",
    latest_code: "",
    latest_group,
    latest_at: "2026-09-30T15:00:00Z",
    has_incident: false,
    incident_reason: "",
    delivery_address: "",
    receiver_name: "",
    events: Array.from({ length: fallos }, (_, i) => ({ code: "16", group: "failed", title: "Intento fallido", description: "", date: `2026-09-2${i}T15:00:00Z`, note: "" })),
    checked_at: "2026-09-30T16:00:00Z",
  } as ShipmentTrackingRow;
}

const filas = (orders: ShopifyOrderSummary[], tracking: ShipmentTrackingRow[] = []) =>
  buildVisibleOrderRows([], orders, HN, new Map(), new Map(), new Map(), new Map(tracking.map((t) => [t.guide_number, t])));

const estado = (orders: ShopifyOrderSummary[], tracking: ShipmentTrackingRow[] = []) =>
  getEffectiveTrackingStatus(filas(orders, tracking)[0], []);

describe("guía y courier", () => {
  it("la guía de c807 y de Cargo Expreso no lleva el FD de Forza, y el courier sale de la guía", () => {
    const [c, g] = filas([pedido(1, C807), pedido(2, CARGO, "")]);
    expect(c).toMatchObject({ guide_number: C807, courier: "c807 Xpress" });
    expect(g).toMatchObject({ guide_number: CARGO, courier: "Cargo Expreso" });
  });
  it("una guía de Forza sigue igual", () => {
    expect(filas([pedido(3, "36487821")])[0]).toMatchObject({ guide_number: "FD36487821", courier: "Forza" });
  });
});

describe("el rastreo de c807 / Cargo define el estado", () => {
  it("devuelto: no entregado", () => {
    expect(estado([pedido(1, C807)], [envio(C807, "returned")])).toBe("not_delivered");
  });
  it("entregado: entregado", () => {
    expect(estado([pedido(2, CARGO)], [envio(CARGO, "delivered")])).toBe("delivered");
  });
  it("en camino con un intento fallido: reintento", () => {
    expect(estado([pedido(3, CARGO)], [envio(CARGO, "in_progress", 1)])).toBe("en_route_retry");
  });
  it("el último evento es el fallo: incidencia", () => {
    expect(estado([pedido(4, C807)], [envio(C807, "failed", 1)])).toBe("incident");
  });
  it("sin rastreo todavía: en reparto, como antes", () => {
    expect(estado([pedido(5, C807)])).toBe("en_route");
  });
});
