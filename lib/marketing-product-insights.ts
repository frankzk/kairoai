// Ventas por variante y semanas, y pedidos esperando stock según iComfly
// (05/11/2026, módulos 5 y 6).
//
// - units: unidades reales (pedidos no anulados) por bloque de 7 días
//   completos, 8 bloques hasta ayer, con la clave por variante
//   (lib/marketing-variant-keys.ts). Misma regla que recentUnits del resumen.
// - waiting: pedidos confirmados en iComfly sin guía, no anulados, creados
//   hace más de `waitingMinHours`, y los que están en "Producto Agotado". Es
//   una aproximación: puede ser stock, almacén o retraso. Un pedido cuenta una
//   vez por variante.
//
// Puro: se prueba en tests/marketing-product-insights.test.ts.
import type { OrderProfitabilityRow, ProductLineItem } from "./finance-orders";
import { claveEstado, etapaVentaIcomfly } from "./icomfly-estado-venta";
import { marketingDate, shiftDate } from "./marketing-dates";
import type {
  ProductInsightsPayload,
  WaitingStock,
} from "./marketing-insights-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { variantItemKey, type VariantIndex } from "./marketing-variant-keys";

export const INSIGHT_BLOCKS = 8;

/** The fields of a finance dataset row this module reads. */
export interface FinanceOrderRowLike {
  guide_number: string;
  created_at?: string | null;
  shopify_created_at?: string | null;
  shopify_cancelled_at: string | null;
  icomfly_estado?: string;
  package_items: ProductLineItem[];
}

/** 8 × 7 complete CR days ending yesterday, newest first. */
export function insightBlocks(
  today: string,
): Array<{ from: string; to: string }> {
  return Array.from({ length: INSIGHT_BLOCKS }, (_, i) => ({
    from: shiftDate(today, -7 * (i + 1)),
    to: shiftDate(today, -7 * i - 1),
  }));
}

const quantity = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const round = (value: number) => Math.round(value * 1000) / 1000;

export function buildProductInsights(input: {
  orders: Pick<
    OrderProfitabilityRow,
    "items" | "tracking_status" | "created_at"
  >[];
  rows: FinanceOrderRowLike[];
  index: VariantIndex | null;
  today: string;
  now: Date;
  t?: MarketingTargets;
}): ProductInsightsPayload {
  const t = input.t ?? MARKETING_TARGETS;
  const blocks = insightBlocks(input.today);
  const oldest = blocks[blocks.length - 1].from;
  const yesterday = blocks[0].to;
  const units: Record<string, number[]> = {};
  for (const order of input.orders) {
    if (order.tracking_status === "annulled") continue;
    const time = Date.parse(order.created_at || "");
    if (!Number.isFinite(time)) continue;
    const date = marketingDate(new Date(time));
    if (date < oldest || date > yesterday) continue;
    const block = blocks.findIndex((b) => date >= b.from && date <= b.to);
    if (block < 0) continue;
    for (const item of order.items) {
      const key = variantItemKey(item, input.index);
      const list = (units[key] ??= Array(INSIGHT_BLOCKS).fill(0));
      list[block] = round(list[block] + quantity(item.quantity));
    }
  }
  const variantUnits7d: Record<string, number> = {};
  for (const [key, list] of Object.entries(units))
    variantUnits7d[key] = list[0];

  const waiting: Record<string, WaitingStock> = {};
  const limit = input.now.getTime() - t.waitingMinHours * 3_600_000;
  for (const row of input.rows) {
    const estado = row.icomfly_estado;
    if (!estado) continue;
    const time = Date.parse(row.created_at || row.shopify_created_at || "");
    if (!Number.isFinite(time)) continue;
    const etapa = etapaVentaIcomfly(estado);
    const agotado = claveEstado(estado) === "producto_agotado";
    const confirmedNoGuide =
      etapa === "confirmado" &&
      !String(row.guide_number ?? "").trim() &&
      !row.shopify_cancelled_at &&
      time <= limit;
    if (!agotado && !confirmedNoGuide) continue;
    const days = Math.max(
      0,
      Math.floor((input.now.getTime() - time) / 86_400_000),
    );
    const seen = new Set<string>();
    for (const item of row.package_items ?? []) {
      const key = variantItemKey(item, input.index);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = (waiting[key] ??= {
        confirmedNoGuide: 0,
        agotado: 0,
        oldestDays: 0,
      });
      if (agotado) entry.agotado++;
      else entry.confirmedNoGuide++;
      entry.oldestDays = Math.max(entry.oldestDays, days);
    }
  }
  return {
    today: input.today,
    generatedAt: input.now.toISOString(),
    blocks,
    units,
    variantUnits7d,
    waiting,
    variantAware: Boolean(input.index),
  };
}
