// Tablero de Marketing (estructura "TOTAL DE VENTAS" del dueño).
//
// POR QUE ESTE TEST EXISTE: el tablero junta Meta (USD) y TikTok (PEN) con los
// pedidos reales de Kairo para decidir dónde poner la plata. Si un monto en
// soles se suma como dólares, si "ventas TikTok" se resta mal de los pedidos
// o si una alerta de escalar ignora el stock, el dueño sube presupuesto a una
// campaña que no lo merece.

import { describe, expect, it } from "vitest";
import type { MarketingSummary } from "../lib/marketing";
import type { MarketingSources } from "../lib/marketing-source-types";
import type { MarketingSettings } from "../lib/marketing-settings-types";
import type { CharlieReport, UsdRate } from "../lib/marketing-charlie-types";
import {
  alertasTablero,
  anunciosClicsCompras,
  campanasPorCuenta,
  costoPorProducto,
  estadoAnuncio,
  nombreComparable,
  pedidosPorDiaSemana,
  resumenPlataforma,
  stockPorProducto,
  tendenciaProductos,
  totalesTablero,
  ventanas,
} from "../lib/marketing-tablero";
import { contarOrigenes, leerInventario, origenPedido } from "../lib/marketing-origen";

const fx: UsdRate = {
  rate: 500,
  date: "2026-11-03",
  source: "hacienda",
  checkedAt: "",
  message: "",
  pen: { rate: 4, date: "2026-11-03", source: "bcrp" },
};

const listo = <T,>(data: T) => ({ status: "ready" as const, checkedAt: "", message: "", data });

function fuentes(): MarketingSources {
  return {
    meta: listo({
      accounts: [
        {
          accountId: "111",
          accountName: "Madre",
          currency: "USD",
          timezone: "America/Costa_Rica",
          campaigns: [
            {
              id: "m1",
              name: "Shilajit",
              spend: 100,
              impressions: 0,
              clicks: 500,
              purchases: 20,
              dailyBudget: 30,
              effectiveStatus: "ACTIVE",
              daily: [
                { date: "2026-11-03", spend: 10, impressions: 0, clicks: 0, purchases: 2 },
                { date: "2026-11-02", spend: 20, impressions: 0, clicks: 0, purchases: 3 },
                { date: "2026-10-30", spend: 70, impressions: 0, clicks: 0, purchases: 15 },
              ],
            },
            { id: "m2", name: "Prueba", spend: 40, impressions: 0, clicks: 300, purchases: 2, effectiveStatus: "PAUSED" },
            { id: "m3", name: "Apagada", spend: 0, impressions: 0, clicks: 0, purchases: 0, effectiveStatus: "PAUSED" },
          ],
        },
      ],
    }),
    tiktok: listo({
      accounts: [
        {
          accountId: "777",
          accountName: "TikTok CR",
          currency: "PEN",
          timezone: "",
          campaigns: [
            {
              id: "t1",
              name: "Neocell",
              spend: 200,
              impressions: 0,
              clicks: 50,
              purchases: 5,
              daily: [{ date: "2026-11-02", spend: 40, impressions: 0, clicks: 0, purchases: 1 }],
            },
          ],
        },
      ],
    }),
    shiphero: { status: "pending", checkedAt: "", message: "", data: null },
  };
}

const settings: MarketingSettings = {
  mappings: [
    { platform: "meta", account_id: "111", campaign_id: "m1", product_key: "sku:shi", product_name: "Shilajit", sku: "SHI" },
    { platform: "tiktok", account_id: "777", campaign_id: "t1", product_key: "sku:neo", product_name: "Neocell", sku: "NEO" },
  ],
  plans: [],
};

function producto(key: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    sku: "",
    name,
    orders: 0,
    units: 0,
    delivered: 0,
    failed: 0,
    open: 0,
    deliveryRate: null,
    todayOrders: 0,
    yesterdayOrders: 0,
    sevenDayOrders: 0,
    recentUnits: 0,
    previousOrders: 0,
    daily: [],
    ...extra,
  };
}

