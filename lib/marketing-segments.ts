// Segmentación (documento de mejoras, módulo 12): pedidos por provincia
// (iComfly) y gasto / compras del píxel por edad y género (Meta). Puro: se
// prueba en tests/marketing-segments.test.ts.
//
// Edad y género son de Meta (compras del píxel): iComfly no guarda edad ni
// género de los clientes, así que no hay pedidos reales por edad.
import type { CrProvince } from "./cr-provinces";
import type {
  AgeGenderRow,
  OrderFactsPayload,
} from "./marketing-insights-types";
import type { UsdRate } from "./marketing-charlie-types";
import { notAnOrder } from "./marketing-cancellations";
import { asUsd } from "./marketing-usd-rate";
import { shiftDate } from "./marketing-dates";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";

/* ---------- Provincias ---------- */

export interface ProvinceRow {
  province: CrProvince;
  real: number;
  /** Share of all real orders of the period (unknown province included in the total). */
  share: number;
  annulled: number;
  /** annulled ÷ (real + annulled); upsell/test replacements left out like M7. */
  cancelRate: number | null;
}

export interface ProvinceReport {
  rows: ProvinceRow[];
  /** Real orders without a readable province. */
  unknown: number;
  unknownAnnulled: number;
  /** Real orders of the period. */
  total: number;
}

export function provinceReport(
  facts: Pick<OrderFactsPayload, "facts">,
  from: string,
  to: string,
): ProvinceReport {
  const by = new Map<CrProvince, { real: number; annulled: number }>();
  let unknown = 0,
    unknownAnnulled = 0,
    total = 0;
  for (const [date, state, reason, , province] of facts.facts) {
    if (date < from || date > to || state === 2) continue;
    if (state === 1 && notAnOrder(reason)) continue;
    if (state === 0) total += 1;
    if (!province) {
      if (state === 0) unknown += 1;
      else unknownAnnulled += 1;
      continue;
    }
    const entry = by.get(province) ?? { real: 0, annulled: 0 };
    if (state === 0) entry.real += 1;
    else entry.annulled += 1;
    by.set(province, entry);
  }
  const rows = Array.from(by, ([province, v]) => ({
    province,
    real: v.real,
    share: total > 0 ? v.real / total : 0,
    annulled: v.annulled,
    cancelRate:
      v.real + v.annulled > 0 ? v.annulled / (v.real + v.annulled) : null,
  })).sort(
    (a, b) =>
      b.real - a.real || a.province.localeCompare(b.province, "es"),
  );
  return { rows, unknown, unknownAnnulled, total };
}

/* ---------- Edad y género (Meta) ---------- */

/** The insights route only takes complete days and at most 31. */
export const MAX_SEGMENT_DAYS = 31;

/**
 * Days asked to Meta: the dashboard period clipped to complete days (until
 * yesterday) and to the last 31; the last 7 days when the period is only today.
 */
export function segmentationRange(
  period: { from: string; to: string },
  today: string,
): { from: string; to: string } {
  const yesterday = shiftDate(today, -1);
  const to = period.to < yesterday ? period.to : yesterday;
  const earliest = shiftDate(to, -(MAX_SEGMENT_DAYS - 1));
  const from =
    period.from > to
      ? shiftDate(to, -6)
      : period.from < earliest
        ? earliest
        : period.from;
  return { from, to };
}

export const GENDER_LABEL: Record<AgeGenderRow["gender"], string> = {
  female: "Mujeres",
  male: "Hombres",
  unknown: "Sin dato",
};

const AGE_ORDER = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
const ageRank = (age: string) => {
  const i = AGE_ORDER.indexOf(age);
  return i < 0 ? AGE_ORDER.length : i;
};
export const ageLabel = (age: string) =>
  !age || age.toLowerCase() === "unknown" ? "Sin dato" : age;

export interface SegmentRow {
  key: string;
  age: string;
  gender: AgeGenderRow["gender"] | null;
  label: string;
  spendUsd: number;
  purchases: number;
  /** Spend ÷ pixel purchases (USD). */
  cpaPixel: number | null;
  shareSpend: number;
}

