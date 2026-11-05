// Pedidos reales por día para Marketing: creados menos anulados (estado al
// momento de consultar), con el origen UTM de campaña y anuncio cuando el
// pedido lo trae, y el resto repartido por producto (para el estimador de
// pedidos por campaña). Solo agregados: ningún nombre, teléfono ni id de
// pedido sale de aquí.
import {
  mergeAdOrigins,
  readIcomflyAdOrigin,
  resolveOriginCampaign,
  type IcomflyAdOrigin,
  type OriginCampaign,
} from "./icomfly-ad-origin";
import { nombrePedidoIcomfly } from "./icomfly-pedidos";
import type { OrderProfitabilityRow } from "./finance-orders";
import type { MarketingOriginRow } from "./marketing-attribution";
import {
  dateTime,
  MARKETING_DAY,
  marketingDate,
  shiftDate,
  type MarketingPeriod,
} from "./marketing-dates";

export interface RealOrderDay {
  date: string;
  created: number;
  real: number;
  /** Real orders with a verified campaign UTM. */
  withCampaign: number;
  /** `${platform}:${campaignId}` → real orders (UTM). */
  byCampaign: Record<string, number>;
  /** `${platform}:${adId}` → real orders (UTM). */
  byAd: Record<string, number>;
  /** Catalog key → real orders without campaign UTM, weighted 1/n over the n distinct product keys of the order. */
  unlinkedBySku: Record<string, number>;
  /** Real orders without UTM and without items. */
  unlinkedNoProduct: number;
}

export interface MarketingPaceDay {
  date: string;
  created: number[];
  real: number[];
}

export interface MarketingControl {
  from: string;
  to: string;
  today: string;
  generatedAt: string;
  origins: "ok" | "timeout" | "error";
  days: RealOrderDay[];
  /** Today and the previous 7 days, 96 slots of 15 minutes; only when `to === today`. */
  pace: { slotMinutes: 15; days: MarketingPaceDay[] } | null;
}

export const PACE_SLOT_MINUTES = 15;
export const PACE_SLOTS = (24 * 60) / PACE_SLOT_MINUTES;

/** Same product key as the Marketing catalog (`lib/marketing.ts`). */
export function orderItemKey(item: {
  sku?: string | null;
  title?: string | null;
}) {
  const sku = (item.sku ?? "").trim();
  return sku
    ? `sku:${sku.toLowerCase()}`
    : `name:${(item.title ?? "").trim().toLowerCase()}`;
}

const isReal = (order: OrderProfitabilityRow) =>
  order.tracking_status !== "annulled";

/**
 * Joins captured UTM rows to orders by order name (or guide when the name is
 * missing) only when the match is unique, then merges the variants of each
 * order. Orders without any UTM row are absent from the map.
 */