const summary = {
  totals: { generated: 40, annulled: 3 },
  daily: [
    { date: "2026-11-02", generated: 10 },
    { date: "2026-11-03", generated: 30 },
  ],
  products: [
    producto("sku:shi", "Shilajit", { todayOrders: 2, yesterdayOrders: 4, sevenDayOrders: 25, orders: 30 }),
    producto("sku:neo", "Neocell", { yesterdayOrders: 2, sevenDayOrders: 2, orders: 2 }),
    producto("sku:nada", "Sin ventas"),
  ],
} as unknown as MarketingSummary;

describe("plataformas y totales", () => {
  it("convierte TikTok de soles a dólares y saca el CPA con las compras del pixel", () => {
    const meta = resumenPlataforma(fuentes(), "meta", fx);
    const tiktok = resumenPlataforma(fuentes(), "tiktok", fx);
    expect(meta).toMatchObject({ gastoUsd: 140, compras: 22, cuentas: 1, sinConvertir: false });
    expect(tiktok).toMatchObject({ gastoUsd: 50, compras: 5, cpa: 10 });
  });

  it("sin tipo de cambio PEN, TikTok queda sin convertir (no se suma como dólares)", () => {
    const tiktok = resumenPlataforma(fuentes(), "tiktok", { ...fx, pen: null });
    expect(tiktok).toMatchObject({ gastoUsd: null, sinConvertir: true, cpa: null });
    const t = totalesTablero(40, [resumenPlataforma(fuentes(), "meta", fx), tiktok]);
    expect(t).toMatchObject({ gastoUsd: 140, parcial: true });
  });

  it("lo que ninguna plataforma reclama son las ventas orgánicas/upsell; si reclaman de más, se avisa", () => {
    const plataformas = [resumenPlataforma(fuentes(), "meta", fx), resumenPlataforma(fuentes(), "tiktok", fx)];
    expect(totalesTablero(40, plataformas)).toMatchObject({ gastoUsd: 190, cpa: 4.75, sinPlataforma: 13, sobreatribucion: 0 });
    expect(totalesTablero(20, plataformas)).toMatchObject({ sinPlataforma: 0, sobreatribucion: 7 });
  });
});

describe("CPA por producto: hoy, ayer, 7 días", () => {
  it("las ventanas son hoy, ayer y los 7 días completos antes de hoy", () => {
    const v = ventanas("2026-11-03");
    expect(v.ayer).toEqual(["2026-11-02"]);
    expect(v.siete[0]).toBe("2026-10-27");
    expect(v.siete[6]).toBe("2026-11-02");
  });

  it("gasto de las campañas asignadas entre los pedidos del producto, en USD", () => {
    const r = costoPorProducto(summary, fuentes(), settings, fx, "2026-11-03");
    const shi = r.filas.find((f) => f.key === "sku:shi")!;
    expect(shi.hoy).toEqual({ pedidos: 2, gastoUsd: 10, cpa: 5 });
    expect(shi.ayer).toEqual({ pedidos: 4, gastoUsd: 20, cpa: 5 });
    expect(shi.siete).toEqual({ pedidos: 25, gastoUsd: 90, cpa: 3.6 });
    const neo = r.filas.find((f) => f.key === "sku:neo")!;
    // 40 PEN / 4 = 10 USD, 2 pedidos.
    expect(neo.ayer).toEqual({ pedidos: 2, gastoUsd: 10, cpa: 5 });
    expect(neo.hoy).toEqual({ pedidos: 0, gastoUsd: 0, cpa: null });
    // Un producto sin pedidos ni gasto no ocupa fila.
    expect(r.filas.map((f) => f.key)).not.toContain("sku:nada");
  });

  it("sin asignaciones no hay CPA (no se inventa el gasto del producto)", () => {
    const r = costoPorProducto(summary, fuentes(), null, fx, "2026-11-03");
    expect(r.filas[0].siete.gastoUsd).toBeNull();
    expect(r.filas[0].siete.cpa).toBeNull();
  });
});

describe("stock", () => {
  it("ShipHero manda; si no, iComfly por nombre; sin control queda sin dato", () => {
    const st = stockPorProducto(
      [
        { key: "a", name: "Cápsulas de Shilajit", available: 300, recentUnits: 70 },
        { key: "b", name: "1x Crema para Peinar", available: null, recentUnits: 14 },
        { key: "c", name: "Colágeno Neocell", available: null, recentUnits: 7 },
      ],
      [
        { nombre: "CREMA PARA PEINAR", stock: 20 },
        { nombre: "Colágeno Neocell", stock: null },
      ]
    );
    expect(st.get("a")).toEqual({ disponible: 300, fuente: "shiphero", dias: 30 });
    expect(st.get("b")).toEqual({ disponible: 20, fuente: "icomfly", dias: 10 });
    expect(st.get("c")).toEqual({ disponible: null, fuente: null, dias: null });
    expect(nombreComparable("Cápsulas  de Shilajit™")).toBe("capsulas de shilajit");
  });
});