export interface AgeGenderReport {
  /** Age × gender, small rows grouped at the end as "Otros". */
  rows: SegmentRow[];
  byGender: SegmentRow[];
  byAge: SegmentRow[];
  total: { spendUsd: number; purchases: number; cpaPixel: number | null };
  /** Account ids whose currency could not be converted (left out). */
  unconverted: string[];
  /** Age × gender rows folded into "Otros". */
  grouped: number;
}

type Acc = { spendUsd: number; purchases: number };
const finish = (
  key: string,
  age: string,
  gender: AgeGenderRow["gender"] | null,
  label: string,
  acc: Acc,
  total: number,
): SegmentRow => ({
  key,
  age,
  gender,
  label,
  spendUsd: acc.spendUsd,
  purchases: acc.purchases,
  cpaPixel: acc.purchases > 0 ? acc.spendUsd / acc.purchases : null,
  shareSpend: total > 0 ? acc.spendUsd / total : 0,
});

export function ageGenderReport(
  rows: AgeGenderRow[],
  fx: UsdRate | null,
  t: MarketingTargets = MARKETING_TARGETS,
): AgeGenderReport {
  const unconverted = new Set<string>();
  const cells = new Map<string, Acc & { age: string; gender: AgeGenderRow["gender"] }>();
  const genders = new Map<AgeGenderRow["gender"], Acc>();
  const ages = new Map<string, Acc>();
  const add = (acc: Acc, spend: number, purchases: number) => {
    acc.spendUsd += spend;
    acc.purchases += purchases;
  };
  let totalSpend = 0,
    totalPurchases = 0;
  for (const row of rows) {
    const spend = asUsd(row.spend, row.currency, fx);
    if (spend == null) {
      unconverted.add(row.accountId);
      continue;
    }
    const purchases = Number.isFinite(row.purchases) ? row.purchases : 0;
    const age = ageLabel(row.age);
    const key = `${age}|${row.gender}`;
    const cell = cells.get(key) ?? {
      age,
      gender: row.gender,
      spendUsd: 0,
      purchases: 0,
    };
    add(cell, spend, purchases);
    cells.set(key, cell);
    const g = genders.get(row.gender) ?? { spendUsd: 0, purchases: 0 };
    add(g, spend, purchases);
    genders.set(row.gender, g);
    const a = ages.get(age) ?? { spendUsd: 0, purchases: 0 };
    add(a, spend, purchases);
    ages.set(age, a);
    totalSpend += spend;
    totalPurchases += purchases;
  }
  const sorted = Array.from(cells, ([key, cell]) => ({ key, ...cell })).sort(
    (a, b) =>
      ageRank(a.age) - ageRank(b.age) ||
      a.age.localeCompare(b.age) ||
      a.gender.localeCompare(b.gender),
  );
  const others: Acc = { spendUsd: 0, purchases: 0 };
  let grouped = 0;
  const main: SegmentRow[] = [];
  for (const cell of sorted) {
    if (cell.spendUsd < t.segmentMinSpendUsd) {
      add(others, cell.spendUsd, cell.purchases);
      grouped += 1;
      continue;
    }
    main.push(
      finish(
        cell.key,
        cell.age,
        cell.gender,
        `${cell.age} · ${GENDER_LABEL[cell.gender]}`,
        cell,
        totalSpend,
      ),
    );
  }
  if (grouped)
    main.push(finish("otros", "Otros", null, "Otros", others, totalSpend));
  const genderOrder: AgeGenderRow["gender"][] = ["female", "male", "unknown"];
  return {
    rows: main,
    byGender: genderOrder
      .filter((g) => genders.has(g))
      .map((g) =>
        finish(g, "", g, GENDER_LABEL[g], genders.get(g)!, totalSpend),
      ),
    byAge: Array.from(ages)
      .sort(([a], [b]) => ageRank(a) - ageRank(b) || a.localeCompare(b))
      .map(([age, acc]) => finish(age, age, null, age, acc, totalSpend)),
    total: {
      spendUsd: totalSpend,
      purchases: totalPurchases,
      cpaPixel: totalPurchases > 0 ? totalSpend / totalPurchases : null,
    },
    unconverted: Array.from(unconverted).sort(),
    grouped,
  };
}
