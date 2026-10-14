// Generar el pedido desde el borrador que dejo el cliente en Shopify.
//
// POR QUE ESTE TEST EXISTE: hay clientes que tocaron "Confirmo mi pedido" y el
// pedido nunca se creo (el 14/10/2026: 8% en Costa Rica y 40% en Honduras en
// 60 dias). La asesora ahora lo genera con un clic desde el borrador. Es una
// accion hacia afuera: crea un pedido REAL que va a despacho y no se deshace.
// Por eso se prueba que nunca complete el borrador de OTRO cliente, ni uno ya
// convertido, ni a quien ya tiene pedido, ni un borrador sin direccion.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { etiquetasDelPedido, notaDelPedido, problemaParaGenerar } from "../lib/leads-borrador";
import { exigenciaDe } from "../lib/permisos";
import type { ShopifyDraftOrderDetail } from "../lib/shopify";

function borrador(over: Partial<ShopifyDraftOrderDetail> = {}): ShopifyDraftOrderDetail {
  return {
    id: 1626647429374,
    name: "#D7991",
    status: "open",
    order_id: null,
    phone: "+50498629003",
    total_price: "1110.00",
    currency: "HNL",
    note: "Pedido desde el formulario COD",
    tags: "formulario",
    line_items: [{ title: "Fat‑Burn Shorts", quantity: 1 }],
    shipping_address: { address1: "Col. Trejo, casa 12", city: "San Pedro Sula", province: "Cortés" },
    ...over,
  };
}
const SIN_PEDIDO = { has_order: false, shopify_order_name: null };

describe("problemaParaGenerar", () => {
  it("un borrador abierto, con productos y dirección, de un cliente sin pedido: se puede", () => {
    expect(problemaParaGenerar(SIN_PEDIDO, borrador())).toBeNull();
  });
  it("no convierte dos veces el mismo borrador", () => {
    expect(problemaParaGenerar(SIN_PEDIDO, borrador({ status: "completed" }))).toMatch(/ya se convirtió/);
    expect(problemaParaGenerar(SIN_PEDIDO, borrador({ order_id: 99 }))).toMatch(/ya se convirtió/);
  });
  it("no genera otro pedido a quien ya tiene uno", () => {
    expect(problemaParaGenerar({ has_order: true, shopify_order_name: "#MIRH20532" }, borrador())).toMatch(/#MIRH20532/);
  });
  it("no genera un pedido sin dirección ni sin productos", () => {
    expect(problemaParaGenerar(SIN_PEDIDO, borrador({ shipping_address: null }))).toMatch(/dirección/);
    expect(problemaParaGenerar(SIN_PEDIDO, borrador({ shipping_address: { address1: "  " } }))).toMatch(/dirección/);
    expect(problemaParaGenerar(SIN_PEDIDO, borrador({ line_items: [] }))).toMatch(/productos/);
  });
});

describe("nota y etiquetas", () => {
  it("agrega la línea de Kairo sin borrar la nota del formulario", () => {
    const nota = notaDelPedido("Pedido desde el formulario COD", "Leny", new Date("2026-10-14T18:00:00Z"));
    expect(nota).toMatch(/^Pedido desde el formulario COD\n/);
    expect(nota).toMatch(/Generado desde el borrador por Leny en Kairo .* el 14\/10\/2026/);
  });
  it("suma las etiquetas de Kairo sin repetir", () => {
    expect(etiquetasDelPedido("formulario, kairo_leads")).toBe("formulario, kairo_leads, cerrado_por_asesora, desde_borrador");
    expect(etiquetasDelPedido(null)).toBe("cerrado_por_asesora, kairo_leads, desde_borrador");
  });
});

describe("permiso", () => {
  it("solo quien trabaja Leads puede generar pedidos desde el borrador", () => {
    const exige = exigenciaDe("/api/leads/48412029/carts/complete", "POST");
    expect(exige).toMatchObject({ tipo: "permiso" });
    expect(JSON.stringify(exige)).toMatch(/leads/);
    expect(JSON.stringify(exige)).not.toMatch(/novedades/);
  });
});

// ─── La ruta ─────────────────────────────────────────────────────────────────

let filaGuardada: { id: number; shopify_draft_order_name: string } | null = null;
let lead: { id: number; has_order: boolean; shopify_order_name: string | null } | null = null;
let draftEnShopify = borrador();
const convertidos: Array<{ id: string | number; extra: { note: string; tags: string } }> = [];
const ganados: Array<Record<string, unknown>> = [];
const filtrosBorrador: unknown[][] = [];
const cierres: unknown[] = [];

vi.mock("@/lib/db", () => ({
  getDB: () => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      from: () => q,
      select: () => q,
      eq: (...args: unknown[]) => {
        filtrosBorrador.push(args);
        return q;
      },
      maybeSingle: async () => ({ data: filaGuardada, error: null }),
      update: (patch: unknown) => {
        cierres.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    });
    return q;
  },
}));
vi.mock("@/lib/shopify", () => ({
  getDraftOrder: async () => draftEnShopify,
  convertirBorradorEnPedido: async (id: string | number, extra: { note: string; tags: string }) => {
    convertidos.push({ id, extra });
    return { order_id: 1, name: "#MIRH20999", total: "1110.00" };
  },
}));
vi.mock("@/lib/leads", () => ({
  getLead: async () => lead,
  markLeadWonByAdvisor: async (opts: Record<string, unknown>) => {
    ganados.push(opts);
  },
}));
vi.mock("@/lib/identidad", () => ({
  vendedoraEfectiva: () => 2,
  actorActual: () => "Leny",
  tiendasPermitidas: () => null,
  identidadActual: () => null,
}));

