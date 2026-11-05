// Cancelaciones (documento de mejoras, módulo 7) desde los hechos anónimos de
// los pedidos de iComfly (lib/marketing-order-facts.ts).
//
// Tasa = anulados ÷ pedidos creados del día. No entran (ni arriba ni abajo):
// los pedidos en Testeos o Producto Agotado de iComfly (no cuentan) y los
// anulados por reemplazo con upsell u otro pedido, o por prueba: no eran
// pedidos de un cliente. Además:
// - sin duplicados: también saca los duplicados de los dos lados;
// - como en Gestión: saca todos los grupos que Gestión no cuenta
//   (lib/anulacion-motivos.ts).
// Los últimos `cancelOpenDays` días todavía se pueden anular ("abierto"): la
// tasa principal (`closed`) los deja fuera.
//
// Puro: se prueba en tests/marketing-cancellations.test.ts.
import {
  esGrupoGestion,
  MOTIVO_MARKETING_LABEL,
  type MotivoMarketing,
} from "./anulacion-motivos";
import { shiftDate } from "./marketing-dates";
import {
  ORDER_ORIGIN_LABEL,
  ORDER_ORIGINS,
  type OrderFactRow,
  type OrderFactsPayload,
  type OrderOrigin,
} from "./marketing-insights-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";

export type CancelBucket = "evitable" | "no_perdida" | "perdida";
export const CANCEL_BUCKETS: readonly CancelBucket[] = [
  "evitable",
  "no_perdida",
  "perdida",
];
export const CANCEL_BUCKET_LABEL: Record<CancelBucket, string> = {
  evitable: "Se pueden evitar",
  no_perdida: "No son pérdida real",
  perdida: "Pérdida",
};

/** Avoidable: data errors. Not a loss: the order exists elsewhere or never was one. Loss: the rest. */
export function cancelBucket(code: MotivoMarketing): CancelBucket {
  if (code === "numero_errado" || code === "cambio_en_la_orden")
    return "evitable";
  if (code === "duplicado" || code === "upsell" || code === "prueba")
    return "no_perdida";
  return "perdida";
}

/** Annulled orders that were never a customer order: out of the base. */
export const notAnOrder = (code: MotivoMarketing | "") =>
  code === "upsell" || code === "prueba";

export type CancelFactKind = "no_cuenta" | "reemplazo" | "base" | "anulado";

/**
 * How one order enters the cancellation rate: out (Testeos / Producto Agotado,
 * or annulled as upsell/test replacement), in the base, or in the base and
 * annulled. The one definition for M7 and the simulator (M10).
 */
export function cancelFactKind(
  row: Pick<OrderFactRow, 1 | 2>,
): CancelFactKind {
  const state = row[1];
  if (state === 2) return "no_cuenta";
  if (state !== 1) return "base";
  return notAnOrder(row[2] || "sin_motivo") ? "reemplazo" : "anulado";
}

export interface ClosedCancelRate {
  from: string | null;
  to: string | null;
  days: number;
  base: number;
  annulled: number;
  rate: number | null;
}

/**
 * M7's rate over the last `windowDays` closed days with orders (up to today −
 * `cancelOpenDays`, inside the loaded facts): the "today" of the simulator.
 */
export function closedCancelRate(
  facts: Pick<OrderFactsPayload, "facts" | "to" | "loadedFrom">,
  today: string,
  windowDays = 7,
  t: MarketingTargets = MARKETING_TARGETS,
): ClosedCancelRate {
  const lastClosed = shiftDate(today, -t.cancelOpenDays);
  const to = facts.to < lastClosed ? facts.to : lastClosed;
  const perDay = new Map<string, { base: number; annulled: number }>();
  for (const row of facts.facts) {
    const date = row[0];
    if (date < facts.loadedFrom || date > to) continue;
    const kind = cancelFactKind(row);
    if (kind !== "base" && kind !== "anulado") continue;
    const day = perDay.get(date) ?? { base: 0, annulled: 0 };
    day.base++;
    if (kind === "anulado") day.annulled++;
    perDay.set(date, day);
  }
  const dates = Array.from(perDay.keys()).sort().slice(-windowDays);
  const base = dates.reduce((sum, d) => sum + perDay.get(d)!.base, 0);
  const annulled = dates.reduce((sum, d) => sum + perDay.get(d)!.annulled, 0);
  return {
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    days: dates.length,
    base,
    annulled,
    rate: rate(annulled, base),
  };
}

