// Tablero de Marketing (03/11/2026): la estructura que pidio el dueño en
// "TOTAL DE VENTAS" para leer Meta y TikTok juntos y decidir.
//
// Todo en USD (Meta cobra en USD, TikTok en PEN; se convierte con el tipo del
// BCRP, ver lib/marketing-usd-rate.ts). Lo que no se puede convertir o no
// llega queda en null: la pantalla dice "Sin datos", nunca un cero inventado.
//
// Ventas por plataforma: los pedidos NO traen UTM ni campaña (medido el
// 03/11/2026 en iComfly y Shopify), asi que "ventas Meta" y "ventas TikTok"
// son las compras que reporta cada plataforma con su pixel. El resto de los
// pedidos reales de Kairo es lo que ninguna plataforma reclama (organico,
// WhatsApp, upsell, recompra). Si las plataformas reclaman mas compras que
// pedidos reales, se dice: es sobreatribucion, no ventas de mas.
//
// Costo por producto: el gasto de las campañas asignadas a cada producto
// (Marketing -> Productos y campañas) entre los pedidos de ese producto. La
// asignacion no atribuye pedidos a campañas.
//
// Puro: se prueba en tests/marketing-tablero.test.ts.

import type { MarketingSummary } from "./marketing";
import type { MarketingSources } from "./marketing-source-types";
import { campaignKey, type MarketingSettings } from "./marketing-settings-types";
import type { CharlieReport, UsdRate } from "./marketing-charlie-types";
import { asUsd } from "./marketing-usd-rate";
import { shiftDate } from "./marketing-dates";

export const CPA_OBJETIVO = 8.5;
export const STOCK_MINIMO = 100;
/** Gasto desde el que una campaña o producto ya dice algo: dos CPA objetivo. */
export const GASTO_SIGNIFICATIVO = 17;
export const CLICS_SIGNIFICATIVOS = 100;
/** Menos de 1 compra cada 100 clics. */
export const CONVERSION_MINIMA = 0.01;
/** Compras de la campaña en el periodo para pensar en escalarla. */
export const COMPRAS_PARA_ESCALAR = 10;
/** Pedidos del producto en 7 dias para pensar en escalarlo. */
export const PEDIDOS_PARA_ESCALAR = 20;
/** Dias de inventario al ritmo de los ultimos 7 dias. */
export const DIAS_STOCK_MINIMO = 7;

export type Plataforma = "meta" | "tiktok";
const NOMBRE: Record<Plataforma, string> = { meta: "Meta", tiktok: "TikTok" };

const redondear = (v: number) => Math.round(v * 100) / 100;
const dividir = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null);

// ─── Plataformas ─────────────────────────────────────────────────────────────

export interface ResumenPlataforma {
  plataforma: Plataforma;
  nombre: string;
  /** "ready" | "pending" | "error" de la fuente. */
  estado: string;
  cuentas: number;
  gastoUsd: number | null;
  /** Compras reportadas por la plataforma (pixel). */
  compras: number | null;
  cpa: number | null;
  /** Hay gasto en una moneda que no se pudo convertir. */
  sinConvertir: boolean;
}

export function resumenPlataforma(
  sources: MarketingSources | null,
  plataforma: Plataforma,
  fx: UsdRate | null
): ResumenPlataforma {
  const fuente = sources?.[plataforma];
  const base = { plataforma, nombre: NOMBRE[plataforma], estado: fuente?.status ?? "pending", cuentas: 0 };
  if (fuente?.status !== "ready" || !fuente.data)
    return { ...base, gastoUsd: null, compras: null, cpa: null, sinConvertir: false };
  let gasto = 0;
  let sinConvertir = false;
  let compras: number | null = null;
  for (const cuenta of fuente.data.accounts) {
    for (const c of cuenta.campaigns) {
      const usd = asUsd(c.spend, cuenta.currency, fx);
      if (usd == null) {
        if (c.spend > 0) sinConvertir = true;
      } else gasto += usd;
      if (c.purchases != null) compras = (compras ?? 0) + c.purchases;
    }
  }
  const gastoUsd = sinConvertir ? null : redondear(gasto);
  return {
    ...base,
    cuentas: fuente.data.accounts.length,
    gastoUsd,
    compras,
    cpa: dividir(gastoUsd, compras),
    sinConvertir,
  };
}

