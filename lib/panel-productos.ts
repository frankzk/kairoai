// Productos del Panel (inicio): los mas pedidos del periodo y las alertas de
// stock de la tienda elegida.
//
// - Top: pedidos y unidades por producto en el periodo, con la misma regla de
//   conteo que los KPIs (solo filas con `generated` > 0; los anulados cuentan,
//   como en "Pedidos generados"). El producto es el titulo sin la cantidad
//   ("2x ") ni la variante (" - Negro / M"), asi las tallas y colores suman.
// - Stock: cada SKU del inventario guardado (ShipHero) contra lo vendido en
//   los ultimos 7 dias completos sin anulados, con la regla de cobertura de
//   Marketing (lib/marketing-coverage.ts): agotado, menos de 3 dias (rojo) o
//   menos de 7 (amarillo). Lo vendido se cruza por variante cuando hay
//   catalogo (lib/marketing-variant-keys.ts), si no por SKU.
//
// Puro (sin base ni red): lo usa /api/finance/kpis/products y se prueba en
// tests/panel-productos.test.ts.
import type { ProductLineItem } from "./finance-orders";
import { coverageOf } from "./marketing-coverage";
import { normalProductName } from "./marketing-product-families";
import type { MarketingStock } from "./marketing-source-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { variantItemKey, type VariantIndex } from "./marketing-variant-keys";
import { dayKeyIn, type PanelSeriesWindow } from "./panel-serie";

/** Lo unico que este modulo necesita de OpMetrics por fila. */
export interface ProductRowMetrics {
  generated: number;
  annulled: number;
}

export interface ProductRow {
  shopify_created_at: string | null;
  package_items?: ProductLineItem[] | null;
}

export interface TopProduct {
  key: string;
  name: string;
  orders: number;
  units: number;
  /** Pedidos del periodo anterior (null si el periodo no tiene anterior). */
  previousOrders: number | null;
  /** % de los pedidos generados del periodo que lo traen. */
  share: number | null;
}

export interface TopProducts {
  /** Pedidos generados del periodo (base de `share`). */
  orders: number;
  /** Productos distintos pedidos en el periodo. */
  distinct: number;
  items: TopProduct[];
}

export type StockTone = "out" | "red" | "yellow";

export interface StockAlert {
  sku: string;
  name: string;
  available: number;
  /** Unidades vendidas por dia (7 dias completos, sin anulados). */
  dailyUnits: number;
  /** Dias de cobertura; 0 si esta agotado. */
  days: number;
  tone: StockTone;
  /** Pedidos esperando stock, si el inventario trae ese dato. */
  backorder: number | null;
}

export interface StockAlerts {
  counts: Record<StockTone, number>;
  /** SKUs del inventario que se pudieron cruzar con ventas de los 7 dias. */
  selling: number;
  alerts: StockAlert[];
}

export const TOP_PRODUCTS_LIMIT = 8;
export const STOCK_ALERTS_LIMIT = 8;
const DAY = 86_400_000;

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** "2x Faja Reductora - Negro / M" -> "Faja Reductora". */
export function productTitle(title: string | null | undefined): string {
  const clean = String(title ?? "")
    .replace(/^\s*\d+\s*[x×]\s+/i, "")
    .trim();
  return clean.split(/\s+[-–—]\s+/)[0].trim() || clean;
}

/** "2x Faja Reductora - Negro / M" -> "Faja Reductora - Negro / M" (sin la cantidad). */
export function itemTitle(title: string | null | undefined): string {
  return String(title ?? "")
    .replace(/^\s*\d+\s*[x×]\s+/i, "")
    .trim();
}

function timeIn(value: string | null | undefined, start: number, end: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= start && time < end ? time : null;
}

/** Productos mas pedidos del periodo, con su cifra del periodo anterior. */
export function buildTopProducts<Row extends ProductRow>(
  rows: Row[],
  window: PanelSeriesWindow,
  metricsOf: (row: Row) => ProductRowMetrics,
  limit = TOP_PRODUCTS_LIMIT
): TopProducts {
  const hasPrevious = window.prevStart != null && window.prevEnd != null;
  const byKey = new Map<string, { name: string; orders: number; units: number; previousOrders: number }>();
  let orders = 0;
  for (const row of rows) {
    const current = timeIn(row.shopify_created_at, window.curStart, window.curEnd) != null;
    const previous =
      !current && hasPrevious && timeIn(row.shopify_created_at, window.prevStart as number, window.prevEnd as number) != null;
    if (!current && !previous) continue;
    if (metricsOf(row).generated <= 0) continue;
    if (current) orders += 1;
    const seen = new Set<string>();
    for (const item of row.package_items ?? []) {
      const name = productTitle(item.title);
      const key = normalProductName(name);
      if (!key) continue;
      const entry = byKey.get(key) ?? { name, orders: 0, units: 0, previousOrders: 0 };
      byKey.set(key, entry);
      if (current) entry.units += positive(item.quantity) || 1;
      if (seen.has(key)) continue;
      seen.add(key);
      if (current) entry.orders += 1;
      else entry.previousOrders += 1;
    }
  }
  const sold = Array.from(byKey.entries()).filter(([, p]) => p.orders > 0);
  const items = sold
    .sort(([ak, a], [bk, b]) => b.orders - a.orders || b.units - a.units || ak.localeCompare(bk))
    .slice(0, limit)
    .map(([key, p]) => ({
      key,
      name: p.name,
      orders: p.orders,
      units: p.units,
      previousOrders: hasPrevious ? p.previousOrders : null,
      share: orders > 0 ? Math.round((p.orders / orders) * 1000) / 10 : null,
    }));
  return { orders, distinct: sold.length, items };
}

