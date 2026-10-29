import type { OrderProfitabilityRow } from "./finance-orders";
import {
  marketingDate,
  dateTime,
  shiftDate,
  type MarketingPeriod,
} from "./marketing-dates";

const identity = (phone: string | null | undefined) => {
  const value = (phone || "").replace(/\D/g, "");
  return /^\d{8}$/.test(value)
    ? `506${value}`
    : /^506\d{8}$/.test(value)
      ? value
      : null;
};
/** Customer phones remain in server memory. Only aggregates leave the API. */
export function buildCharlieRevenue(
  orders: OrderProfitabilityRow[],
  phones: Map<string, string | null>,
  period: MarketingPeriod,
  heroKeys: string[] = [],
  now = new Date(),
) {
  const today = marketingDate(now),
    trailTo = period.to < today ? period.to : today,
    trailFrom = shiftDate(trailTo, -6);
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: shiftDate(trailFrom, index),
    revenueCrc: 0,
    orders: 0,
    missingValues: 0,
  }));
  const hero = new Set(heroKeys),
    deliveredBefore = new Map<string, number>();
  let revenueCrc = 0,
    recurringRevenueCrc = 0,
    heroRevenueCrc = 0,
    floorRevenueCrc = 0,
    total = 0,
    identified = 0,
    recurring = 0,
    missingValues = 0,
    annulledRevenueCrc = 0;
  const sorted = [...orders]
    .filter(
      (order) =>
        Number.isFinite(Date.parse(order.created_at || "")) &&
        Date.parse(order.created_at!) <= now.getTime(),
    )
    .sort((a, b) => Date.parse(a.created_at!) - Date.parse(b.created_at!));
  for (const order of sorted) {
    const time = Date.parse(order.created_at!),
      phone = identity(phones.get(order.order_key));
    const repeat = Boolean(
      phone && (deliveredBefore.get(phone) ?? Infinity) < time,
    );
    const isHero = order.items.some((item) =>
      hero.has(
        item.sku?.trim()
          ? `sku:${item.sku.trim().toLowerCase()}`
          : `name:${item.title.trim().toLowerCase()}`,
      ),
    );
    const valid =
      typeof order.order_value === "number" &&
      Number.isFinite(order.order_value) &&
      order.order_value >= 0;
    const value = valid ? order.order_value : 0;
    if (time >= period.start && time < period.end) {
      total++;
      if (phone) identified++;
      if (!valid) missingValues++;
      revenueCrc += value;
      if (order.tracking_status === "annulled") annulledRevenueCrc += value;
      if (repeat) {
        recurring++;
        recurringRevenueCrc += value;
      }
      if (isHero) heroRevenueCrc += value;
      if (repeat || isHero) floorRevenueCrc += value;
    }
    const day = days.find(
      (day) =>
        time >= dateTime(day.date) && time < dateTime(shiftDate(day.date, 1)),
    );
    if (day) {
      day.orders++;
      day.revenueCrc += value;
      if (!valid) day.missingValues++;
    }
    if (phone && order.tracking_status === "delivered") {
      const rawDelivery = order.delivered_on || "";
      const deliveredAt = /^20\d{2}-\d{2}-\d{2}$/.test(rawDelivery)
        ? dateTime(shiftDate(rawDelivery, 1)) - 1
        : Date.parse(rawDelivery);
      if (
        Number.isFinite(deliveredAt) &&
        deliveredAt >= time &&
        deliveredAt <= now.getTime()
      )
        deliveredBefore.set(
          phone,
          Math.min(deliveredBefore.get(phone) ?? Infinity, deliveredAt),
        );
    }
  }
  const complete = missingValues === 0;
  const recurrenceAvailable = identified > 0 && deliveredBefore.size > 0;
  return {
    basis: "created_potential" as const,
    totalOrders: total,
    revenueCrc: complete ? revenueCrc : null,
    annulledRevenueCrc: complete ? annulledRevenueCrc : null,
    recurringRevenueCrc:
      complete && recurrenceAvailable ? recurringRevenueCrc : null,
    recurringOrders: recurring,
    identifiedOrders: identified,
    heroRevenueCrc: complete && hero.size ? heroRevenueCrc : null,
    floorRevenueCrc:
      complete && (recurrenceAvailable || hero.size) ? floorRevenueCrc : null,
    identityCoverage: total > 0 ? identified / total : null,
    missingValues,
    days: days.map((day) => ({
      ...day,
      revenueCrc: day.missingValues ? null : day.revenueCrc,
    })),
    trailFrom,
    trailTo,
  };
}
export type CharlieRevenue = ReturnType<typeof buildCharlieRevenue>;
