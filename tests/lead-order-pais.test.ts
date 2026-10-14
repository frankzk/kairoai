// El pedido creado desde el tablero de Leads lleva el pais de SU tienda.
//
// POR QUE ESTE TEST EXISTE: la ruta tenia el pais fijo en "Costa Rica", asi
// que los pedidos de Honduras creados por las asesoras salian a Shopify con
// direccion en Costa Rica. Hasta el 12/10/2026 habia 44 asi.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { LeadOrderInput } from "../lib/shopify";

const creados: LeadOrderInput[] = [];

vi.mock("@/lib/shopify", () => ({
  createLeadOrder: async (input: LeadOrderInput) => {
    creados.push(input);
    return { name: "#MIRH99999", total: "1110.00" };
  },
}));
vi.mock("@/lib/leads", () => ({
  getLead: async () => ({ id: 5, name: "Marvin Enrique Guzmán", phone: "50498629003" }),
  markLeadWonByAdvisor: async () => undefined,
}));
vi.mock("@/lib/identidad", () => ({
  vendedoraEfectiva: () => 2,
  tiendasPermitidas: () => null,
  identidadActual: () => null,
}));

async function crearPedido(store: string) {
  const { POST } = await import("../app/api/leads/[leadId]/order/route");
  const body = {
    store,
    items: [{ variant_id: 1, title: "Fat‑Burn Shorts", price: "1110", quantity: 1 }],
    shipping: { name: "Marvin Enrique Guzmán", province: "Cortés", canton: "San Pedro Sula", address: "Col. Trejo" },
  };
  return POST(new NextRequest("http://localhost/api/leads/5/order", { method: "POST", body: JSON.stringify(body) }), {
    params: { leadId: "5" },
  });
}

beforeEach(() => {
  creados.length = 0;
  process.env.SHOPIFY_HN_SHOP_DOMAIN = "mireva-hn.myshopify.com";
  process.env.SHOPIFY_HN_ACCESS_TOKEN = "token-de-prueba";
  process.env.SHOPIFY_CR_SHOP_DOMAIN = "mireva-cr.myshopify.com";
  process.env.SHOPIFY_CR_ACCESS_TOKEN = "token-de-prueba";
});

describe("país del pedido creado desde el tablero", () => {
  it("un pedido de Honduras sale con dirección en Honduras", async () => {
    const res = await crearPedido("mireva-hn");
    expect(res.status).toBe(200);
    expect(creados[0].shipping_address).toMatchObject({ country: "Honduras", country_code: "HN", city: "San Pedro Sula" });
  });

  it("uno de Costa Rica, en Costa Rica", async () => {
    await crearPedido("mireva-cr");
    expect(creados[0].shipping_address).toMatchObject({ country: "Costa Rica", country_code: "CR" });
  });
});