export interface Totales {
  pedidos: number;
  gastoUsd: number | null;
  cpa: number | null;
  /** Falta una plataforma o su gasto: el total es parcial. */
  parcial: boolean;
  /** Pedidos reales que ninguna plataforma reclama. */
  sinPlataforma: number | null;
  /** Las plataformas reportan mas compras que pedidos reales. */
  sobreatribucion: number;
}

export function totalesTablero(pedidos: number, plataformas: ResumenPlataforma[]): Totales {
  const listas = plataformas.filter((p) => p.estado === "ready");
  const conGasto = listas.filter((p) => p.gastoUsd != null);
  const gastoUsd = conGasto.length ? redondear(conGasto.reduce((s, p) => s + (p.gastoUsd ?? 0), 0)) : null;
  const reclamadas = listas.every((p) => p.compras != null) && listas.length
    ? listas.reduce((s, p) => s + (p.compras ?? 0), 0)
    : null;
  return {
    pedidos,
    gastoUsd,
    cpa: dividir(gastoUsd, pedidos),
    parcial: conGasto.length < plataformas.length,
    sinPlataforma: reclamadas == null ? null : Math.max(0, pedidos - reclamadas),
    sobreatribucion: reclamadas == null ? 0 : Math.max(0, Math.round(reclamadas - pedidos)),
  };
}

// ─── Costo y pedidos por producto (hoy, ayer, 7 dias) ────────────────────────

export interface Ventanas {
  hoy: string[];
  ayer: string[];
  siete: string[];
}

/** Hoy, ayer y los 7 dias completos antes de hoy (como en lib/marketing.ts). */
export function ventanas(hoy: string): Ventanas {
  return {
    hoy: [hoy],
    ayer: [shiftDate(hoy, -1)],
    siete: Array.from({ length: 7 }, (_, i) => shiftDate(hoy, i - 7)),
  };
}

export interface CeldaProducto {
  pedidos: number;
  gastoUsd: number | null;
  cpa: number | null;
}

export interface FilaProducto {
  key: string;
  nombre: string;
  sku: string;
  hoy: CeldaProducto;
  ayer: CeldaProducto;
  siete: CeldaProducto;
  campanas: number;
}

export interface CostoPorProducto {
  filas: FilaProducto[];
  /** Gasto de campañas sin producto asignado, por ventana (USD). */
  sinAsignar: { hoy: number; ayer: number; siete: number };
  /** Hay gasto que no se pudo convertir: los costos de esa ventana quedan sin dato. */
  sinConvertir: boolean;
}

export function costoPorProducto(
  summary: MarketingSummary,
  recientes: MarketingSources | null,
  settings: MarketingSettings | null,
  fx: UsdRate | null,
  hoy: string
): CostoPorProducto {
  const v = ventanas(hoy);
  const dias = { hoy: new Set(v.hoy), ayer: new Set(v.ayer), siete: new Set(v.siete) };
  const asignacion = new Map(
    (settings?.mappings ?? []).map((m) => [campaignKey(m.platform, m.account_id, m.campaign_id), m.product_key])
  );
  const gasto = new Map<string, { hoy: number; ayer: number; siete: number; campanas: Set<string> }>();
  const sinAsignar = { hoy: 0, ayer: 0, siete: 0 };
  let sinConvertir = false;
  for (const plataforma of ["meta", "tiktok"] as const) {
    const fuente = recientes?.[plataforma];
    if (fuente?.status !== "ready") continue;
    for (const cuenta of fuente.data?.accounts ?? [])
      for (const c of cuenta.campaigns) {
        const llave = campaignKey(plataforma, cuenta.accountId, c.id);
        const producto = asignacion.get(llave);
        for (const d of c.daily ?? []) {
          if (!(d.spend > 0)) continue;
          const usd = asUsd(d.spend, cuenta.currency, fx);
          if (usd == null) {
            sinConvertir = true;
            continue;
          }
          for (const ventana of ["hoy", "ayer", "siete"] as const) {
            if (!dias[ventana].has(d.date)) continue;
            if (!producto) sinAsignar[ventana] += usd;
            else {
              const g = gasto.get(producto) ?? { hoy: 0, ayer: 0, siete: 0, campanas: new Set<string>() };
              g[ventana] += usd;
              g.campanas.add(llave);
              gasto.set(producto, g);
            }
          }
        }
      }
  }
  const hayGasto = Boolean(settings) && !sinConvertir && (["meta", "tiktok"] as const).some((p) => recientes?.[p]?.status === "ready");
  const celda = (pedidos: number, usd: number | undefined): CeldaProducto => {
    const g = hayGasto ? redondear(usd ?? 0) : null;
    return { pedidos, gastoUsd: g, cpa: g != null && g > 0 ? dividir(g, pedidos) : null };
  };
  const filas = summary.products
    .map((p) => {
      const g = gasto.get(p.key);
      return {
        key: p.key,
        nombre: p.name,
        sku: p.sku,
        hoy: celda(p.todayOrders, g?.hoy),
        ayer: celda(p.yesterdayOrders, g?.ayer),
        siete: celda(p.sevenDayOrders, g?.siete),
        campanas: g?.campanas.size ?? 0,
      };
    })
    .filter((f) => f.hoy.pedidos + f.ayer.pedidos + f.siete.pedidos > 0 || (f.siete.gastoUsd ?? 0) > 0 || (f.hoy.gastoUsd ?? 0) > 0)
    .sort((a, b) => b.siete.pedidos - a.siete.pedidos || b.hoy.pedidos - a.hoy.pedidos || a.nombre.localeCompare(b.nombre));
  return {
    filas,
    sinAsignar: { hoy: redondear(sinAsignar.hoy), ayer: redondear(sinAsignar.ayer), siete: redondear(sinAsignar.siete) },
    sinConvertir,
  };
}

