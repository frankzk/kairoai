// Stock disponible sin publicidad (documento de mejoras, módulo 6): dónde
// poner el gasto que falta para llegar a la meta diaria.
//
// - noAds: SKU con al menos `unadvertisedMinUnits` disponibles y ningún gasto
//   en los últimos `unadvertisedDays` días completos (ni hoy) en campañas que
//   lo vendan.
// - soldBefore: SKU que vendían al menos `soldBeforeMinWeekly` unidades por
//   semana (mejor promedio de 2 semanas seguidas entre la semana −8 y la −3),
//   ahora venden la mitad o menos y tienen stock para una semana a ese ritmo.
//   Incluye los que tienen anuncios (se muestra el gasto).
//
// Gasto sin dato (TikTok después del último día que mandó Make) no es cero:
// un producto con más de `unadvertisedMaxUnknownDays` días sin dato no entra
// en noAds y se cuenta aparte.
//
// Desde el 28 oct iComfly da un solo SKU aprendido por producto y la talla o
// el color solo se separan cuando el texto coincide con el catálogo. Por eso
// una variante solo entra en soldBefore si su producto (todas las tallas y
// colores juntos) también bajó.
//
// Una campaña "vende" un SKU cuando su asignación lo incluye (`members`). Las
// variantes de talla/color que no están en el catálogo de ventas (iComfly da
// un solo SKU por producto) cuentan como cubiertas si la campaña vende otra
// variante del mismo SKU base (FAT.BURN.NEGRO.S ↔ FAT.BURN.BEIGE.S).
//
// Puro: se prueba en tests/marketing-unadvertised.test.ts.
import type { MarketingStock } from "./marketing-source-types";
import type { AssignedCampaign, SpendRow } from "./marketing-real-cpa";
import { campaignKey } from "./marketing-settings-types";
import { variantAttributes } from "./marketing-inventory-decide";
import { shiftDate } from "./marketing-dates";
import { countText, shortDateText } from "./marketing-copy";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";

export interface UnadvertisedRow {
  key: string;
  sku: string;
  name: string;
  /** False when the SKU is only in the stock file (no sale in the catalog). */
  cataloged: boolean;
  available: number;
  dailyUnits: number;
  /** Real units per 7-day block, oldest → newest (empty without the products insight). */
  weekly: number[];
  /** Best average of 2 consecutive blocks among weeks −8..−3; null without weekly data. */
  beforeWeekly: number | null;
  /** Last block (last 7 complete days); falls back to the summary's 7-day units. */
  nowWeekly: number;
  /** USD spent in the last `unadvertisedDays` complete days by campaigns selling it. */
  spend7dUsd: number;
  /** USD spent today (a launch today means it already has ads). */
  spendTodayUsd: number;
  /** Last date with spend in the loaded days (14); null = none. */
  lastSpendDate: string | null;
  /** Campaigns selling it (any status). */
  campaigns: number;
  weeksOfStockAtBefore: number | null;
  /** Days of the spend window without data for a campaign selling it (TikTok late). */
  spendUnknownDays: number;
  /** First of those days; null = all known. */
  spendUnknownFrom: string | null;
}

export interface UnadvertisedResult {
  noAds: UnadvertisedRow[];
  soldBefore: UnadvertisedRow[];
  /** SKUs with ≥ `unadvertisedMinUnits` available that are not in the sales catalog. */
  unmatchedWithStock: number;
  /** Campaigns with spend in the 7 days and no product assigned. */
  unassignedWithSpend: number;
  /** Products with stock and no known spend, left out because the spend is unknown. */
  unknownSpend: number;
  /** First date of the spend window. */
  spendFrom: string;
  notes: string[];
}

const skuKey = (sku: string) => sku.trim().toLowerCase();
const round = (value: number) => Math.round(value * 100) / 100;

/** SKU → summed available; repeated SKU rows are summed (warehouses). Non-finite = skipped. */
function availableBySku(stock: MarketingStock[]) {
  const out = new Map<string, { sku: string; available: number }>();
  for (const row of stock) {
    const key = skuKey(row.sku);
    const value = Number(row.available);
    if (!key || !Number.isFinite(value)) continue;
    const entry = out.get(key) ?? { sku: row.sku.trim(), available: 0 };
    entry.available += value;
    out.set(key, entry);
  }
  return out;
}

/** Base of a SKU that encodes color or size, else null. */
function variantBase(sku: string): string | null {
  const attrs = variantAttributes(sku);
  return attrs.color || attrs.size ? attrs.base : null;
}

