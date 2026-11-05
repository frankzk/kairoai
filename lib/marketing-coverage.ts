// Stock en días de cobertura (documento de mejoras, A2): disponible ÷
// unidades vendidas por día en los últimos 7 días completos (sin anulados).
// Rojo con menos de 3 días, amarillo con menos de 7. Puro.
import type { MarketingStock } from "./marketing-source-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { daysText } from "./marketing-copy";

export type CoverageTone = "red" | "yellow" | "ok" | "no_demand" | "unknown";
export interface Coverage {
  available: number | null;
  dailyUnits: number;
  days: number | null;
  tone: CoverageTone;
  /** Some member with sales has no known stock (target coverage only). */
  partial: boolean;
  label: string;
}

const skuKey = (sku: string) => sku.trim().toLowerCase();

/**
 * SKU (lowercase) → available units. A SKU repeated in the stock list is
 * ambiguous and maps to null (same rule as before in marketing-intelligence).
 */
export function stockIndex(
  stock: MarketingStock[] | null | undefined,
): Map<string, number | null> {
  const index = new Map<string, number | null>();
  for (const item of stock ?? []) {
    const key = skuKey(item.sku);
    if (!key) continue;
    index.set(
      key,
      index.has(key)
        ? null
        : Number.isFinite(item.available)
          ? item.available
          : null,
    );
  }
  return index;
}

/** Available units of a SKU and whether the SKU was ambiguous in the stock list. */
export function stockFor(
  index: Map<string, number | null>,
  sku: string | null | undefined,
): { available: number | null; ambiguous: boolean } {
  const key = skuKey(sku ?? "");
  if (!key || !index.has(key)) return { available: null, ambiguous: false };
  const available = index.get(key) ?? null;
  return { available, ambiguous: available == null };
}

export function coverageOf(
  available: number | null,
  recentUnits7d: number,
  t: MarketingTargets = MARKETING_TARGETS,
  options: { ambiguous?: boolean } = {},
): Coverage {
  const dailyUnits = Math.max(0, Number(recentUnits7d) || 0) / 7;
  if (available == null)
    return {
      available: null,
      dailyUnits,
      days: null,
      tone: "unknown",
      partial: false,
      label: options.ambiguous
        ? "SKU sin coincidencia única"
        : "Sin stock cargado",
    };
  if (dailyUnits === 0)
    return {
      available,
      dailyUnits,
      days: null,
      tone: "no_demand",
      partial: false,
      label: "Sin ventas en 7 días",
    };
  const days = Math.max(0, available) / dailyUnits;
  return {
    available,
    dailyUnits,
    days,
    tone:
      days < t.stockRedDays
        ? "red"
        : days < t.stockYellowDays
          ? "yellow"
          : "ok",
    partial: false,
    label: available <= 0 ? "Agotado" : daysText(days),
  };
}

/**
 * Coverage of a campaign target (a family or a selection of variants): sum of
 * the known stock against the demand of every member. A member that sells
 * but has no known stock makes the result partial and `unknown`, unless the
 * members with known stock are already red on their own demand.
 */
export function targetCoverage(
  memberKeys: string[],
  products: Array<{ key: string; sku: string; recentUnits: number }>,
  index: Map<string, number | null>,
  t: MarketingTargets = MARKETING_TARGETS,
): Coverage & {
  members: Array<{ key: string; sku: string; coverage: Coverage }>;
} {
  const byKey = new Map(products.map((p) => [p.key, p]));
  const members = Array.from(new Set(memberKeys)).map((key) => {
    const product = byKey.get(key);
    const sku = product?.sku || (key.startsWith("sku:") ? key.slice(4) : "");
    const units = product?.recentUnits ?? 0;
    const stock = stockFor(index, sku);
    return {
      key,
      sku,
      units,
      coverage: coverageOf(stock.available, units, t, {
        ambiguous: stock.ambiguous,
      }),
    };
  });
  const known = members.filter((m) => m.coverage.available != null);
  const totalUnits = members.reduce((n, m) => n + m.units, 0);
  const partial = members.some(
    (m) => m.coverage.available == null && m.units > 0,
  );
  const available = known.length
    ? known.reduce((n, m) => n + m.coverage.available!, 0)
    : null;
  const out = (c: Coverage) => ({
    ...c,
    partial,
    members: members.map(({ key, sku, coverage }) => ({ key, sku, coverage })),
  });
  if (!partial) return out(coverageOf(available, totalUnits, t));
  const knownPart = coverageOf(
    available,
    known.reduce((n, m) => n + m.units, 0),
    t,
  );
  if (available != null && knownPart.tone === "red") return out(knownPart);
  const aggregate = coverageOf(available, totalUnits, t);
  return out({
    ...aggregate,
    days: null,
    tone: "unknown",
    label: "Stock incompleto",
  });
}

/**
 * SKU (lowercase) → units that came in since the previous snapshot (only
 * positive deltas). A SKU missing from the previous snapshot counts its full
 * available, like `restockedSkus()` in marketing-inventory-db. Entries of the
 * same SKU (several warehouses) are summed. Empty without a previous snapshot.
 */
export function restockDelta(
  current: MarketingStock[],
  previous: MarketingStock[] | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!previous) return out;
  const total = (rows: MarketingStock[]) => {
    const sums = new Map<string, number>();
    for (const row of rows) {
      const key = skuKey(row.sku);
      if (key && Number.isFinite(row.available))
        sums.set(key, (sums.get(key) ?? 0) + row.available);
    }
    return sums;
  };
  const before = total(previous);
  for (const [key, available] of Array.from(total(current))) {
    const delta =
      Math.round((available - (before.get(key) ?? 0)) * 1000) / 1000;
    if (delta > 0) out.set(key, delta);
  }
  return out;
}