export function matchOriginsToOrders(
  orders: OrderProfitabilityRow[],
  rows: MarketingOriginRow[],
  catalog: OriginCampaign[] = [],
): Map<string, IcomflyAdOrigin | "ambiguous"> {
  const byName = new Map<string, Set<string>>(),
    byGuide = new Map<string, Set<string>>();
  const key = (s: unknown) =>
    String(s ?? "")
      .trim()
      .replace(/^#/, "")
      .toUpperCase();
  const add = (map: Map<string, Set<string>>, ref: unknown, order: string) => {
    const k = key(ref);
    if (k) {
      const values = map.get(k) ?? new Set<string>();
      values.add(order);
      map.set(k, values);
    }
  };
  for (const o of orders) {
    add(byName, o.order_name, o.order_key);
    add(byGuide, o.guide_number, o.order_key);
  }
  const candidates = new Map<string, IcomflyAdOrigin[]>();
  for (const row of rows) {
    const parsed = row.resolvedOrigin ?? readIcomflyAdOrigin(row.ad_origin);
    if (!parsed) continue;
    const origin = resolveOriginCampaign(parsed, catalog);
    const name =
      row.shopify_display_number ||
      nombrePedidoIcomfly(
        row.order_number,
        row.icomfly_order_id,
        row.store_web_seq,
      );
    const direct = byName.get(key(name));
    const matches = direct?.size
      ? direct
      : byGuide.get(key(row.tracking_number));
    if (matches?.size !== 1) continue;
    const orderKey = Array.from(matches)[0];
    candidates.set(orderKey, [...(candidates.get(orderKey) ?? []), origin]);
  }
  const result = new Map<string, IcomflyAdOrigin | "ambiguous">();
  for (const [orderKey, variants] of Array.from(candidates)) {
    const merged = mergeAdOrigins(variants);
    if (merged.ambiguous) result.set(orderKey, "ambiguous");
    else if (merged.origin) result.set(orderKey, merged.origin);
  }
  return result;
}

/** A linked order has one clean Meta/TikTok origin with a campaign id. */
export function linkedOrigin(
  origin: IcomflyAdOrigin | "ambiguous" | undefined,
):
  | (IcomflyAdOrigin & { platform: "meta" | "tiktok"; campaignId: string })
  | null {
  if (!origin || origin === "ambiguous" || origin.conflicts.length) return null;
  if (origin.platform !== "meta" && origin.platform !== "tiktok") return null;
  if (!origin.campaignId) return null;
  return origin as IcomflyAdOrigin & {
    platform: "meta" | "tiktok";
    campaignId: string;
  };
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

export function buildRealOrderDays(
  orders: OrderProfitabilityRow[],
  origins: Map<string, IcomflyAdOrigin | "ambiguous"> | null,
  period: Pick<MarketingPeriod, "from" | "to" | "start" | "end">,
  now = new Date(),
): RealOrderDay[] {
  const days = new Map<string, RealOrderDay>();
  for (let date = period.from; date <= period.to; date = shiftDate(date, 1))
    days.set(date, {
      date,
      created: 0,
      real: 0,
      withCampaign: 0,
      byCampaign: {},
      byAd: {},
      unlinkedBySku: {},
      unlinkedNoProduct: 0,
    });
  for (const order of orders) {
    const time = Date.parse(order.created_at || "");
    if (!(time >= period.start && time < period.end && time <= now.getTime()))
      continue;
    const day = days.get(marketingDate(new Date(time)));
    if (!day) continue;
    day.created++;
    if (!isReal(order)) continue;
    day.real++;
    const origin = linkedOrigin(origins?.get(order.order_key));
    if (origin) {
      day.withCampaign++;
      const campaign = `${origin.platform}:${origin.campaignId}`;
      day.byCampaign[campaign] = (day.byCampaign[campaign] ?? 0) + 1;
      if (origin.adId) {
        const ad = `${origin.platform}:${origin.adId}`;
        day.byAd[ad] = (day.byAd[ad] ?? 0) + 1;
      }
      continue;
    }
    const keys = Array.from(
      new Set(order.items.map(orderItemKey).filter((key) => key !== "name:")),
    );
    if (!keys.length) {
      day.unlinkedNoProduct++;
      continue;
    }
    for (const key of keys)
      day.unlinkedBySku[key] = (day.unlinkedBySku[key] ?? 0) + 1 / keys.length;
  }
  return Array.from(days.values()).map((day) => ({
    ...day,
    unlinkedBySku: Object.fromEntries(
      Object.entries(day.unlinkedBySku).map(([key, value]) => [
        key,
        round4(value),
      ]),
    ),
  }));
}

/**
 * 15-minute slots of created and real orders for `today` and the 7 previous
 * CR days (oldest first). Slot 0 = 00:00–00:14 Costa Rica (06:00Z).
 */
export function buildPaceSlots(
  orders: OrderProfitabilityRow[],
  today: string,
  now = new Date(),
): NonNullable<MarketingControl["pace"]> {
  const dates = Array.from({ length: 8 }, (_, i) => shiftDate(today, i - 7));
  const days = new Map<string, MarketingPaceDay>(
    dates.map((date) => [
      date,
      {
        date,
        created: Array<number>(PACE_SLOTS).fill(0),
        real: Array<number>(PACE_SLOTS).fill(0),
      },
    ]),
  );
  const first = dateTime(dates[0]);
  const last = dateTime(today) + MARKETING_DAY;
  for (const order of orders) {
    const time = Date.parse(order.created_at || "");
    if (!(time >= first && time < last && time <= now.getTime())) continue;
    const date = marketingDate(new Date(time));
    const day = days.get(date);
    if (!day) continue;
    const slot = Math.floor(
      (time - dateTime(date)) / (PACE_SLOT_MINUTES * 60_000),
    );
    if (slot < 0 || slot >= PACE_SLOTS) continue;
    day.created[slot]++;
    if (isReal(order)) day.real[slot]++;
  }
  return { slotMinutes: 15, days: dates.map((date) => days.get(date)!) };
}
