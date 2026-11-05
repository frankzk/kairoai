import { createHash } from "crypto";
import type {
  MarketingFamily,
  MarketingGroupMetric,
} from "./marketing-product-families";
import { normalProductName } from "./marketing-product-families";
import type { CampaignProduct } from "./marketing-settings-types";
import type { OrderProfitabilityRow } from "./finance-orders";
import {
  marketingDate,
  shiftDate,
  previousPeriod,
  MARKETING_DAY,
  type MarketingPeriod,
} from "./marketing-dates";
type Catalog = Array<{ key: string; sku: string; name: string }>;
export interface NativeProduct {
  shopify_id: string;
  title: string;
  variants: unknown;
}
export function baseProductName(name: string) {
  return name
    .trim()
    .replace(/^1x\s+/i, "")
    .replace(/\s*\((?:color|talla|size)\s*:.*$/i, "")
    .replace(/\s*[-–—·]\s*(?:color|talla|size)\s*:.*$/i, "")
    .replace(
      /\s*[-–—]\s*(?:negro|beige|blanco|rojo|cafe|café|azul|verde|gris)\s*\/\s*(?:talla\s+unica|talla\s+única|[smlx]+|\d+)(?:\s.*)?$/i,
      "",
    )
    .replace(
      /\s*\((?:negro|beige|blanco|rojo|cafe|café|azul|verde|gris)\s*\/\s*(?:talla\s+[úu]nica|[smlx]+|\d+)\)$/i,
      "",
    )
    .replace(
      /\s*[-–—]\s*(negro|beige|blanco|rojo|cafe|café|azul|verde|gris)(?:\s*[-–—]\s*\1)?$/i,
      "",
    )
    .trim();
}
export function buildProductFamilies(
  catalog: Catalog,
  native: NativeProduct[],
) {
  const groups = new Map<string, MarketingFamily>(),
    bySku = new Map<string, Set<string>>(),
    byName = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (key) {
      const ids = map.get(key) ?? new Set<string>();
      ids.add(id);
      map.set(key, ids);
    }
  };
  for (const p of native) {
    const id = `family:shopify:${p.shopify_id}`;
    if (!/^\d+$/.test(p.shopify_id) || !p.title) continue;
    const f: MarketingFamily = {
      key: id,
      name: p.title,
      members: [],
      source: "shopify",
      review: false,
    };
    groups.set(id, f);
    add(byName, normalProductName(baseProductName(p.title)), id);
    for (const v of Array.isArray(p.variants) ? p.variants : []) {
      const sku = String(v?.sku ?? "").trim();
      if (!sku) continue;
      add(bySku, sku.toLocaleLowerCase(), id);
      if (!f.members.some((x) => x.key === `sku:${sku.toLocaleLowerCase()}`))
        f.members.push({
          key: `sku:${sku.toLocaleLowerCase()}`,
          sku,
          name: String(v.title || sku),
        });
    }
  }
  // A reused SKU never silently links two native parents.
  for (const f of Array.from(groups.values()))
    f.members = f.members.filter(
      (v) => bySku.get(v.sku.toLocaleLowerCase())?.size === 1,
    );
  for (const item of catalog) {
    const keyName = normalProductName(baseProductName(item.name));
    const skuIds = item.sku
      ? bySku.get(item.sku.trim().toLocaleLowerCase())
      : undefined;
    const ids = skuIds?.size ? skuIds : byName.get(keyName);
    let f: MarketingFamily | undefined;
    if (ids?.size === 1) f = groups.get(Array.from(ids)[0]);
    if (!f) {
      const id = `family:name:${createHash("sha256")
        .update(keyName || item.key)
        .digest("hex")
        .slice(0, 32)}`;
      f = groups.get(id) ?? {
        key: id,
        name: baseProductName(item.name),
        members: [],
        source: "name",
        review: Boolean(ids?.size && ids.size > 1),
      };
      groups.set(id, f);
    }
    const old = f.members.find((v) => v.key === item.key);
    if (!old) f.members.push({ ...item, historical: f.source === "shopify" });
  }
  return Array.from(groups.values())
    .filter((f) => f.members.length > 0)
    .map((f) => ({
      ...f,
      members: f.members.sort(
        (a, b) =>
          Number(Boolean(a.historical)) - Number(Boolean(b.historical)) ||
          a.sku.localeCompare(b.sku) ||
          a.key.localeCompare(b.key),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function selectionTarget(
  family: MarketingFamily,
  keys: string[] | null,
) {
  const members =
    keys == null
      ? family.members.map((v) => v.key)
      : Array.from(new Set(keys)).sort();
  if (
    !members.length ||
    members.some((k) => !family.members.some((v) => v.key === k))
  )
    throw new Error("Selecciona variantes válidas del mismo producto.");
  const all = keys == null;
  const key = all
    ? family.key
    : members.length === 1
      ? members[0]
      : `selection:${createHash("sha256")
          .update(JSON.stringify([family.key, members]))
          .digest("hex")
          .slice(0, 40)}`;
  return {
    key,
    name: family.name,
    familyKey: family.key,
    memberKeys: members,
    scope: all ? ("all" as const) : ("selected" as const),
    sku:
      members.length === 1
        ? family.members.find((v) => v.key === members[0])?.sku || ""
        : "",
  };
}
export function familyTargets(
  families: MarketingFamily[],
  mappings: CampaignProduct[],
) {
  const targets = new Map(
    families.map((f) => {
      const t = selectionTarget(f, null);
      return [t.key, t];
    }),
  );
  for (const m of mappings)
    if (m.variant_scope === "selected" && m.family_key) {
      const f = families.find((f) => f.key === m.family_key);
      if (!f) continue;
      try {
        const t = selectionTarget(f, m.variant_keys ?? []);
        if (t.key === m.product_key) targets.set(t.key, t);
      } catch {
        /* obsolete subsets remain unknown */
      }
    }
  return Array.from(targets.values());
}
/** Deduplicate each canonical order per target, including orders containing multiple variants. */
export function buildGroupMetrics(
  orders: OrderProfitabilityRow[],
  period: MarketingPeriod,
  targets: ReturnType<typeof familyTargets>,
  now = new Date(),
): MarketingGroupMetric[] {
  const today = marketingDate(now),
    yesterday = shiftDate(today, -1),
    recent = shiftDate(today, -7),
    prev = previousPeriod(period);
  const byMember = new Map<string, number[]>();
  const out = targets.map((t, i) => {
    for (const k of t.memberKeys)
      byMember.set(k, [...(byMember.get(k) ?? []), i]);
    return {
      ...t,
      orders: 0,
      realOrders: 0,
      units: 0,
      delivered: 0,
      failed: 0,
      open: 0,
      deliveryRate: null as number | null,
      todayOrders: 0,
      yesterdayOrders: 0,
      sevenDayOrders: 0,
      todayReal: 0,
      yesterdayReal: 0,
      sevenDayReal: 0,
      recentUnits: 0,
      previousOrders: 0,
      daily: Array.from({ length: period.days }, (_, i) => ({
        date: shiftDate(period.from, i),
        orders: 0,
      })),
    };
  });
  for (const order of orders) {
    const time = Date.parse(order.created_at || "");
    if (!Number.isFinite(time) || time > now.getTime()) continue;
    const date = marketingDate(new Date(time)),
      active = time >= period.start && time < period.end,
      seen = new Set<number>();
    for (const item of order.items) {
      const k = item.sku?.trim()
        ? `sku:${item.sku.trim().toLowerCase()}`
        : `name:${item.title.trim().toLowerCase()}`;
      for (const i of byMember.get(k) ?? []) {
        const p = out[i],
          quantity = Math.max(0, Number(item.quantity) || 0);
        if (active) p.units += quantity;
        if (
          date >= recent &&
          date < today &&
          order.tracking_status !== "annulled"
        )
          p.recentUnits += quantity;
        if (seen.has(i)) continue;
        seen.add(i);
        const real = order.tracking_status !== "annulled";
        if (date === today) {
          p.todayOrders++;
          if (real) p.todayReal++;
        }
        if (date === yesterday) {
          p.yesterdayOrders++;
          if (real) p.yesterdayReal++;
        }
        if (date >= recent && date < today) {
          p.sevenDayOrders++;
          if (real) p.sevenDayReal++;
        }
        if (time >= prev.start && time < prev.end) p.previousOrders++;
        if (active) {
          p.orders++;
          if (real) p.realOrders++;
          p.daily[Math.floor((time - period.start) / MARKETING_DAY)].orders++;
          if (order.tracking_status === "delivered") p.delivered++;
          else if (
            ["not_delivered", "returned"].includes(order.tracking_status)
          )
            p.failed++;
          else if (!["annulled", "delivered"].includes(order.tracking_status))
            p.open++;
        }
      }
    }
  }
  return out.map((p) => ({
    ...p,
    deliveryRate: p.orders ? p.delivered / p.orders : null,
  }));
}
