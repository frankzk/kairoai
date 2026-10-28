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
let visible=true;
let creationTimeout=false;
const receipts: import("../lib/icomfly-receipts").Receipt[]=[];
vi.mock("@/lib/icomfly-confirmation",()=>({verifyCreatedIcomflyOrder:async()=>visible?{id:"729032",orderNumber:"MANUAL-123-ABC",total:1110}:null}));
vi.mock("@/lib/icomfly-receipts",()=>({
 findReceipt:async(store:number,lead:number,key:string)=>receipts.find(r=>r.store_id===store&&r.lead_id===lead&&(r.request_id===key||!r.confirmed_at))??null,
 reserveReceipt:async(r:import("../lib/icomfly-receipts").Receipt)=>{if(receipts.some(x=>x.store_id===r.store_id&&x.lead_id===r.lead_id&&!x.confirmed_at))return false;receipts.push(r);return true;},
 saveReceiptId:async(r:import("../lib/icomfly-receipts").Receipt,id:string)=>{r.icomfly_id=id;},
 confirmReceipt:async(r:import("../lib/icomfly-receipts").Receipt)=>{r.confirmed_at=new Date().toISOString();}
}));

vi.mock("@/lib/icomfly-mcp", () => ({
  verificarTiendaMcp: async () =>
    claveDeOtraTienda ? "La clave de iComfly de Mireva Honduras es de Mireva Costa Rica (tienda 71, se esperaba la 90)" : null,
  llamarHerramientaIcomfly: async (tienda: string, nombre: string, args: Record<string, unknown>) => {
    llamadas.push({ tienda, nombre, args });
    if (nombre === "consultar_producto") {
      return { encontrados: 1, productos: [{ id: "3456", name: "Fat‑Burn Shorts" }] };
    }
    if(creationTimeout)throw new Error("timeout");
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
    request_id:"12345678-1234-4234-8234-123456789abc",
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
  receipts.length=0;
  visible=true;
  creationTimeout=false;
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

  it("Costa Rica crea en su conector de iComfly y atribuye el pedido a su tienda", async () => {
    const res = await crear("mireva-cr", { name: "Prueba", province: "San José", canton: "San José", address: "Dirección de prueba" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, destino: "icomfly", icomfly_id: "729032", order_name: "IC-729032" });
    expect(llamadas.find((l) => l.nombre === "crear_pedido")).toMatchObject({
      tienda: "mireva-cr",
      args: { ciudad: "San José", departamento: "San José", metodo_pago: "Contraentrega" },
    });
    expect(ganados).toEqual([expect.objectContaining({ storeId: 1, shopifyOrderName: "IC-729032" })]);
    expect(shopifyCreados).toBe(0);
  });

  it("el botón se oculta solo en las tiendas apagadas", async () => {
    const { creaEnIcomfly } = await import("../lib/icomfly-pedido-lead");
    expect(creaEnIcomfly("mireva-cr")).toBe(true);
    expect(creaEnIcomfly("mireva-hn")).toBe(true);
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
    expect(data.aviso).toMatch(/El pedido se verificó/);
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
describe("Confirmación independiente y reintentos",()=>{
 it("el ID de creación por sí solo no confirma ni marca Ganado",async()=>{
  visible=false;
  const r=await crear("mireva-cr");
  expect(r.status).toBe(202);
  expect(await r.json()).toMatchObject({ok:false,pending:true,icomfly_id:"729032"});
  expect(ganados).toEqual([]);
 });
 it("al aparecer en el listado verifica el mismo intento sin volver a crear",async()=>{
  visible=false;await crear("mireva-cr");visible=true;
  const r=await crear("mireva-cr");
  expect(await r.json()).toMatchObject({ok:true,verified:true,order_name:"IC-729032"});
  expect(llamadas.filter(l=>l.nombre==="crear_pedido")).toHaveLength(1);
  expect(ganados).toHaveLength(1);
  await crear("mireva-cr");
  expect(ganados).toHaveLength(1);
 });
 it("un timeout conserva el intento y nunca lo reenvía automáticamente",async()=>{
  creationTimeout=true;
  const first=await crear("mireva-cr");expect(first.status).toBe(202);
  const retry=await crear("mireva-cr");expect(retry.status).toBe(202);
  expect(llamadas.filter(l=>l.nombre==="crear_pedido")).toHaveLength(1);
  expect(ganados).toHaveLength(0);
 });
});
