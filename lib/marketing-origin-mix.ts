// Origen de los pedidos y complementos (documento de mejoras, módulo 8),
// desde los hechos anónimos de los pedidos de iComfly
// (lib/marketing-order-facts.ts).
//
// - Origen: de dónde entró cada pedido (Shopify, carrito recuperado, bot de
//   WhatsApp e IA, asesora o formulario de iComfly).
// - Complementos: en un pedido real con varios productos, el primero es el
//   principal y los demás son complementos (orden de las líneas de iComfly; el
//   precio no sirve porque muchas veces se reparte igual). El mismo producto
//   ×3 es una oferta de cantidad, no un combo.
// - Caída como complemento: semanas de 7 días completos que terminan al final
//   del período (o ayer); la última contra el promedio de las 4 anteriores.
//
// Puro: se prueba en tests/marketing-origin-mix.test.ts.
import { decimalText, countText } from "./marketing-copy";
import { shiftDate } from "./marketing-dates";
import {
  ORDER_ORIGIN_LABEL,
  ORDER_ORIGINS,
  type OrderFactRow,
  type OrderFactsPayload,
  type OrderOrigin,
} from "./marketing-insights-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";

type Facts = Pick<OrderFactsPayload, "facts" | "products" | "titles">;

export interface OriginRow {
  origin: OrderOrigin;
  label: string;
  /** Orders created (any state). */
  created: number;
  /** Real orders (not annulled, not Testeos / Producto Agotado). */
  real: number;
  /** Share of the real orders of the period. */
  share: number;
  /** Last CR day with an order from this origin. */
  lastDate: string;
}

export interface OriginDay {
  date: string;
  /** Real orders of the day. */
  total: number;
  byOrigin: Record<OrderOrigin, number>;
}

export interface OriginMix {
  from: string;
  to: string;
  /** Orders created in the period (any state). */
  total: number;
  real: number;
  /** Origins with orders, most real orders first. */
  rows: OriginRow[];
  daily: OriginDay[];
  /**
   * Last Shopify day when Shopify had orders in the period but stopped more
   * than 2 days before its end (the store moved to iComfly); else null.
   */
  shopifyEnded: string | null;
}

const emptyByOrigin = () =>
  Object.fromEntries(ORDER_ORIGINS.map((o) => [o, 0])) as Record<
    OrderOrigin,
    number
  >;

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = shiftDate(d, 1))
    out.push(d);
  return out;
}

export function buildOriginMix(
  facts: Pick<OrderFactsPayload, "facts">,
  from: string,
  to: string,
): OriginMix {
  const days = new Map<string, OriginDay>(
    dateRange(from, to).map((date) => [
      date,
      { date, total: 0, byOrigin: emptyByOrigin() },
    ]),
  );
  const rows = new Map<OrderOrigin, Omit<OriginRow, "share" | "label">>();
  let total = 0,
    real = 0;
  for (const [date, state, , origin] of facts.facts as OrderFactRow[]) {
    const day = days.get(date);
    if (!day) continue;
    total++;
    const row = rows.get(origin) ?? {
      origin,
      created: 0,
      real: 0,
      lastDate: date,
    };
    row.created++;
    if (date > row.lastDate) row.lastDate = date;
    if (state === 0) {
      row.real++;
      real++;
      day.total++;
      day.byOrigin[origin]++;
    }
    rows.set(origin, row);
  }
  const list: OriginRow[] = Array.from(rows.values())
    .map((row) => ({
      ...row,
      label: ORDER_ORIGIN_LABEL[row.origin],
      share: real > 0 ? row.real / real : 0,
    }))
    .sort(
      (a, b) =>
        b.real - a.real ||
        b.created - a.created ||
        ORDER_ORIGINS.indexOf(a.origin) - ORDER_ORIGINS.indexOf(b.origin),
    );
  const shopify = rows.get("shopify");
  return {
    from,
    to,
    total,
    real,
    rows: list,
    daily: Array.from(days.values()),
    shopifyEnded:
      shopify && shopify.lastDate < shiftDate(to, -2) ? shopify.lastDate : null,
  };
}

export interface ComplementRow {
  id: number;
  name: string;
  fullName: string;
  /** Real orders that contain the product. */
  orders: number;
  asPrincipal: number;
  asComplement: number;
  complementShare: number | null;
  /** Sold mostly as a complement: its own campaign's CPA misleads. */
  mostlyComplement: boolean;
}

export interface ComplementPair {
  principalId: number;
  complementId: number;
  principal: string;
  complement: string;
  orders: number;
}

export interface ComplementDrop {
  id: number;
  name: string;
  fullName: string;
  /** Mean weekly complement orders of the 4 weeks before. */
  before: number;
  /** Complement orders of the last week. */
  now: number;
  title: string;
  detail: string;
}

