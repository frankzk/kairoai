import {
  MARKETING_DAY,
  marketingDate,
  periodFromInput,
  previousPeriod,
  shiftDate,
} from "./marketing-dates";
import type { OrderProfitabilityRow } from "./finance-orders";
import type { BusinessExpense } from "./finance-types";

export const MARKETING_STORE = "mireva-cr";
export const MARKETING_TIMEZONE = "America/Costa_Rica";
const DAY = 86_400_000;
const FINAL = new Set(["delivered", "not_delivered", "returned", "annulled"]);

export function costaRicaDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKETING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/** Calendar months in Costa Rica, independent of the server/browser timezone. */
export function marketingMonth(
  value: string,
): { month: string; start: number; end: number } | null {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1, 6);
  const end = Date.UTC(year, month, 1, 6);
  return { month: value, start, end };
}

const money = (value: number) => Math.round(value * 100) / 100;
const ratio = (value: number, total: number) =>
  total > 0 ? value / total : null;
const numeric = (value: number) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

export interface MarketingProduct {
  key: string;
  sku: string;
  name: string;
  orders: number;
  units: number;
  delivered: number;
  failed: number;
  open: number;
  deliveryRate: number | null;
  todayOrders: number;
  yesterdayOrders: number;
  sevenDayOrders: number;
  recentUnits: number;
  previousOrders: number;
  daily: Array<{ date: string; orders: number }>;
}

