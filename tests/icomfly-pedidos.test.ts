// Pedidos que existen solo en iComfly (desde el 28/10/2026, todos los nuevos).
//
// POR QUE ESTE TEST EXISTE: si no entran al dataset, desde el 28 Pedidos, la
// cola de confirmacion y los KPI quedan vacios. Y si entran de mas, se cuentan
// dos veces: iComfly no guardo el numero de Shopify en ~2.200 pedidos de junio
// a septiembre, pero estan en Shopify con la misma guia.

import { describe, expect, it } from "vitest";
import {
  CORTE_PEDIDOS_ICOMFLY,
  direccionIcomfly,
  esPedidoIcomfly,
  estadoFinalIcomfly,
  nombrePedidoIcomfly,
  pedidosDeIcomfly,
  type PedidoIcomflyCrudo,
} from "../lib/icomfly-pedidos";
import { buildVisibleOrderRows } from "../lib/finance-orders";
import { getShopifyOrderMatchKeys } from "../lib/order-matching";
import { FINANCE_STORES } from "../lib/store-config";

const CR = FINANCE_STORES[0];

function crudo(over: Partial<PedidoIcomflyCrudo> = {}): PedidoIcomflyCrudo {
  return {
    id: "722549",
    order_number: "56703",
    shopify_display_number: null,
    status: "Pendiente",
    created_at: "2026-10-29T15:00:00.000Z",
    updated_at: "2026-10-29T15:05:00.000Z",
    cancelled_at: null,
    total: "33830.00",
    customer: { fullName: "Ana Mora", phone: "+50688887777", whatsapp: "", address: "Del parque 100 m sur", city: "Escazú" },
    shipping: { address: "Del parque 100 m sur", district: "San Rafael", city: "Escazú", province: "San José" },
    shipping_name: "Ana Mora",
    shipping_phone: "88887777",
    items: [
      { name: "Autogrip", product_name: "Autogrip", quantity: 1, product_price: 19900, variant_label: null },
      { name: "Antena TV", product_name: "Antena TV", quantity: 1, product_price: 13930, variant_label: "Negra" },
    ],
    product_name: "1x Autogrip, 1x Antena TV",
    quantity: "2",
    product_price: "16915.00",
    carrier_name: null,
    tracking_number: null,
    ...over,
  };
}

const sinShopify: Array<{ name: string; order_number: number; tracking_number?: string }> = [];

describe("qué pedidos de iComfly entran", () => {
  it("uno nuevo, sin Shopify, entra con cliente, productos y total", () => {
    const [p] = pedidosDeIcomfly([crudo()], sinShopify, { currency: "CRC" });
    expect(p).toMatchObject({
      id: "icomfly-722549",
      name: "IC-56703",
      customer_name: "Ana Mora",
      phone: "+50688887777",
      total_price: 33830,
      total: "33830 CRC",
      currency: "CRC",
      cancelled_at: null,
      products: "1x Autogrip, 1x Antena TV - Negra",
      icomfly: { id: "722549", estado: "Pendiente" },
    });
    expect(p.line_items).toEqual([
      { sku: "", title: "Autogrip", quantity: 1, price: 19900 },
      { sku: "", title: "Antena TV - Negra", quantity: 1, price: 13930 },
    ]);
  });

  it("si Shopify ya lo tiene por número, no entra", () => {
    const p = pedidosDeIcomfly([crudo({ shopify_display_number: "#MCRC26861" })], [{ name: "#MCRC26861", order_number: 26861 }], {
      currency: "CRC",
    });
    expect(p).toEqual([]);
  });

  it("si Shopify lo tiene con la misma guía aunque iComfly no guardó el número, no entra", () => {
    const p = pedidosDeIcomfly([crudo({ tracking_number: "MV123456" })], [{ name: "#MCRC20000", order_number: 20000, tracking_number: "mv123456" }], {
      currency: "CRC",
    });
    expect(p).toEqual([]);
  });

  it("con número de Shopify que todavía no llegó a la base, entra con ese número", () => {
    const [p] = pedidosDeIcomfly([crudo({ shopify_display_number: "#MCRC26900" })], sinShopify, { currency: "CRC" });
    expect(p.name).toBe("#MCRC26900");
  });

  it("antes del corte no entra (ya está en Shopify aunque no se pueda cruzar), ni los Testeos", () => {
    expect(pedidosDeIcomfly([crudo({ created_at: "2026-09-20T10:00:00Z" })], sinShopify, { currency: "CRC" })).toEqual([]);
    expect(pedidosDeIcomfly([crudo({ created_at: `${CORTE_PEDIDOS_ICOMFLY}T00:00:00Z` })], sinShopify, { currency: "CRC" })).toHaveLength(1);
    expect(pedidosDeIcomfly([crudo({ status: "Testeos" })], sinShopify, { currency: "CRC" })).toEqual([]);
  });

  it("cancelado en iComfly queda anulado; repetido, una sola vez", () => {
    const p = pedidosDeIcomfly([crudo({ status: "Cancelado" }), crudo({ status: "Cancelado" })], sinShopify, { currency: "CRC" });
    expect(p).toHaveLength(1);
    expect(p[0].cancelled_at).toBe("2026-10-29T15:05:00.000Z");
  });
});