async function generar(body: Record<string, unknown> = { store: "mireva-hn", draft_id: "1626647429374", vendedora_id: 2 }) {
  const { POST } = await import("../app/api/leads/[leadId]/carts/complete/route");
  return POST(new NextRequest("http://localhost/api/leads/48412029/carts/complete", { method: "POST", body: JSON.stringify(body) }), {
    params: { leadId: "48412029" },
  });
}

beforeEach(() => {
  filaGuardada = { id: 77, shopify_draft_order_name: "#D7991" };
  lead = { id: 48412029, has_order: false, shopify_order_name: null };
  draftEnShopify = borrador();
  convertidos.length = 0;
  ganados.length = 0;
  filtrosBorrador.length = 0;
  cierres.length = 0;
  process.env.SHOPIFY_HN_SHOP_DOMAIN = "mireva-hn.myshopify.com";
  process.env.SHOPIFY_HN_ACCESS_TOKEN = "token-de-prueba";
});

describe("POST /api/leads/:id/carts/complete", () => {
  it("convierte el borrador del cliente en pedido, lo marca ganado a nombre de la asesora y cierra el carrito", async () => {
    const res = await generar();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, order_name: "#MIRH20999", draft_name: "#D7991" });

    expect(convertidos).toHaveLength(1);
    expect(convertidos[0].id).toBe("1626647429374");
    expect(convertidos[0].extra.note).toMatch(/Generado desde el borrador por Leny/);
    expect(convertidos[0].extra.tags).toMatch(/desde_borrador/);

    expect(ganados[0]).toMatchObject({ leadId: 48412029, vendedora: 2, shopifyOrderName: "#MIRH20999" });
    expect(cierres[0]).toMatchObject({ is_open: false, status: "completed" });
  });

  it("busca el borrador entre los DE ESTE lead; si no es suyo, no toca Shopify", async () => {
    filaGuardada = null;
    const res = await generar();
    expect(res.status).toBe(404);
    expect(filtrosBorrador).toContainEqual(["lead_id", 48412029]);
    expect(filtrosBorrador).toContainEqual(["shopify_draft_order_id", "1626647429374"]);
    expect(convertidos).toHaveLength(0);
  });

  it("si el borrador ya se convirtió en Shopify, no genera otro pedido", async () => {
    draftEnShopify = borrador({ status: "completed", order_id: 5 });
    const res = await generar();
    expect(res.status).toBe(409);
    expect(convertidos).toHaveLength(0);
    expect(ganados).toHaveLength(0);
  });

  it("si el cliente ya tiene pedido, no genera otro", async () => {
    lead = { id: 48412029, has_order: true, shopify_order_name: "#MIRH20532" };
    const res = await generar();
    expect(res.status).toBe(409);
    expect(convertidos).toHaveLength(0);
  });

  it("rechaza un id de borrador que no es un número", async () => {
    const res = await generar({ store: "mireva-hn", draft_id: "1 OR 1=1", vendedora_id: 2 });
    expect(res.status).toBe(400);
    expect(convertidos).toHaveLength(0);
  });
});