/** Best average of two consecutive blocks among indexes [from, to] of a newest-first list. */
export function bestTwoBlockAverage(
  newestFirst: number[],
  from = 2,
  to = 7,
): number | null {
  let best: number | null = null;
  for (let i = from; i < to && i + 1 < newestFirst.length; i++) {
    const average = (newestFirst[i] + newestFirst[i + 1]) / 2;
    if (best == null || average > best) best = average;
  }
  return best;
}

export function buildUnadvertised(input: {
  /** Sales catalog with 7-day units (summary products). */
  catalog: Array<{
    key: string;
    sku: string;
    name: string;
    recentUnits?: number;
  }>;
  stock: MarketingStock[];
  campaigns: AssignedCampaign[];
  /** Daily USD spend per campaign (the 14 loaded days). */
  spend: SpendRow[];
  /** Products insight: 8 blocks newest first and units per key (newest first). */
  weekly: {
    blocks: Array<{ from: string; to: string }>;
    units: Record<string, number[]>;
  } | null;
  today: string;
  t?: MarketingTargets;
}): UnadvertisedResult {
  const t = input.t ?? MARKETING_TARGETS;
  const yesterday = shiftDate(input.today, -1);
  const spendFrom = shiftDate(input.today, -t.unadvertisedDays);

  // Campaign key → spend per date (USD) and dates without data.
  const spendBy = new Map<string, Map<string, number>>();
  const unknownBy = new Map<string, Set<string>>();
  for (const row of input.spend) {
    if (row.spendUsd == null) {
      const key = campaignKey(row.platform, row.accountId, row.campaignId);
      const set = unknownBy.get(key) ?? new Set<string>();
      set.add(row.date);
      unknownBy.set(key, set);
      continue;
    }
    if (!(row.spendUsd > 0)) continue;
    const key = campaignKey(row.platform, row.accountId, row.campaignId);
    const dates = spendBy.get(key) ?? new Map<string, number>();
    dates.set(row.date, (dates.get(row.date) ?? 0) + row.spendUsd);
    spendBy.set(key, dates);
  }

  // Catalog key / variant base → campaigns selling it.
  const byKey = new Map<string, Set<string>>();
  const byBase = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  };
  let unassignedWithSpend = 0;
  for (const c of input.campaigns) {
    if (!c.mapping) {
      const dates = spendBy.get(c.key);
      if (
        dates &&
        Array.from(dates.keys()).some((d) => d >= spendFrom && d <= yesterday)
      )
        unassignedWithSpend++;
      continue;
    }
    for (const member of c.members) {
      add(byKey, member, c.key);
      const sku = member.startsWith("sku:") ? member.slice(4) : "";
      const base = sku ? variantBase(sku) : null;
      if (base) add(byBase, base, c.key);
    }
  }

  const catalogBySku = new Map<string, (typeof input.catalog)[number]>();
  for (const p of input.catalog) {
    const sku = skuKey(p.sku);
    if (sku && !catalogBySku.has(sku)) catalogBySku.set(sku, p);
  }

  const weeklyUnits = input.weekly?.units ?? null;
  const rows: UnadvertisedRow[] = [];
  let unmatchedWithStock = 0;
  for (const [sku, stock] of Array.from(availableBySku(input.stock))) {
    const available = Math.max(0, stock.available);
    const product = catalogBySku.get(sku);
    const key = product?.key ?? `sku:${sku}`;
    if (!product && available >= t.unadvertisedMinUnits) unmatchedWithStock++;
    const campaigns = new Set<string>(byKey.get(key) ?? []);
    const base = variantBase(sku);
    if (base) byBase.get(base)?.forEach((c) => campaigns.add(c));
    let spend7dUsd = 0,
      spendTodayUsd = 0;
    let lastSpendDate: string | null = null;
    const unknown = new Set<string>();
    campaigns.forEach((c) => {
      unknownBy.get(c)?.forEach((date) => {
        if (date >= spendFrom && date <= yesterday) unknown.add(date);
      });
      spendBy.get(c)?.forEach((value, date) => {
        if (date >= spendFrom && date <= yesterday) spend7dUsd += value;
        if (date === input.today) spendTodayUsd += value;
        if (date <= input.today && (!lastSpendDate || date > lastSpendDate))
          lastSpendDate = date;
      });
    });
    const blocks = input.weekly?.blocks.length ?? 0;
    const newestFirst = weeklyUnits
      ? Array.from({ length: blocks }, (_, i) => weeklyUnits[key]?.[i] ?? 0)
      : null;
    const nowWeekly = newestFirst
      ? (newestFirst[0] ?? 0)
      : Math.max(0, product?.recentUnits ?? 0);
    const beforeWeekly = newestFirst ? bestTwoBlockAverage(newestFirst) : null;
    rows.push({
      key,
      sku: stock.sku,
      name: product?.name || stock.sku,
      cataloged: Boolean(product),
      available,
      dailyUnits: nowWeekly / 7,
      weekly: newestFirst ? [...newestFirst].reverse() : [],
      beforeWeekly,
      nowWeekly,
      spend7dUsd: round(spend7dUsd),
      spendTodayUsd: round(spendTodayUsd),
      lastSpendDate,
      campaigns: campaigns.size,
      weeksOfStockAtBefore:
        beforeWeekly && beforeWeekly > 0 ? available / beforeWeekly : null,
      spendUnknownDays: unknown.size,
      spendUnknownFrom: unknown.size ? Array.from(unknown).sort()[0] : null,
    });
  }

  // Variants of one product compared together (all sizes and colors).
  const familyWeekly = new Map<string, number[]>();
  for (const row of rows) {
    const base = variantBase(row.sku);
    if (!base || !row.weekly.length) continue;
    const sum = familyWeekly.get(base) ?? row.weekly.map(() => 0);
    row.weekly.forEach((n, i) => (sum[i] += n));
    familyWeekly.set(base, sum);
  }
  const familyDropped = (row: UnadvertisedRow) => {
    const base = variantBase(row.sku);
    const weekly = base ? familyWeekly.get(base) : null;
    if (!weekly) return true;
    const newestFirst = [...weekly].reverse();
    const before = bestTwoBlockAverage(newestFirst);
    return (
      before != null &&
      before > 0 &&
      (newestFirst[0] ?? 0) <= t.soldBeforeDropRatio * before
    );
  };

  const noKnownSpend = rows.filter(
    (row) =>
      row.available >= t.unadvertisedMinUnits &&
      row.spend7dUsd === 0 &&
      row.spendTodayUsd === 0,
  );
  const unknownSpendRows = noKnownSpend.filter(
    (row) => row.spendUnknownDays > t.unadvertisedMaxUnknownDays,
  );
  const noAds = noKnownSpend
    .filter((row) => row.spendUnknownDays <= t.unadvertisedMaxUnknownDays)
    .sort((a, b) => b.available - a.available || a.name.localeCompare(b.name));
  const soldBefore = rows
    .filter(
      (row) =>
        row.beforeWeekly != null &&
        row.beforeWeekly >= t.soldBeforeMinWeekly &&
        row.nowWeekly <= t.soldBeforeDropRatio * row.beforeWeekly &&
        row.available >= row.beforeWeekly &&
        familyDropped(row),
    )
    .sort(
      (a, b) =>
        b.beforeWeekly! - b.nowWeekly - (a.beforeWeekly! - a.nowWeekly) ||
        a.name.localeCompare(b.name),
    );

  const notes: string[] = [];
  if (unmatchedWithStock)
    notes.push(
      `${countText(unmatchedWithStock)} SKU del archivo con stock no tienen ventas en el catálogo: se muestran con su SKU.`,
    );
  if (unassignedWithSpend)
    notes.push(
      `${countText(unassignedWithSpend)} campañas con gasto no tienen producto asignado: su producto puede aparecer aquí sin serlo. Asígnalas en «Asignar productos».`,
    );
  if (unknownSpendRows.length) {
    const from = unknownSpendRows
      .map((row) => row.spendUnknownFrom!)
      .sort()[0];
    notes.push(
      `${countText(unknownSpendRows.length)} ${unknownSpendRows.length === 1 ? "producto con stock no se lista" : "productos con stock no se listan"}: no hay dato del gasto de sus campañas desde el ${shortDateText(from)} (TikTok llega por Make): no se sabe si tienen anuncios.`,
    );
  }
  if (!input.weekly)
    notes.push(
      "Sin ventas por semana: la lista «Vendían antes» necesita las ventas de las últimas 8 semanas.",
    );
  return {
    noAds,
    soldBefore,
    unmatchedWithStock,
    unassignedWithSpend,
    unknownSpend: unknownSpendRows.length,
    spendFrom,
    notes,
  };
}