describe("campañas por cuenta", () => {
  it("una tabla por cuenta, en USD, sin campañas apagadas y sin gasto", () => {
    const cuentas = campanasPorCuenta(fuentes(), settings, fx);
    expect(cuentas.map((c) => c.nombre)).toEqual(["Madre", "TikTok CR"]);
    expect(cuentas[0].campanas.map((c) => c.id)).toEqual(["m1", "m2"]);
    expect(cuentas[0]).toMatchObject({ gastoUsd: 140, compras: 22, presupuestoUsd: 30 });
    expect(cuentas[0].campanas[0]).toMatchObject({ cpa: 5, productoNombre: "Shilajit" });
    expect(cuentas[1].campanas[0]).toMatchObject({ gastoUsd: 50, cpa: 10, presupuestoUsd: null });
  });
});

describe("ritmo", () => {
  it("promedio por día de la semana", () => {
    const dias = pedidosPorDiaSemana([
      { date: "2026-11-02", generated: 10 }, // lunes
      { date: "2026-11-09", generated: 20 }, // lunes
      { date: "2026-11-03", generated: 5 }, // martes
    ]);
    expect(dias[0]).toEqual({ dia: "Lunes", pedidos: 30, veces: 2, promedio: 15 });
    expect(dias[1].promedio).toBe(5);
    expect(dias[2].promedio).toBeNull();
  });

  it("tendencia semanal cuando el período pasa de 14 días", () => {
    const fechas = Array.from({ length: 21 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const s = {
      daily: fechas.map((date) => ({ date, generated: 1 })),
      products: [producto("x", "X", { orders: 21, daily: fechas.map((date) => ({ date, orders: 1 })) })],
    } as unknown as MarketingSummary;
    const t = tendenciaProductos(s);
    expect(t.semanal).toBe(true);
    expect(t.cortes).toHaveLength(3);
    expect(t.series[0].puntos).toEqual([7, 7, 7]);
  });

  it("las semanas se cuentan desde el último día: un bloque inicial corto no aparece como caída", () => {
    const fechas = Array.from({ length: 23 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const s = {
      daily: fechas.map((date) => ({ date, generated: 1 })),
      products: [producto("x", "X", { orders: 23, daily: fechas.map((date) => ({ date, orders: 1 })) })],
    } as unknown as MarketingSummary;
    const t = tendenciaProductos(s);
    expect(t.cortes).toEqual([
      { desde: "2026-10-03", hasta: "2026-10-09" },
      { desde: "2026-10-10", hasta: "2026-10-16" },
      { desde: "2026-10-17", hasta: "2026-10-23" },
    ]);
    expect(t.series[0].puntos).toEqual([7, 7, 7]);
  });
});

describe("anuncios con muchos clics y pocas compras", () => {
  it("revisar desde 100 clics con menos de 1 compra cada 100", () => {
    expect(estadoAnuncio(150, 1)).toBe("revisar");
    expect(estadoAnuncio(80, 0)).toBe("observar");
    expect(estadoAnuncio(150, 2)).toBe("bien");
  });

  it("suma solo los días del período y asigna el producto por la campaña", () => {
    const dia = (date: string, clicks: number, purchases: number) => ({
      date,
      spend: 10,
      impressions: 0,
      clicks,
      frequency: null,
      purchases,
      purchaseValue: null,
      interactions: 0,
    });
    const report: CharlieReport = listo({
      from: "2026-11-01",
      to: "2026-11-03",
      trailFrom: "2026-10-25",
      trailTo: "2026-11-03",
      accounts: [
        {
          id: "111",
          name: "Madre",
          currency: "USD",
          timezone: "",
          adsets: [],
          ads: [
            {
              id: "a1",
              name: "Video 1",
              adsetId: "",
              campaignId: "m1",
              effectiveStatus: "ACTIVE",
              postId: null,
              creativeId: null,
              assets: null,
              daily: [dia("2026-10-28", 900, 0), dia("2026-11-02", 120, 1)],
            },
          ],
        },
        {
          id: "777",
          name: "TikTok · CR",
          currency: "PEN",
          timezone: "",
          adsets: [],
          ads: [
            {
              id: "t9",
              name: "Tik 1",
              adsetId: "",
              campaignId: "t1",
              effectiveStatus: "ACTIVE",
              postId: null,
              creativeId: null,
              assets: null,
              daily: [dia("2026-11-03", 60, 3)],
            },
          ],
        },
      ],
    });
    const filas = anunciosClicsCompras(report, settings, fx, "2026-11-01", "2026-11-03");
    expect(filas[0]).toMatchObject({ nombre: "Video 1", clics: 120, compras: 1, estado: "revisar", productoNombre: "Shilajit", gastoUsd: 10 });
    expect(filas[1]).toMatchObject({ plataforma: "tiktok", cuenta: "CR", estado: "bien", gastoUsd: 2.5, productoNombre: "Neocell" });
  });
});

describe("alertas", () => {
  it("escalar exige CPA en objetivo, compras y stock no bajo; CPA alto con gasto significativo", () => {
    const cuentas = campanasPorCuenta(fuentes(), settings, fx);
    const productos = costoPorProducto(summary, fuentes(), settings, fx, "2026-11-03").filas;
    const sinStock = new Map();
    const a = alertasTablero({ cuentas, productos, stock: sinStock, anuncios: [], diasPeriodo: 7, hayInventario: false });
    const keys = a.map((x) => x.key);
    expect(keys).toContain("escalar:meta:111:m1");
    expect(keys).toContain("escalar-producto:sku:shi");
    expect(keys).toContain("cpa:meta:111:m2"); // USD 20 por compra con USD 40 gastados
    expect(keys).toContain("cpa:tiktok:777:t1"); // USD 10 > 8.50 con USD 50
    expect(keys).toContain("stock:sin-inventario");
    expect(a.find((x) => x.key === "escalar:meta:111:m1")?.detalle).toContain("stock sin verificar");

    const bajo = new Map([["sku:shi", { disponible: 40, fuente: "icomfly" as const, dias: 4 }]]);
    const b = alertasTablero({ cuentas, productos, stock: bajo, anuncios: [], diasPeriodo: 7, hayInventario: true });
    const keysB = b.map((x) => x.key);
    expect(keysB).not.toContain("escalar:meta:111:m1");
    expect(keysB).not.toContain("escalar-producto:sku:shi");
    expect(keysB).toContain("stock:sku:shi");
    expect(keysB).not.toContain("stock:sin-inventario");

    // Con un solo día no se sugiere escalar campañas.
    const c = alertasTablero({ cuentas, productos, stock: sinStock, anuncios: [], diasPeriodo: 1, hayInventario: false });
    expect(c.map((x) => x.key)).not.toContain("escalar:meta:111:m1");
  });
});

describe("origen de los pedidos e inventario de iComfly", () => {
  it("el número de iComfly dice por dónde entró el pedido", () => {
    expect(origenPedido("#179373804036142000")).toBe("web");
    expect(origenPedido("MANUAL-1793736882878-71U8L")).toBe("manual");
    expect(origenPedido("EXCEL-MVMPVFBE-1UNUD")).toBe("manual");
    expect(origenPedido("SHOP-MVZQH6ZJ-K8QR")).toBe("shopify");
    expect(origenPedido("82245")).toBe("icomfly");
    expect(origenPedido("#MCRC1")).toBe("otro");
    expect(contarOrigenes(["#179373804036142000", "82245", "82246"], 1)).toEqual({
      total: 3,
      porOrigen: { web: 1, manual: 0, icomfly: 2, shopify: 0, otro: 0 },
      upsells: 1,
    });
  });

  it("lee consultar_inventario: stock null es 'sin control', no cero", () => {
    expect(
      leerInventario({
        productos: [
          { id: "1", name: "Shilajit", stock: null },
          { id: "2", name: "Crema", stock: 3 },
          { id: "3", name: "", stock: 1 },
        ],
      })
    ).toEqual([
      { nombre: "Shilajit", stock: null },
      { nombre: "Crema", stock: 3 },
    ]);
  });
});