const rate = (annulled: number, base: number) =>
  base > 0 ? annulled / base : null;

export type CancelBuckets = Record<CancelBucket, number>;
const emptyBuckets = (): CancelBuckets => ({
  evitable: 0,
  no_perdida: 0,
  perdida: 0,
});

export interface CancelDay {
  date: string;
  base: number;
  annulled: number;
  rate: number | null;
  /** Recent day: orders can still be annulled. */
  open: boolean;
  byBucket: CancelBuckets;
}

export interface CancelReason {
  code: MotivoMarketing;
  label: string;
  bucket: CancelBucket;
  count: number;
  /** Share of the annulled in the base. */
  share: number;
}

export interface CancelProduct {
  id: number;
  name: string;
  title: string;
  orders: number;
  annulled: number;
  rate: number | null;
  avoidable: number;
}

export interface CancelOrigin {
  origin: OrderOrigin;
  label: string;
  orders: number;
  annulled: number;
  rate: number | null;
}

export interface CancelReport {
  from: string;
  to: string;
  days: CancelDay[];
  total: {
    /** Orders created, without "no cuenta" and without upsell/test replacements. */
    created: number;
    base: number;
    annulled: number;
    rate: number | null;
    rateWithoutDuplicates: number | null;
    rateGestion: number | null;
    /** Left out of the base: iComfly Testeos / Producto Agotado. */
    notCounted: number;
    /** Left out of the base: annulled as upsell/other-order replacement or test. */
    replaced: number;
  };
  /** Closed days only (the open ones can still be annulled): the headline rate. */
  closed: { base: number; annulled: number; rate: number | null; days: number };
  reasons: CancelReason[];
  buckets: CancelBuckets;
  /** Reason codes per bucket (only the ones present), for the cards. */
  bucketReasons: Record<CancelBucket, CancelReason[]>;
  /** Products with at least `minProductOrders` orders, most annulled first. */
  byProduct: CancelProduct[];
  byOrigin: CancelOrigin[];
  /** Includes a recent ("abierto") day. */
  hasOpenDays: boolean;
}