// ─── Stock ───────────────────────────────────────────────────────────────────

export interface ArticuloInventario {
  nombre: string;
  /** null: iComfly no lleva stock de ese producto. */
  stock: number | null;
}

export interface StockProducto {
  disponible: number | null;
  fuente: "shiphero" | "icomfly" | null;
  /** Dias de inventario al ritmo de los ultimos 7 dias, o null. */
  dias: number | null;
}

/** Nombre comparable: sin tildes, minusculas, solo letras y numeros. */
export function nombreComparable(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\d+x\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * El stock de cada producto: ShipHero por SKU cuando esta conectado; si no,
 * el inventario de iComfly por nombre. Un nombre que aparece dos veces con
 * stock distinto no se adivina.
 */
export function stockPorProducto(
  productos: Array<{ key: string; name: string; available: number | null; recentUnits: number }>,
  inventarioIcomfly: ArticuloInventario[] | null
): Map<string, StockProducto> {
  const porNombre = new Map<string, number | null | "ambiguo">();
  for (const a of inventarioIcomfly ?? []) {
    const n = nombreComparable(a.nombre);
    if (!n) continue;
    const previo = porNombre.get(n);
    porNombre.set(n, previo === undefined || previo === a.stock ? a.stock : previo == null ? a.stock : a.stock == null ? previo : "ambiguo");
  }
  const salida = new Map<string, StockProducto>();
  for (const p of productos) {
    const ritmo = p.recentUnits / 7;
    let disponible: number | null = null;
    let fuente: StockProducto["fuente"] = null;
    if (p.available != null) {
      disponible = p.available;
      fuente = "shiphero";
    } else {
      const encontrado = porNombre.get(nombreComparable(p.name));
      if (typeof encontrado === "number") {
        disponible = encontrado;
        fuente = "icomfly";
      }
    }
    salida.set(p.key, {
      disponible,
      fuente,
      dias: disponible != null && ritmo > 0 ? Math.max(0, disponible) / ritmo : null,
    });
  }
  return salida;
}

// ─── Campañas por cuenta ─────────────────────────────────────────────────────

export interface FilaCampana {
  key: string;
  id: string;
  nombre: string;
  estado: string;
  gastoUsd: number | null;
  compras: number | null;
  cpa: number | null;
  presupuestoUsd: number | null;
  clics: number;
  productoKey: string | null;
  productoNombre: string | null;
}

export interface CuentaCampanas {
  plataforma: Plataforma;
  cuentaId: string;
  nombre: string;
  moneda: string;
  gastoUsd: number | null;
  compras: number | null;
  cpa: number | null;
  presupuestoUsd: number | null;
  campanas: FilaCampana[];
}

const ACTIVA = new Set(["ACTIVE", "ENABLE", "CAMPAIGN_STATUS_ENABLE"]);

export function campanasPorCuenta(
  sources: MarketingSources | null,
  settings: MarketingSettings | null,
  fx: UsdRate | null
): CuentaCampanas[] {
  const asignacion = new Map((settings?.mappings ?? []).map((m) => [campaignKey(m.platform, m.account_id, m.campaign_id), m]));
  const cuentas: CuentaCampanas[] = [];
  for (const plataforma of ["meta", "tiktok"] as const) {
    const fuente = sources?.[plataforma];
    if (fuente?.status !== "ready") continue;
    for (const cuenta of fuente.data?.accounts ?? []) {
      const campanas = cuenta.campaigns
        .filter((c) => c.spend > 0 || ACTIVA.has(String(c.effectiveStatus ?? "").toUpperCase()))
        .map((c): FilaCampana => {
          const key = campaignKey(plataforma, cuenta.accountId, c.id);
          const gastoUsd = asUsd(c.spend, cuenta.currency, fx);
          const m = asignacion.get(key);
          return {
            key,
            id: c.id,
            nombre: c.name || c.id,
            estado: String(c.effectiveStatus ?? ""),
            gastoUsd: gastoUsd == null ? null : redondear(gastoUsd),
            compras: c.purchases ?? null,
            cpa: dividir(gastoUsd, c.purchases ?? null),
            presupuestoUsd: c.dailyBudget != null ? asUsd(c.dailyBudget, cuenta.currency, fx) : null,
            clics: c.clicks,
            productoKey: m?.product_key ?? null,
            productoNombre: m?.product_name ?? null,
          };
        })
        .sort((a, b) => (b.gastoUsd ?? 0) - (a.gastoUsd ?? 0));
      const sinConvertir = campanas.some((c) => c.gastoUsd == null);
      const gastoUsd = sinConvertir ? null : redondear(campanas.reduce((s, c) => s + (c.gastoUsd ?? 0), 0));
      const compras = campanas.some((c) => c.compras != null) ? campanas.reduce((s, c) => s + (c.compras ?? 0), 0) : null;
      const presupuestos = campanas.filter((c) => c.presupuestoUsd != null);
      cuentas.push({
        plataforma,
        cuentaId: cuenta.accountId,
        nombre: cuenta.accountName || cuenta.accountId,
        moneda: cuenta.currency,
        gastoUsd,
        compras,
        cpa: dividir(gastoUsd, compras),
        presupuestoUsd: presupuestos.length ? redondear(presupuestos.reduce((s, c) => s + (c.presupuestoUsd ?? 0), 0)) : null,
        campanas,
      });
    }
  }
  return cuentas.sort((a, b) => (a.plataforma === b.plataforma ? (b.gastoUsd ?? 0) - (a.gastoUsd ?? 0) : a.plataforma === "meta" ? -1 : 1));
}

// ─── Ritmo: dia de la semana y tendencia por producto ────────────────────────

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export interface DiaSemana {
  dia: string;
  pedidos: number;
  /** Cuantas veces cae ese dia en el periodo. */
  veces: number;
  promedio: number | null;
}

export function pedidosPorDiaSemana(daily: Array<{ date: string; generated: number }>): DiaSemana[] {
  const filas = DIAS.map((dia) => ({ dia, pedidos: 0, veces: 0, promedio: null as number | null }));
  for (const d of daily) {
    const i = (new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    filas[i].pedidos += d.generated;
    filas[i].veces++;
  }
  return filas.map((f) => ({ ...f, promedio: f.veces ? f.pedidos / f.veces : null }));
}

export interface SerieProducto {
  key: string;
  nombre: string;
  total: number;
  puntos: number[];
}

export interface TendenciaProductos {
  /** Etiqueta de cada punto: un dia o el primer dia de la semana. */
  cortes: Array<{ desde: string; hasta: string }>;
  semanal: boolean;
  series: SerieProducto[];
}

/**
 * Los productos con mas pedidos, por semana (o por dia si el periodo es de 14
 * dias o menos). Las semanas se cuentan hacia atras desde el ultimo dia: la
 * mas reciente siempre es completa, y un primer bloque de menos de 7 dias se
 * deja fuera (una semana corta parece una caida que no existe).
 */
export function tendenciaProductos(summary: MarketingSummary, maximo = 5): TendenciaProductos {
  const dias = summary.daily.map((d) => d.date);
  const semanal = dias.length > 14;
  const cortes: Array<{ desde: string; hasta: string }> = [];
  if (semanal) {
    for (let fin = dias.length; fin - 7 >= 0; fin -= 7) cortes.unshift({ desde: dias[fin - 7], hasta: dias[fin - 1] });
  } else cortes.push(...dias.map((d) => ({ desde: d, hasta: d })));
  const series = summary.products
    .filter((p) => p.orders > 0 && p.daily.length)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, maximo)
    .map((p) => {
      const porDia = new Map(p.daily.map((d) => [d.date, d.orders]));
      return {
        key: p.key,
        nombre: p.name,
        total: p.orders,
        puntos: cortes.map((c) => dias.filter((d) => d >= c.desde && d <= c.hasta).reduce((s, d) => s + (porDia.get(d) ?? 0), 0)),
      };
    });
  return { cortes, semanal, series };
}

// ─── Anuncios con muchos clics y pocas compras ───────────────────────────────

export type EstadoAnuncio = "revisar" | "observar" | "bien";

export interface FilaAnuncio {
  key: string;
  plataforma: Plataforma;
  cuenta: string;
  nombre: string;
  campanaId: string;
  productoNombre: string | null;
  clics: number;
  compras: number;
  conversion: number | null;
  gastoUsd: number | null;
  estado: EstadoAnuncio;
}

export function estadoAnuncio(clics: number, compras: number): EstadoAnuncio {
  const conv = clics > 0 ? compras / clics : 0;
  if (conv >= CONVERSION_MINIMA) return "bien";
  return clics >= CLICS_SIGNIFICATIVOS ? "revisar" : "observar";
}

/** Anuncios del periodo con al menos la mitad de los clics significativos. */
export function anunciosClicsCompras(
  report: CharlieReport | null,
  settings: MarketingSettings | null,
  fx: UsdRate | null,
  desde: string,
  hasta: string
): FilaAnuncio[] {
  if (report?.status !== "ready" || !report.data) return [];
  const productos = new Map((settings?.mappings ?? []).map((m) => [campaignKey(m.platform, m.account_id, m.campaign_id), m.product_name]));
  const filas: FilaAnuncio[] = [];
  for (const cuenta of report.data.accounts) {
    const plataforma: Plataforma = cuenta.name.startsWith("TikTok") ? "tiktok" : "meta";
    for (const ad of cuenta.ads) {
      let clics = 0,
        compras = 0,
        gasto = 0;
      for (const d of ad.daily) {
        if (d.date < desde || d.date > hasta) continue;
        clics += d.clicks;
        compras += d.purchases;
        gasto += d.spend;
      }
      if (clics < CLICS_SIGNIFICATIVOS / 2) continue;
      const usd = asUsd(gasto, cuenta.currency, fx);
      filas.push({
        key: `${plataforma}:${cuenta.id}:${ad.id}`,
        plataforma,
        cuenta: cuenta.name.replace(/^TikTok · /, ""),
        nombre: ad.name,
        campanaId: ad.campaignId,
        productoNombre: productos.get(campaignKey(plataforma, cuenta.id, ad.campaignId)) ?? null,
        clics,
        compras,
        conversion: clics > 0 ? compras / clics : null,
        gastoUsd: usd == null ? null : redondear(usd),
        estado: estadoAnuncio(clics, compras),
      });
    }
  }
  const orden: Record<EstadoAnuncio, number> = { revisar: 0, observar: 1, bien: 2 };
  return filas.sort((a, b) => orden[a.estado] - orden[b.estado] || b.clics - a.clics);
}

// ─── Alertas ─────────────────────────────────────────────────────────────────

export type GrupoAlerta = "escalar" | "cpa" | "stock" | "clics";

export interface Alerta {
  key: string;
  grupo: GrupoAlerta;
  titulo: string;
  detalle: string;
}

export function alertasTablero({
  cuentas,
  productos,
  stock,
  anuncios,
  diasPeriodo,
  hayInventario,
}: {
  cuentas: CuentaCampanas[];
  productos: FilaProducto[];
  stock: Map<string, StockProducto>;
  anuncios: FilaAnuncio[];
  diasPeriodo: number;
  hayInventario: boolean;
}): Alerta[] {
  const alertas: Alerta[] = [];
  const usd = (v: number) =>
    new Intl.NumberFormat("es-CR", { style: "currency", currency: "USD", currencyDisplay: "code", maximumFractionDigits: 2 }).format(v);
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const stockBajo = (key: string | null) => {
    const s = key ? stock.get(key) : undefined;
    return s?.disponible != null && s.disponible < STOCK_MINIMO;
  };
  for (const cuenta of cuentas)
    for (const c of cuenta.campanas) {
      const etiqueta = `${c.nombre} · ${NOMBRE[cuenta.plataforma]} ${cuenta.nombre}`;
      if (
        diasPeriodo >= 3 &&
        c.cpa != null &&
        c.cpa <= CPA_OBJETIVO &&
        (c.compras ?? 0) >= COMPRAS_PARA_ESCALAR &&
        !stockBajo(c.productoKey)
      )
        alertas.push({
          key: `escalar:${c.key}`,
          grupo: "escalar",
          titulo: etiqueta,
          detalle: `CPA ${usd(c.cpa)} con ${plural(c.compras ?? 0, "compra", "compras")}${c.productoKey && !stock.get(c.productoKey)?.fuente ? " · stock sin verificar" : ""}. Subir el presupuesto 20–30% y esperar 3–5 días antes del siguiente ajuste.`,
        });
      if ((c.gastoUsd ?? 0) >= GASTO_SIGNIFICATIVO && (c.cpa == null ? (c.compras ?? null) === 0 : c.cpa > CPA_OBJETIVO))
        alertas.push({
          key: `cpa:${c.key}`,
          grupo: "cpa",
          titulo: etiqueta,
          detalle:
            c.cpa == null
              ? `${usd(c.gastoUsd ?? 0)} gastados sin compras reportadas.`
              : `CPA ${usd(c.cpa)} (objetivo ${usd(CPA_OBJETIVO)}) con ${usd(c.gastoUsd ?? 0)} gastados.`,
        });
    }
  for (const p of productos) {
    const s = stock.get(p.key);
    if (
      p.siete.cpa != null &&
      p.siete.cpa <= CPA_OBJETIVO &&
      p.siete.pedidos >= PEDIDOS_PARA_ESCALAR &&
      !stockBajo(p.key)
    )
      alertas.push({
        key: `escalar-producto:${p.key}`,
        grupo: "escalar",
        titulo: p.nombre,
        detalle: `Últimos 7 días: CPA ${usd(p.siete.cpa)} con ${plural(p.siete.pedidos, "pedido", "pedidos")}${s?.fuente ? ` y ${s.disponible} unidades` : " · stock sin verificar"}.`,
      });
    if (p.siete.cpa != null && p.siete.cpa > CPA_OBJETIVO && (p.siete.gastoUsd ?? 0) >= GASTO_SIGNIFICATIVO)
      alertas.push({
        key: `cpa-producto:${p.key}`,
        grupo: "cpa",
        titulo: p.nombre,
        detalle: `Últimos 7 días: CPA ${usd(p.siete.cpa)} con ${usd(p.siete.gastoUsd ?? 0)} en sus campañas y ${plural(p.siete.pedidos, "pedido", "pedidos")}.`,
      });
    if (s?.disponible != null && p.siete.pedidos > 0 && (s.disponible < STOCK_MINIMO || (s.dias != null && s.dias < DIAS_STOCK_MINIMO)))
      alertas.push({
        key: `stock:${p.key}`,
        grupo: "stock",
        titulo: p.nombre,
        detalle: `${plural(s.disponible, "unidad", "unidades")}${s.dias != null ? ` · alcanza para ${plural(Math.floor(s.dias), "día", "días")} al ritmo actual` : ""}.`,
      });
  }
  if (!hayInventario)
    alertas.push({
      key: "stock:sin-inventario",
      grupo: "stock",
      titulo: "Inventario sin conectar",
      detalle: "ShipHero no está conectado y iComfly no lleva stock de los productos vendidos: el riesgo de stock no se puede calcular.",
    });
  for (const a of anuncios)
    if (a.estado === "revisar")
      alertas.push({
        key: `clics:${a.key}`,
        grupo: "clics",
        titulo: `${a.nombre} · ${NOMBRE[a.plataforma]}`,
        detalle: `${plural(a.clics, "clic", "clics")} y ${plural(a.compras, "compra", "compras")} (${((a.conversion ?? 0) * 100).toLocaleString("es-CR", { maximumFractionDigits: 1 })}%). Revisar anuncio, página y medición.`,
      });
  return alertas;
}