export function buildMarketingSummary({
  orders,
  expenses,
  month = "",
  from,
  to,
  now = new Date(),
}: {
  orders: OrderProfitabilityRow[];
  expenses: BusinessExpense[];
  month?: string;
  from?: string;
  to?: string;
  now?: Date;
}) {
  const window = periodFromInput(
    from !== undefined || to !== undefined
      ? { from: from || "", to: to || "" }
      : month,
  );
  if (!window) throw new Error("Mes inválido");
  // The shared finance dataset already reconciles Shopify, Icomfly and logistics.
  // Keep its canonical rows; never join a shipment back as a new purchase here.
  const cohort = orders.filter((order) => {
    const time = order.created_at ? Date.parse(order.created_at) : NaN;
    return time >= window.start && time < window.end && time <= now.getTime();
  });
  const selectedExpenses = expenses.filter((expense) => {
    if (expense.store_id !== 1 || expense.type !== "ads") return false;
    if (expense.expense_date)
      return (
        expense.expense_date >= window.from &&
        expense.expense_date.slice(0, 10) <= window.to
      );
    return Boolean(month) && expense.month === month;
  });
  const localExpenses = selectedExpenses.filter(
    (expense) => expense.currency?.toUpperCase() === "CRC",
  );
  const foreignExpenses = selectedExpenses.filter(
    (expense) => expense.currency?.toUpperCase() !== "CRC",
  );
  const adSpend = money(
    localExpenses.reduce((sum, expense) => sum + numeric(expense.amount), 0),
  );
  const usableSpend = localExpenses.length > 0 && foreignExpenses.length === 0;
  const channels = new Map<
    string,
    { name: string; spend: number; records: number }
  >();
  for (const expense of localExpenses) {
    const label = (expense.platform || "Sin canal").trim();
    const key = label.toLocaleLowerCase("es");
    const channel = channels.get(key) ?? { name: label, spend: 0, records: 0 };
    channel.spend += numeric(expense.amount);
    channel.records++;
    channels.set(key, channel);
  }

  const delivered = cohort.filter(
    (order) => order.tracking_status === "delivered",
  );
  const failed = cohort.filter((order) =>
    ["returned", "not_delivered"].includes(order.tracking_status),
  );
  const annulled = cohort.filter(
    (order) => order.tracking_status === "annulled",
  );
  const open = cohort.filter((order) => !FINAL.has(order.tracking_status));
  const withGuide = cohort.filter((order) => Boolean(order.guide_number));
  // A liquidation record is not proof that the bank deposit was received.
  // Duplicates are withheld instead of being counted twice in monetary totals.
  const settled = cohort.filter((order) => order.settlement_count === 1);
  const duplicates = cohort.filter((order) => order.settlement_count > 1);
  const missingCosts = settled.filter(
    (order) =>
      order.tracking_status === "delivered" &&
      (order.missing_cost_skus.length > 0 || order.items.length === 0),
  );
  const settlementNet = money(
    settled.reduce((sum, order) => sum + numeric(order.amount_to_liquidate), 0),
  );
  const productCost = money(
    settled.reduce((sum, order) => sum + numeric(order.product_cost), 0),
  );
  const recordedMargin =
    settled.length > 0 && missingCosts.length === 0
      ? money(settlementNet - productCost)
      : null;

  const weeks = Array.from(
    { length: Math.ceil((window.end - window.start) / (7 * DAY)) },
    (_, index) => ({
      from: costaRicaDate(new Date(window.start + index * 7 * DAY)),
      to: costaRicaDate(
        new Date(
          Math.min(window.end, window.start + (index + 1) * 7 * DAY) - DAY,
        ),
      ),
      generated: 0,
      delivered: 0,
      failed: 0,
      annulled: 0,
      open: 0,
    }),
  );
  const previous = previousPeriod(window);
  const previousOrders = orders.filter((order) => {
    const time = Date.parse(order.created_at || "");
    return time >= previous.start && time < previous.end;
  });
  const dates = Array.from({ length: window.days }, (_, i) =>
    shiftDate(window.from, i),
  );
  const daily = dates.map((date) => ({
    date,
    generated: 0,
    delivered: 0,
    failed: 0,
    annulled: 0,
    open: 0,
    units: 0,
  }));
  const products = new Map<string, MarketingProduct>();
  const keyOf = (item: OrderProfitabilityRow["items"][number]) =>
    item.sku?.trim()
      ? `sku:${item.sku.trim().toLowerCase()}`
      : `name:${item.title.trim().toLowerCase()}`;
  const today = marketingDate(now),
    yesterday = shiftDate(today, -1),
    recentFrom = shiftDate(today, -7);
  const catalog = new Map<string, { key: string; sku: string; name: string }>();
  for (const order of orders)
    for (const item of order.items) {
      const key = keyOf(item);
      if (key !== "name:")
        catalog.set(key, {
          key,
          sku: (item.sku || "").trim(),
          name: item.title.replace(/^\d+x\s+/i, ""),
        });
    }
  for (const order of cohort) {
    const week =
      weeks[
        Math.floor((Date.parse(order.created_at!) - window.start) / (7 * DAY))
      ];
    const day =
      daily[
        Math.floor(
          (Date.parse(order.created_at!) - window.start) / MARKETING_DAY,
        )
      ];
    day.generated++;
    if (order.tracking_status === "delivered") day.delivered++;
    else if (["returned", "not_delivered"].includes(order.tracking_status))
      day.failed++;
    else if (order.tracking_status === "annulled") day.annulled++;
    else day.open++;
    day.units += order.items.reduce(
      (sum, item) => sum + Math.max(0, numeric(item.quantity)),
      0,
    );
    week.generated++;
    if (order.tracking_status === "delivered") week.delivered++;
    else if (["returned", "not_delivered"].includes(order.tracking_status))
      week.failed++;
    else if (order.tracking_status === "annulled") week.annulled++;
    else week.open++;
    const seen = new Set<string>();
    for (const item of order.items) {
      const sku = (item.sku || "").trim();
      const key = keyOf(item);
      const product = products.get(key) ?? {
        key,
        sku,
        name: item.title.replace(/^\d+x\s+/i, ""),
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
        daily: dates.map((date) => ({ date, orders: 0 })),
      };
      product.units += Math.max(0, numeric(item.quantity));
      if (!seen.has(key)) {
        product.orders++;
        product.daily[
          Math.floor(
            (Date.parse(order.created_at!) - window.start) / MARKETING_DAY,
          )
        ].orders++;
        if (order.tracking_status === "delivered") product.delivered++;
        else if (["not_delivered", "returned"].includes(order.tracking_status))
          product.failed++;
        else if (!FINAL.has(order.tracking_status)) product.open++;
        seen.add(key);
      }
      product.deliveryRate = ratio(product.delivered, product.orders);
      products.set(key, product);
    }
  }

  // Rolling demand uses seven completed Costa Rica days, independent of the selected report period.
  for (const order of orders) {
    const time = Date.parse(order.created_at || "");
    if (!Number.isFinite(time) || time > now.getTime()) continue;
    const date = marketingDate(new Date(time));
    if (
      !(time >= window.start && time < window.end) &&
      date !== today &&
      date !== yesterday &&
      !(date >= recentFrom && date < today) &&
      !(time >= previous.start && time < previous.end)
    )
      continue;
    const seen = new Set<string>();
    for (const item of order.items) {
      const key = keyOf(item);
      let product = products.get(key);
      if (!product) {
        const info = catalog.get(key)!;
        product = {
          ...info,
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
        };
        products.set(key, product);
      }
      if (
        date >= recentFrom &&
        date < today &&
        order.tracking_status !== "annulled"
      )
        product.recentUnits += Math.max(0, numeric(item.quantity));
      if (seen.has(key)) continue;
      seen.add(key);
      if (date === today) product.todayOrders++;
      if (date === yesterday) product.yesterdayOrders++;
      if (date >= recentFrom && date < today) product.sevenDayOrders++;
      if (time >= previous.start && time < previous.end)
        product.previousOrders++;
    }
  }
  return {
    period: window,
    previous: { ...previous, generated: previousOrders.length },
    daily,
    catalog: Array.from(catalog.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    weekdays: Array.from({ length: 7 }, (_, i) => ({
      name: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][i],
      orders: daily
        .filter(
          (day) =>
            (new Date(`${day.date}T12:00:00Z`).getUTCDay() + 6) % 7 === i,
        )
        .reduce((sum, day) => sum + day.generated, 0),
    })),
    store: MARKETING_STORE,
    month,
    currency: "CRC",
    timezone: MARKETING_TIMEZONE,
    calculatedAt: now.toISOString(),
    totals: {
      generated: cohort.length,
      withGuide: withGuide.length,
      delivered: delivered.length,
      failed: failed.length,
      annulled: annulled.length,
      open: open.length,
      settled: settled.length,
      deliveryRate: ratio(delivered.length, cohort.length),
      registeredAdSpend: localExpenses.length ? adSpend : null,
      costPerGenerated: usableSpend ? ratio(adSpend, cohort.length) : null,
      costPerDelivered: usableSpend ? ratio(adSpend, delivered.length) : null,
      settlementNet: settled.length ? settlementNet : null,
      productCost: settled.length ? productCost : null,
      recordedMargin,
      partialBalance:
        usableSpend && recordedMargin != null && !duplicates.length
          ? money(recordedMargin - adSpend)
          : null,
    },
    quality: {
      foreignExpenses: foreignExpenses.length,
      duplicateSettlements: duplicates.length,
      missingCosts: missingCosts.length,
      deliveredWithoutSettlement: delivered.filter(
        (order) => order.settlement_count === 0,
      ).length,
      recentOpen: open.filter(
        (order) => now.getTime() - Date.parse(order.created_at!) < 14 * DAY,
      ).length,
      withoutDate: orders.filter(
        (order) =>
          !order.created_at || !Number.isFinite(Date.parse(order.created_at)),
      ).length,
      withoutProducts: cohort.filter((order) => order.items.length === 0)
        .length,
      adRecords: localExpenses.length,
    },
    channels: Array.from(channels.values())
      .map((channel) => ({ ...channel, spend: money(channel.spend) }))
      .sort((a, b) => b.spend - a.spend),
    weeks,
    products: Array.from(products.values()).sort(
      (a, b) => b.orders - a.orders || a.name.localeCompare(b.name),
    ),
  };
}

export type MarketingSummary = ReturnType<typeof buildMarketingSummary>;
