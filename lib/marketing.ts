import type { OrderProfitabilityRow } from "./finance-orders";
import type { BusinessExpense } from "./finance-types";

export const MARKETING_STORE = "mireva-cr";
export const MARKETING_TIMEZONE = "America/Costa_Rica";
const DAY = 86_400_000;
const FINAL = new Set(["delivered", "not_delivered", "returned", "annulled"]);

export function costaRicaDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKETING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

/** Calendar months in Costa Rica, independent of the server/browser timezone. */
export function marketingMonth(value: string): { month: string; start: number; end: number } | null {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  const start = Date.UTC(year, month - 1, 1, 6);
  const end = Date.UTC(year, month, 1, 6);
  return { month: value, start, end };
}

const money = (value: number) => Math.round(value * 100) / 100;
const ratio = (value: number, total: number) => total > 0 ? value / total : null;
const numeric = (value: number) => Number.isFinite(Number(value)) ? Number(value) : 0;

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
}

export function buildMarketingSummary({ orders, expenses, month, now = new Date() }: {
  orders: OrderProfitabilityRow[];
  expenses: BusinessExpense[];
  month: string;
  now?: Date;
}) {
  const window = marketingMonth(month);
  if (!window) throw new Error("Mes inválido");
  // The shared finance dataset already reconciles Shopify, Icomfly and logistics.
  // Keep its canonical rows; never join a shipment back as a new purchase here.
  const cohort = orders.filter(order => {
    const time = order.created_at ? Date.parse(order.created_at) : NaN;
    return time >= window.start && time < window.end && time <= now.getTime();
  });
  const selectedExpenses = expenses.filter(expense =>
    expense.store_id === 1 && expense.type === "ads" &&
    (expense.expense_date ? expense.expense_date.slice(0, 7) : expense.month) === month
  );
  const localExpenses = selectedExpenses.filter(expense => expense.currency?.toUpperCase() === "CRC");
  const foreignExpenses = selectedExpenses.filter(expense => expense.currency?.toUpperCase() !== "CRC");
  const adSpend = money(localExpenses.reduce((sum, expense) => sum + numeric(expense.amount), 0));
  const usableSpend = localExpenses.length > 0 && foreignExpenses.length === 0;
  const channels = new Map<string, { name: string; spend: number; records: number }>();
  for (const expense of localExpenses) {
    const label = (expense.platform || "Sin canal").trim();
    const key = label.toLocaleLowerCase("es");
    const channel = channels.get(key) ?? { name: label, spend: 0, records: 0 };
    channel.spend += numeric(expense.amount);
    channel.records++;
    channels.set(key, channel);
  }

  const delivered = cohort.filter(order => order.tracking_status === "delivered");
  const failed = cohort.filter(order => ["returned", "not_delivered"].includes(order.tracking_status));
  const annulled = cohort.filter(order => order.tracking_status === "annulled");
  const open = cohort.filter(order => !FINAL.has(order.tracking_status));
  const withGuide = cohort.filter(order => Boolean(order.guide_number));
  // A liquidation record is not proof that the bank deposit was received.
  // Duplicates are withheld instead of being counted twice in monetary totals.
  const settled = cohort.filter(order => order.settlement_count === 1);
  const duplicates = cohort.filter(order => order.settlement_count > 1);
  const missingCosts = settled.filter(order => order.tracking_status === "delivered" &&
    (order.missing_cost_skus.length > 0 || order.items.length === 0));
  const settlementNet = money(settled.reduce((sum, order) => sum + numeric(order.amount_to_liquidate), 0));
  const productCost = money(settled.reduce((sum, order) => sum + numeric(order.product_cost), 0));
  const recordedMargin = settled.length > 0 && missingCosts.length === 0 ? money(settlementNet - productCost) : null;

  const weeks = Array.from({ length: Math.ceil((window.end - window.start) / (7 * DAY)) }, (_, index) => ({
    from: costaRicaDate(new Date(window.start + index * 7 * DAY)),
    to: costaRicaDate(new Date(Math.min(window.end, window.start + (index + 1) * 7 * DAY) - DAY)),
    generated: 0, delivered: 0, failed: 0, annulled: 0, open: 0,
  }));
  const products = new Map<string, MarketingProduct>();
  for (const order of cohort) {
    const week = weeks[Math.floor((Date.parse(order.created_at!) - window.start) / (7 * DAY))];
    week.generated++;
    if (order.tracking_status === "delivered") week.delivered++;
    else if (["returned", "not_delivered"].includes(order.tracking_status)) week.failed++;
    else if (order.tracking_status === "annulled") week.annulled++;
    else week.open++;
    const seen = new Set<string>();
    for (const item of order.items) {
      const sku = (item.sku || "").trim();
      const key = sku ? `sku:${sku.toLowerCase()}` : `name:${item.title.trim().toLowerCase()}`;
      const product = products.get(key) ?? {
        key, sku, name: item.title.replace(/^\d+x\s+/i, ""), orders: 0, units: 0,
        delivered: 0, failed: 0, open: 0, deliveryRate: null,
      };
      product.units += Math.max(0, numeric(item.quantity));
      if (!seen.has(key)) {
        product.orders++;
        if (order.tracking_status === "delivered") product.delivered++;
        else if (["not_delivered", "returned"].includes(order.tracking_status)) product.failed++;
        else if (!FINAL.has(order.tracking_status)) product.open++;
        seen.add(key);
      }
      product.deliveryRate = ratio(product.delivered, product.orders);
      products.set(key, product);
    }
  }

  return {
    store: MARKETING_STORE,
    month,
    currency: "CRC",
    timezone: MARKETING_TIMEZONE,
    calculatedAt: now.toISOString(),
    totals: {
      generated: cohort.length, withGuide: withGuide.length,
      delivered: delivered.length, failed: failed.length, annulled: annulled.length,
      open: open.length, settled: settled.length,
      deliveryRate: ratio(delivered.length, cohort.length),
      registeredAdSpend: localExpenses.length ? adSpend : null,
      costPerGenerated: usableSpend ? ratio(adSpend, cohort.length) : null,
      costPerDelivered: usableSpend ? ratio(adSpend, delivered.length) : null,
      settlementNet: settled.length ? settlementNet : null,
      productCost: settled.length ? productCost : null,
      recordedMargin,
      partialBalance: usableSpend && recordedMargin != null && !duplicates.length
        ? money(recordedMargin - adSpend) : null,
    },
    quality: {
      foreignExpenses: foreignExpenses.length,
      duplicateSettlements: duplicates.length,
      missingCosts: missingCosts.length,
      deliveredWithoutSettlement: delivered.filter(order => order.settlement_count === 0).length,
      recentOpen: open.filter(order => now.getTime() - Date.parse(order.created_at!) < 14 * DAY).length,
      withoutDate: orders.filter(order => !order.created_at || !Number.isFinite(Date.parse(order.created_at))).length,
      withoutProducts: cohort.filter(order => order.items.length === 0).length,
      adRecords: localExpenses.length,
    },
    channels: Array.from(channels.values()).map(channel => ({ ...channel, spend: money(channel.spend) }))
      .sort((a, b) => b.spend - a.spend),
    weeks,
    products: Array.from(products.values()).sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)),
  };
}

export type MarketingSummary = ReturnType<typeof buildMarketingSummary>;
