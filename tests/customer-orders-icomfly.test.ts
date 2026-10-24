// Historial del cliente con los pedidos que existen solo en iComfly.
//
// POR QUE ESTE TEST EXISTE: la ficha del pedido y Leads avisan "este cliente
// ya tiene un pedido en curso" o "devolvio antes" mirando su historial. Desde
// el 28/10/2026 los pedidos nuevos estan solo en iComfly: si el historial
// leyera solo Shopify, esos avisos desaparecerian justo cuando mas importan.

import { beforeEach, describe, expect, it, vi } from "vitest";

const tablas: Record<string, { data: unknown[] | null; error: { message: string } | null }> = {};
const filtros: Record<string, string[]> = {};

function cadena(tabla: string) {
  const resultado = () => tablas[tabla] ?? { data: [], error: null };
  const c: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "ilike", "order", "limit", "gte", "or", "in"]) {
    c[metodo] = (...args: unknown[]) => {
      (filtros[tabla] ??= []).push(`${metodo}:${args.map(String).join("|")}`);
      return c;
    };
  }
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resultado()).then(resolve, reject);
  return c;
}

vi.mock("../lib/db", () => ({ getDB: () => ({ from: (tabla: string) => cadena(tabla) }) }));

const SHOPIFY = {
  name: "#MCRC26800",
  shopify_created_at: "2026-10-20T10:00:00Z",
  total_price: "19900",
  currency: "CRC",
  fulfillment_status: null,
  cancelled_at: null,
  tracking_number: "MV111",
  line_items: [{ title: "Autogrip", quantity: 1 }],
  raw_order: { shipping_address: { address1: "Casa azul", city: "Liberia" } },
};

const ICOMFLY_NUEVO = {
  id: "730001",
  order_number: "56900",
  shopify_display_number: null,
  status: "Pendiente",
  created_at: "2026-10-29T15:00:00.000Z",
  total: "13930.00",
  customer: { fullName: "Ana Mora", phone: "+50688887777" },
  shipping: { address: "Del parque 100 m sur", city: "Escazú" },
  items: [{ product_name: "Antena TV", quantity: 1, product_price: 13930 }],
  tracking_number: null,
};

describe("historial del cliente", () => {
  beforeEach(() => {
    for (const k of Object.keys(tablas)) delete tablas[k];
    for (const k of Object.keys(filtros)) delete filtros[k];
  });

  it("suma el pedido de iComfly, el más nuevo primero, con su dirección", async () => {
    tablas.shopify_orders = { data: [SHOPIFY], error: null };
    tablas.icomfly_order_payloads = { data: [ICOMFLY_NUEVO], error: null };
    const { loadCustomerOrdersByPhone } = await import("../lib/customer-orders-db");
    const r = await loadCustomerOrdersByPhone({ storeId: 1, phone: "8888-7777", currency: "CRC", logisticsProvider: "moovin" });
    expect(r.orders.map((o) => o.name)).toEqual(["IC-56900", "#MCRC26800"]);
    expect(r.orders[0]).toMatchObject({ total: 13930, address: "Del parque 100 m sur, Escazú", items: [{ title: "Antena TV", quantity: 1 }] });
    expect(r.orders[1].address).toBe("Casa azul, Liberia");
    // Busca por los mismos 8 digitos en el telefono del cliente y en el de envio.
    expect(filtros.icomfly_order_payloads).toContain("or:payload->customer->>phone.ilike.*88887777,payload->>shipping_phone.ilike.*88887777");
  });

  it("no repite lo que ya está en Shopify con la misma guía", async () => {
    tablas.shopify_orders = { data: [SHOPIFY], error: null };
    tablas.icomfly_order_payloads = { data: [{ ...ICOMFLY_NUEVO, tracking_number: "MV111" }], error: null };
    const { loadCustomerOrdersByPhone } = await import("../lib/customer-orders-db");
    const r = await loadCustomerOrdersByPhone({ storeId: 1, phone: "88887777", currency: "CRC", logisticsProvider: "moovin" });
    expect(r.orders.map((o) => o.name)).toEqual(["#MCRC26800"]);
  });

  it("si iComfly falla, el historial de Shopify sale igual", async () => {
    tablas.shopify_orders = { data: [SHOPIFY], error: null };
    tablas.icomfly_order_payloads = { data: null, error: { message: "tabla caida" } };
    const { loadCustomerOrdersByPhone } = await import("../lib/customer-orders-db");
    const r = await loadCustomerOrdersByPhone({ storeId: 1, phone: "88887777", currency: "CRC", logisticsProvider: "moovin" });
    expect(r.orders.map((o) => o.name)).toEqual(["#MCRC26800"]);
  });

  it("un cliente que solo compró por iComfly ya tiene historial", async () => {
    tablas.shopify_orders = { data: [], error: null };
    tablas.icomfly_order_payloads = { data: [ICOMFLY_NUEVO], error: null };
    const { loadCustomerOrdersByPhone } = await import("../lib/customer-orders-db");
    const r = await loadCustomerOrdersByPhone({ storeId: 1, phone: "88887777", currency: "CRC", logisticsProvider: "moovin" });
    expect(r.orders.map((o) => o.name)).toEqual(["IC-56900"]);
    expect(r.summary.orders).toBe(1);
  });
});