/** Every CR date from `from` to `to`, inclusive. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = shiftDate(d, 1))
    out.push(d);
  return out;
}

export const MIN_PRODUCT_ORDERS = 10;

export function buildCancelReport(
  facts: Pick<OrderFactsPayload, "facts" | "products" | "titles" | "today">,
  from: string,
  to: string,
  t: MarketingTargets = MARKETING_TARGETS,
  minProductOrders = MIN_PRODUCT_ORDERS,
): CancelReport {
  const openFrom = shiftDate(facts.today, -(t.cancelOpenDays - 1));
  const days = new Map<string, CancelDay>(
    dateRange(from, to).map((date) => [
      date,
      {
        date,
        base: 0,
        annulled: 0,
        rate: null,
        open: date >= openFrom,
        byBucket: emptyBuckets(),
      },
    ]),
  );
  const reasonCount = new Map<MotivoMarketing, number>();
  const buckets = emptyBuckets();
  const products = new Map<
    number,
    { orders: number; annulled: number; avoidable: number }
  >();
  const origins = new Map<OrderOrigin, { orders: number; annulled: number }>();
  let created = 0,
    base = 0,
    annulled = 0,
    duplicates = 0,
    gestion = 0,
    notCounted = 0,
    replaced = 0;

  for (const row of facts.facts as OrderFactRow[]) {
    const [date, , reason, origin, , items] = row;
    const day = days.get(date);
    if (!day) continue;
    created++;
    const kind = cancelFactKind(row);
    if (kind === "no_cuenta") {
      notCounted++;
      continue;
    }
    if (kind === "reemplazo") {
      replaced++;
      continue;
    }
    const isAnnulled = kind === "anulado";
    const code: MotivoMarketing | "" = isAnnulled ? reason || "sin_motivo" : "";
    base++;
    day.base++;
    const originEntry = origins.get(origin) ?? { orders: 0, annulled: 0 };
    originEntry.orders++;
    const bucket = code ? cancelBucket(code) : null;
    for (const id of Array.from(new Set(items))) {
      const entry = products.get(id) ?? {
        orders: 0,
        annulled: 0,
        avoidable: 0,
      };
      entry.orders++;
      if (isAnnulled) entry.annulled++;
      if (bucket === "evitable") entry.avoidable++;
      products.set(id, entry);
    }
    if (isAnnulled && code) {
      annulled++;
      day.annulled++;
      day.byBucket[bucket!]++;
      buckets[bucket!]++;
      originEntry.annulled++;
      reasonCount.set(code, (reasonCount.get(code) ?? 0) + 1);
      if (code === "duplicado") duplicates++;
      if (esGrupoGestion(code)) gestion++;
    }
    origins.set(origin, originEntry);
  }

  const dayList = Array.from(days.values()).map((day) => ({
    ...day,
    rate: rate(day.annulled, day.base),
  }));
  const closedDays = dayList.filter((d) => !d.open);
  const reasons: CancelReason[] = Array.from(reasonCount)
    .map(([code, count]) => ({
      code,
      label: MOTIVO_MARKETING_LABEL[code],
      bucket: cancelBucket(code),
      count,
      share: annulled > 0 ? count / annulled : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const bucketReasons = Object.fromEntries(
    CANCEL_BUCKETS.map((bucket) => [
      bucket,
      reasons.filter((r) => r.bucket === bucket),
    ]),
  ) as Record<CancelBucket, CancelReason[]>;
  const byProduct: CancelProduct[] = Array.from(products)
    .filter(([, p]) => p.orders >= minProductOrders)
    .map(([id, p]) => ({
      id,
      name: facts.products[id] ?? `Producto ${id + 1}`,
      title: facts.titles[id] ?? facts.products[id] ?? "",
      orders: p.orders,
      annulled: p.annulled,
      rate: rate(p.annulled, p.orders),
      avoidable: p.avoidable,
    }))
    .sort(
      (a, b) =>
        b.annulled - a.annulled ||
        (b.rate ?? 0) - (a.rate ?? 0) ||
        a.name.localeCompare(b.name),
    );
  const byOrigin: CancelOrigin[] = ORDER_ORIGINS.filter((o) =>
    origins.has(o),
  ).map((origin) => {
    const o = origins.get(origin)!;
    return {
      origin,
      label: ORDER_ORIGIN_LABEL[origin],
      orders: o.orders,
      annulled: o.annulled,
      rate: rate(o.annulled, o.orders),
    };
  });
  byOrigin.sort((a, b) => b.orders - a.orders);

  return {
    from,
    to,
    days: dayList,
    total: {
      created,
      base,
      annulled,
      rate: rate(annulled, base),
      rateWithoutDuplicates: rate(annulled - duplicates, base - duplicates),
      rateGestion: rate(annulled - gestion, base - gestion),
      notCounted,
      replaced,
    },
    closed: {
      base: closedDays.reduce((sum, d) => sum + d.base, 0),
      annulled: closedDays.reduce((sum, d) => sum + d.annulled, 0),
      rate: rate(
        closedDays.reduce((sum, d) => sum + d.annulled, 0),
        closedDays.reduce((sum, d) => sum + d.base, 0),
      ),
      days: closedDays.length,
    },
    reasons,
    buckets,
    bucketReasons,
    byProduct,
    byOrigin,
    hasOpenDays: dayList.some((d) => d.open),
  };
}