describe("nombre y estado", () => {
  it("IC- + el número de iComfly, nunca un número a secas", () => {
    expect(nombrePedidoIcomfly("56703", "1")).toBe("IC-56703");
    expect(nombrePedidoIcomfly("#1792779044403321771", "716120")).toBe("IC-1792779044403321771");
    expect(nombrePedidoIcomfly("", "716120")).toBe("IC-716120");
  });
  it("un número a secas cruzaría con los códigos de Boxful; IC- no", () => {
    const [p] = pedidosDeIcomfly([crudo()], sinShopify, { currency: "CRC" });
    expect(getShopifyOrderMatchKeys(p)).toEqual(["ic-56703"]);
  });
  it("Entregado y Devolución son finales; lo demás lo decide el courier", () => {
    expect(estadoFinalIcomfly("Entregado")).toBe("delivered");
    expect(estadoFinalIcomfly("Devolucion")).toBe("not_delivered");
    expect(estadoFinalIcomfly("En_Reparto")).toBe("");
    expect(estadoFinalIcomfly("Pendiente")).toBe("");
  });
  it("el id de iComfly se reconoce, para no mandarlo a Shopify", () => {
    expect(esPedidoIcomfly("icomfly-722549")).toBe(true);
    expect(esPedidoIcomfly("6123456789")).toBe(false);
    expect(esPedidoIcomfly("")).toBe(false);
  });
  it("la dirección sale en una línea, como la de Shopify", () => {
    expect(direccionIcomfly(crudo())).toBe("Del parque 100 m sur, San Rafael, Escazú, San José");
    expect(direccionIcomfly({ shipping: null, customer: { address: "Casa azul", city: "Liberia" } })).toBe("Casa azul, Liberia");
  });
});

describe("en las filas de Pedidos", () => {
  const filas = (crudos: PedidoIcomflyCrudo[]) =>
    buildVisibleOrderRows([], pedidosDeIcomfly(crudos, sinShopify, { currency: "CRC" }), CR, new Map(), new Map());

  it("sale como pedido pendiente marcado iComfly, con su total y productos", () => {
    const [fila] = filas([crudo()]);
    expect(fila).toMatchObject({
      origen: "icomfly",
      source: "shopify",
      order_name: "IC-56703",
      internal_status: "pending",
      cod_amount: 33830,
      phone: "+50688887777",
      guide_number: "",
    });
    expect(fila.package_items.map((i) => i.title)).toEqual(["1x Autogrip", "1x Antena TV - Negra"]);
  });

  it("lo que iComfly ya cerró sale cerrado, y lo cancelado, anulado", () => {
    expect(filas([crudo({ status: "Entregado" })])[0].internal_status).toBe("delivered");
    expect(filas([crudo({ status: "Devolucion" })])[0].internal_status).toBe("not_delivered");
    expect(filas([crudo({ status: "Cancelado" })])[0].internal_status).toBe("annulled");
  });

  it("los pedidos de Shopify no cambian", () => {
    const shopify = {
      id: "6123",
      order_number: 26800,
      name: "#MCRC26800",
      customer_name: "Beto",
      phone: "88880000",
      products: "",
      total: "19900 CRC",
      total_price: 19900,
      currency: "CRC",
      financial_status: "pending",
      fulfillment_status: null,
      cancelled_at: null,
      created_at: "2026-10-20T10:00:00Z",
      line_items: [],
    };
    const [fila] = buildVisibleOrderRows([], [shopify], CR, new Map(), new Map());
    expect(fila.origen).toBeUndefined();
    expect(fila.internal_status).toBe("pending");
  });
});