/**
 * Tramo de los ultimos 7 dias completos (hasta ayer) en la hora de la tienda,
 * como la cobertura de Marketing.
 */
export function lastSevenDays(now: Date, timeZone: string): { from: string; to: string } {
  const key = dayKeyIn(timeZone);
  const today = key(now.getTime());
  const [y, m, d] = today.split("-").map(Number);
  const shift = (days: number) => new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  return { from: shift(-7), to: shift(-1) };
}

/** SKUs del inventario agotados o por acabarse segun lo vendido en 7 dias. */
export function buildStockAlerts<Row extends ProductRow>(input: {
  rows: Row[];
  stock: MarketingStock[];
  metricsOf: (row: Row) => ProductRowMetrics;
  index: VariantIndex | null;
  now: Date;
  timeZone: string;
  limit?: number;
  t?: MarketingTargets;
}): StockAlerts {
  const t = input.t ?? MARKETING_TARGETS;
  const { from, to } = lastSevenDays(input.now, input.timeZone);
  const key = dayKeyIn(input.timeZone);
  // Margen de un dia a cada lado para no convertir fechas de mas; el dia
  // exacto se decide con la hora de la tienda.
  const minTime = Date.parse(`${from}T00:00:00Z`) - DAY;
  const maxTime = Date.parse(`${to}T00:00:00Z`) + 2 * DAY;
  const units = new Map<string, number>();
  const names = new Map<string, string>();
  for (const row of input.rows) {
    const time = Date.parse(row.shopify_created_at || "");
    if (!Number.isFinite(time) || time < minTime || time >= maxTime) continue;
    const day = key(time);
    if (day < from || day > to) continue;
    const m = input.metricsOf(row);
    if (m.generated <= 0 || m.annulled > 0) continue;
    for (const item of row.package_items ?? []) {
      const itemKey = variantItemKey(item, input.index);
      if (!itemKey.startsWith("sku:")) continue;
      const sku = itemKey.slice(4);
      units.set(sku, (units.get(sku) ?? 0) + (positive(item.quantity) || 1));
      if (!names.has(sku)) names.set(sku, itemTitle(item.title));
    }
  }

  // Un SKU repetido en el inventario es ambiguo: se omite (misma regla que stockIndex).
  const seen = new Map<string, MarketingStock | null>();
  for (const item of input.stock) {
    const sku = item.sku.trim().toLowerCase();
    if (!sku) continue;
    seen.set(sku, seen.has(sku) ? null : item);
  }

  const counts: Record<StockTone, number> = { out: 0, red: 0, yellow: 0 };
  const alerts: StockAlert[] = [];
  let selling = 0;
  for (const [sku, item] of Array.from(seen.entries())) {
    if (!item || !Number.isFinite(item.available)) continue;
    const sold = units.get(sku) ?? 0;
    if (sold <= 0) continue;
    selling += 1;
    const coverage = coverageOf(item.available, sold, t);
    if (coverage.days == null) continue;
    const tone: StockTone | null =
      item.available <= 0 ? "out" : coverage.tone === "red" ? "red" : coverage.tone === "yellow" ? "yellow" : null;
    if (!tone) continue;
    counts[tone] += 1;
    alerts.push({
      sku: item.sku.trim(),
      name: names.get(sku) || item.sku.trim(),
      available: Math.max(0, item.available),
      dailyUnits: Math.round(coverage.dailyUnits * 10) / 10,
      days: Math.round(coverage.days * 10) / 10,
      tone,
      backorder: item.backorder == null || !Number.isFinite(item.backorder) ? null : item.backorder,
    });
  }
  const rank: Record<StockTone, number> = { out: 0, red: 1, yellow: 2 };
  alerts.sort((a, b) => rank[a.tone] - rank[b.tone] || a.days - b.days || b.dailyUnits - a.dailyUnits);
  return { counts, selling, alerts: alerts.slice(0, input.limit ?? STOCK_ALERTS_LIMIT) };
}
