// "Crear en iComfly" desde el tablero de Leads.
//
// POR QUE ESTE TEST EXISTE: desde el 28/10/2026 Shopify esta suspendido y la
// asesora crea el pedido en iComfly. Tiene que crearse en la tienda del lead,
// con el numero que devuelve iComfly, y nunca en Shopify. Y si el pedido ya se
// creo pero marcar el lead falla, NO puede volver como error: la asesora
// reintentaria y crearia otro pedido.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const llamadas: Array<{ tienda: string; nombre: string; args: Record<string, unknown> }> = [];
const ganados: Array<{ storeId: number; shopifyOrderName: string }> = [];
let shopifyCreados = 0;
let fallaMarcar = false;
let claveDeOtraTienda = false;

vi.mock("@/lib/icomfly-mcp", () => ({
  verificarTiendaMcp: async () =>
    claveDeOtraTienda ? "La clave de iComfly de Mireva Honduras es de Mireva Costa Rica (tienda 71, se esperaba la 90)" : null,
  llamarHerramientaIcomfly: async (tienda: string, nombre: string, args: Record<string, unknown>) => {
    llamadas.push({ tienda, nombre, args });
    if (nombre === "consultar_producto") {
      return { encontrados: 1, productos: [{ id: "3456", name: "Fat‑Burn Shorts" }] };
    }
    return { ok: true, pedido: { id: 729032, order_number: "EXCEL-MVMPVFBE-1UNUD", total: "1110.00" } };
  },
}));
vi.mock("@/lib/icomfly-sync", () => ({ runIcomflySync: async () => ({}) }));
vi.mock("@/lib/shopify", () => ({
  createLeadOrder: async () => {
    shopifyCreados++;
    return { name: "#MIRH99999", total: "1110.00" };
  },
}));
vi.mock("@/lib/leads", () => ({
  getLead: async () => ({ id: 5, name: "Marvin Enrique Guzmán", phone: "50498629003" }),
  markLeadWonByAdvisor: async (opts: { storeId: number; shopifyOrderName: string }) => {
    if (fallaMarcar) throw new Error("db caida");
    ganados.push(opts);
  },
}));
vi.mock("@/lib/identidad", () => ({
  vendedoraEfectiva: () => 2,
  tiendasPermitidas: () => null,
  identidadActual: () => null,
}));

const ENVIO = { name: "Marvin Enrique Guzmán", province: "Cortés", canton: "San Pedro Sula", address: "Col. Trejo" };

async function crear(store: string, shipping: Record<string, string> = ENVIO) {
  const { POST } = await import("../app/api/leads/[leadId]/order/route");
  const body = {
    store,
    destino: "icomfly",
    items: [{ variant_id: 1, title: "Fat-Burn Shorts - Negro / L", product_title: "Fat-Burn Shorts", variant_title: "Negro / L", price: "1110", quantity: 1 }],
    shipping,
  };
  return POST(new NextRequest("http://localhost/api/leads/5/order", { method: "POST", body: JSON.stringify(body) }), {
    params: { leadId: "5" },
  });
}

beforeEach(() => {
  delete process.env.CREAR_EN_ICOMFLY_APAGADO;
  llamadas.length = 0;
  ganados.length = 0;
  shopifyCreados = 0;
  fallaMarcar = false;
  claveDeOtraTienda = false;
});

describe("Crear en iComfly", () => {
  it("crea el pedido en iComfly de la tienda del lead, no en Shopify, y devuelve su número", async () => {
    const res = await crear("mireva-hn");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, destino: "icomfly", order_name: "IC-729032", icomfly_id: "729032" });
    expect(shopifyCreados).toBe(0);
    const crearPedido = llamadas.find((l) => l.nombre === "crear_pedido")!;
    expect(crearPedido.tienda).toBe("mireva-hn");
    expect(crearPedido.args).toMatchObject({
      nombre_cliente: "Marvin Enrique Guzmán",
      telefono: "50498629003",
      ciudad: "San Pedro Sula",
      departamento: "Cortés",
      producto_nombre: "Fat‑Burn Shorts - Negro / L",
      product_id: 3456,
      total: 1110,
    });
    expect(ganados).toEqual([expect.objectContaining({ storeId: 2, shopifyOrderName: "IC-729032" })]);
  });

  it("Costa Rica, con la clave de Costa Rica", async () => {
    await crear("mireva-cr");
    expect(llamadas.map((l) => l.nombre)).toContain("crear_pedido");
    expect(llamadas.every((l) => l.tienda === "mireva-cr")).toBe(true);
  });

  it("sin dirección, ciudad o departamento no llama a iComfly y dice qué falta", async () => {
    const res = await crear("mireva-hn", { name: "Marvin", province: "Cortés", canton: "", address: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/dirección exacta, Municipio/);
    expect(llamadas).toEqual([]);
  });

  it("si el pedido se creó pero el lead no se pudo marcar, avisa sin devolver error", async () => {
    fallaMarcar = true;
    const res = await crear("mireva-hn");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.order_name).toBe("IC-729032");
    expect(data.aviso).toMatch(/El pedido se creó/);
  });

  it("con la clave de otra tienda no crea nada y lo dice", async () => {
    claveDeOtraTienda = true;
    const res = await crear("mireva-hn");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/es de Mireva Costa Rica/);
    expect(llamadas).toEqual([]);
    expect(ganados).toEqual([]);
  });

  it("apagado (CREAR_EN_ICOMFLY_APAGADO=1) no crea nada aunque la pantalla lo pida", async () => {
    process.env.CREAR_EN_ICOMFLY_APAGADO = "1";
    const res = await crear("mireva-hn");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/desactivado/);
    expect(llamadas).toEqual([]);
    expect(ganados).toEqual([]);
    expect(shopifyCreados).toBe(0);
  });
});