export interface ComplementReport {
  from: string;
  to: string;
  /** Real orders of the period. */
  orders: number;
  /** Real orders with 2 or more distinct products. */
  combos: number;
  comboRate: number | null;
  /** Products of the period, most orders first. */
  products: ComplementRow[];
  /** Principal + complement, most frequent first (max `maxPairs`). */
  pairs: ComplementPair[];
  drops: ComplementDrop[];
  /** Week compared for the drops (null = not enough weeks loaded). */
  dropWeeks: { from: string; to: string; beforeFrom: string } | null;
}

const distinct = (items: number[]) => Array.from(new Set(items));

/**
 * How each product sells (principal or complement), the frequent pairs and
 * the products whose complement sales fell. `loadedFrom` (first day present
 * in `facts`) decides whether the 5 weeks for the drops are there.
 */
export function buildComplements(
  facts: Facts & Partial<Pick<OrderFactsPayload, "loadedFrom">>,
  from: string,
  to: string,
  today: string,
  t: MarketingTargets = MARKETING_TARGETS,
  maxPairs = 10,
): ComplementReport {
  const name = (id: number) => facts.products[id] ?? `Producto ${id + 1}`;
  const fullName = (id: number) =>
    facts.titles[id] ?? facts.products[id] ?? name(id);
  const products = new Map<
    number,
    { orders: number; asPrincipal: number; asComplement: number }
  >();
  const pairs = new Map<string, ComplementPair>();
  let orders = 0,
    combos = 0;

  // Drop weeks: 5 blocks of 7 complete days ending at the period end (or yesterday).
  const yesterday = shiftDate(today, -1);
  const end = to < yesterday ? to : yesterday;
  const firstWeek = shiftDate(end, -34);
  const weeksLoaded =
    facts.loadedFrom != null ? facts.loadedFrom <= firstWeek : true;
  const weekly = new Map<number, number[]>();

  for (const [date, state, , , , rawItems] of facts.facts as OrderFactRow[]) {
    if (state !== 0) continue;
    const items = distinct(rawItems);
    if (date >= from && date <= to) {
      orders++;
      if (items.length >= 2) combos++;
      items.forEach((id, i) => {
        const entry = products.get(id) ?? {
          orders: 0,
          asPrincipal: 0,
          asComplement: 0,
        };
        entry.orders++;
        if (i === 0) entry.asPrincipal++;
        else entry.asComplement++;
        products.set(id, entry);
      });
      for (const id of items.slice(1)) {
        const key = `${items[0]}:${id}`;
        const pair = pairs.get(key) ?? {
          principalId: items[0],
          complementId: id,
          principal: name(items[0]),
          complement: name(id),
          orders: 0,
        };
        pair.orders++;
        pairs.set(key, pair);
      }
    }
    if (weeksLoaded && date >= firstWeek && date <= end && items.length >= 2) {
      const block = Math.floor(
        (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) /
          (7 * 86_400_000),
      );
      for (const id of items.slice(1)) {
        const counts = weekly.get(id) ?? [0, 0, 0, 0, 0];
        counts[block]++;
        weekly.set(id, counts);
      }
    }
  }

  const productRows: ComplementRow[] = Array.from(products)
    .map(([id, p]) => {
      const share = p.orders > 0 ? p.asComplement / p.orders : null;
      return {
        id,
        name: name(id),
        fullName: fullName(id),
        orders: p.orders,
        asPrincipal: p.asPrincipal,
        asComplement: p.asComplement,
        complementShare: share,
        mostlyComplement:
          share != null &&
          share >= t.complementShareHigh &&
          p.orders >= t.complementMinOrders,
      };
    })
    .sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));

  const drops: ComplementDrop[] = [];
  for (const [id, counts] of Array.from(weekly)) {
    const now = counts[0];
    const before = (counts[1] + counts[2] + counts[3] + counts[4]) / 4;
    if (
      before >= t.complementDropMinWeekly &&
      now <= (1 - t.complementDropRatio) * before
    ) {
      const beforeText = Number.isInteger(before)
        ? countText(before)
        : decimalText(before);
      drops.push({
        id,
        name: name(id),
        fullName: fullName(id),
        before,
        now,
        title: `${name(id)} como complemento cayó`,
        detail: `De ${beforeText} a ${countText(now)} por semana.`,
      });
    }
  }
  drops.sort(
    (a, b) =>
      b.before - b.now - (a.before - a.now) || a.name.localeCompare(b.name),
  );

  return {
    from,
    to,
    orders,
    combos,
    comboRate: orders > 0 ? combos / orders : null,
    products: productRows,
    pairs: Array.from(pairs.values())
      .sort(
        (a, b) =>
          b.orders - a.orders ||
          a.principal.localeCompare(b.principal) ||
          a.complement.localeCompare(b.complement),
      )
      .slice(0, maxPairs),
    drops,
    dropWeeks: weeksLoaded
      ? { from: shiftDate(end, -6), to: end, beforeFrom: firstWeek }
      : null,
  };
}
