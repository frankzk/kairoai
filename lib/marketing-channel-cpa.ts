// CPA por producto y por canal de venta: Página web vs WhatsApp (20/11/2026;
// la clave interna del canal web sigue siendo `landing`).
//
// El equipo pauta en Meta hacia la landing (formulario web de iComfly) o hacia
// WhatsApp, y quiere saber cuánto cuesta cada pedido real y cada unidad de
// cada producto, en total y por canal. Las reglas:
//
// - Pedidos: reales = creados − anulados (estado al consultar), la misma regla
//   que el CPA real del Tablero. El canal sale del origen del pedido
//   (`orderOrigin` de lib/marketing-order-facts.ts): WhatsApp = bot de
//   WhatsApp, pedidos creados desde Leads en Kairo (creador "Conector IA") y por asesoras (también los
//   "MANUAL-…" sin creador: nunca vienen del formulario); Landing = formulario
//   web, carrito abandonado recuperado (vino de la landing) y Shopify (fue la
//   landing hasta el 28/10/2026). Sin cruce con iComfly el canal queda
//   "sin canal" y no se adivina.
// - Origen dentro del canal (26/11/2026): cada pedido con canal lleva además
//   su origen fino (`orderSubOrigin`): WhatsApp = bot de WhatsApp, Conector
//   IA, asesora o "MANUAL-…" sin creador; Página web = formulario, carrito
//   recuperado o Shopify. El gasto solo se separa por canal (destino del
//   conjunto de anuncios): el origen muestra pedidos, unidades y % del canal,
//   nunca un CPA propio.
// - Unidades: suma de cantidades de los productos del pedido real; si la línea
//   no trae cantidad, el "2x Producto" del nombre.
// - Gasto: la pauta de las campañas asignadas al producto (misma asignación
//   que el CPA general por producto). Cada día de una campaña de Meta se
//   reparte con la proporción del gasto de sus conjuntos de anuncios por
//   destino (`destination_type` WHATSAPP → WhatsApp; WEBSITE, UNDEFINED y
//   cualquier otro destino → Landing; Messenger o Instagram Direct no son
//   WhatsApp). TikTok cuenta entero como Landing. Si Meta no dejó leer los
//   destinos, ese gasto queda "sin desglose": el total del producto se
//   muestra, el reparto por canal no.
//
// Puro y sin dependencias de servidor (lo usa el Tablero en el navegador). El
// cruce de pedidos con iComfly vive en lib/marketing-channel-orders.ts.
// Se prueba en tests/marketing-channel-cpa.test.ts.
import type { MarketingSummary } from "./marketing";
import type { UsdRate } from "./marketing-charlie-types";
import type { OrderOrigin } from "./marketing-insights-types";
import { assignedCampaigns } from "./marketing-real-cpa";
import type { MarketingControl } from "./marketing-real-orders";
import type { MarketingSettings } from "./marketing-settings-types";
import type {
  MarketingCampaign,
  MarketingSources,
} from "./marketing-source-types";
import { asUsd } from "./marketing-usd-rate";
import { summaryClockZones } from "./marketing-stores";

export type SaleChannel = "landing" | "whatsapp";
export const SALE_CHANNELS: readonly SaleChannel[] = ["landing", "whatsapp"];
export const SALE_CHANNEL_LABEL: Record<SaleChannel, string> = {
  landing: "Página web",
  whatsapp: "WhatsApp",
};

/**
 * Origin of an order inside its channel. "otro" only appears when the rows
 * of one order agree on the channel but not on the origin.
 */
export type SaleOrigin =
  | "formulario"
  | "carrito"
  | "shopify"
  | "bot"
  | "conector_ia"
  | "asesora"
  | "manual"
  | "otro";

/** Origins of each channel, in display order ("otro" last). */
export const SALE_ORIGINS: Record<SaleChannel, readonly SaleOrigin[]> = {
  landing: ["formulario", "carrito", "shopify", "otro"],
  whatsapp: ["bot", "conector_ia", "asesora", "manual", "otro"],
};

export const SALE_ORIGIN_LABEL: Record<SaleOrigin, string> = {
  formulario: "Formulario",
  carrito: "Carrito recuperado",
  shopify: "Shopify",
  bot: "Bot de WhatsApp",
  conector_ia: "Desde Leads en Kairo",
  asesora: "Asesora en iComfly",
  manual: "Manual sin creador",
  otro: "Origen no claro",
};

export const SALE_ORIGIN_HINT: Record<SaleOrigin, string> = {
  formulario: "Formulario web de iComfly",
  carrito: "Etiqueta “Carrito abandonado recuperado”",
  shopify: "Pedidos de Shopify, la página web hasta el 28/10/2026",
  bot: "Etiqueta “Venta por bot” o canal WhatsApp de iComfly",
  conector_ia: "Botón “Crear en iComfly” de Leads en Kairo (iComfly lo firma como “Conector IA”)",
  asesora: "Creados a mano en iComfly por una asesora: seguimientos y reactivaciones",
  manual: "Pedido “MANUAL-…” que iComfly guardó sin creador",
  otro: "Los datos del pedido no coinciden en el origen",
};

/** Channel of a known origin; null for "otro" (it carries its channel apart). */
export function saleOriginChannel(origin: SaleOrigin): SaleChannel | null {
  if (origin === "otro") return null;
  return SALE_ORIGINS.whatsapp.includes(origin) ? "whatsapp" : "landing";
}

/**
 * Real orders of one CR day that share channel, lines and origin:
 * [channel, [[product key, units], …] sorted by key, number of orders,
 * origin inside the channel]. The origin is absent when the channel is
 * unknown (and in payloads from before 26/11/2026: read as "otro").
 * Anonymous: no order id, name or phone.
 */
export type ChannelOrderGroup = [
  channel: SaleChannel | "unknown",
  lines: Array<[key: string, units: number]>,
  count: number,
  origin?: SaleOrigin,
];

/** WhatsApp = bot, Leads in Kairo (creator "Conector IA") and asesoras; Página web = form, recovered cart and Shopify. */
export function originChannel(
  origin: OrderOrigin,
  orderNumber?: unknown,
): SaleChannel {
  if (origin === "bot" || origin === "asesora") return "whatsapp";
  // A "MANUAL-…" order is typed by the team, never the web form, even when
  // iComfly lost its creator.
  if (
    origin === "formulario" &&
    /^MANUAL-/i.test(String(orderNumber ?? "").trim())
  )
    return "whatsapp";
  return "landing";
}

/** Meta ad set `destination_type`: any WhatsApp destination → WhatsApp; the rest → Página web. */
export function metaDestinationChannel(destination: unknown): SaleChannel {
  return /WHATSAPP/i.test(String(destination ?? "")) ? "whatsapp" : "landing";
}

/** "2x A" or "1x A, 2x B" → 2 / 3; 0 when the name carries no quantity. */
function nameUnits(title: string): number {
  const text = title.trim();
  if (!/^\d+\s*x\s/i.test(text)) return 0;
  return text
    .split(/,\s*(?=\d+\s*x\s)/i)
    .reduce((n, part) => n + (Number(/^(\d+)\s*x\s/i.exec(part)?.[1]) || 0), 0);
}

/**
 * Units of one order line: its quantity; when the line has no usable quantity
 * (or the default 1 of a "2x Producto" name), the quantity in the name.
 */
export function itemUnits(item: {
  quantity?: unknown;
  title?: string | null;
}): number {
  const quantity = Number(item.quantity);
  const named = nameUnits(String(item.title ?? ""));
  if (Number.isFinite(quantity) && quantity > 0)
    return quantity === 1 && named > 1 ? named : quantity;
  return named || 1;
}

export interface ChannelSpend {
  /** Account currency. */
  total: number;
  landing: number;
  whatsapp: number;
  /** Spend whose destination could not be read (Meta only). */
  unknown: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Spend of one campaign in [from, to] split by channel. Meta: each day's
 * spend × the share of its ad sets per destination (`channelSpend`); a day
 * without its own ad set rows uses the campaign's share over all the rows it
 * has (Meta now answers with period totals: one row per campaign), and only
 * a campaign with no rows at all stays `unknown`. TikTok: all Landing. Null
 * without daily detail.
 */
export function campaignChannelSpend(
  campaign: Pick<MarketingCampaign, "daily" | "channelSpend">,
  platform: "meta" | "tiktok",
  from: string,
  to: string,
): ChannelSpend | null {
  if (!campaign.daily) return null;
  const out: ChannelSpend = { total: 0, landing: 0, whatsapp: 0, unknown: 0 };
  const split = new Map<string, { landing: number; whatsapp: number }>();
  for (const row of campaign.channelSpend ?? []) {
    const current = split.get(row.date) ?? { landing: 0, whatsapp: 0 };
    current.landing += Math.max(0, row.landing);
    current.whatsapp += Math.max(0, row.whatsapp);
    split.set(row.date, current);
  }
  const days = new Map<string, number>();
  for (const day of campaign.daily)
    if (day.date >= from && day.date <= to)
      days.set(day.date, (days.get(day.date) ?? 0) + day.spend);
  // Whole-period share: covers the days without their own ad set rows.
  const overall = { landing: 0, whatsapp: 0 };
  for (const v of Array.from(split.values())) {
    overall.landing += v.landing;
    overall.whatsapp += v.whatsapp;
  }
  for (const [date, spend] of Array.from(days)) {
    out.total += spend;
    if (platform === "tiktok") {
      out.landing += spend;
      continue;
    }
    const share = split.get(date) ?? overall;
    const sum = share ? share.landing + share.whatsapp : 0;
    if (!share || sum <= 0) {
      out.unknown += spend;
      continue;
    }
    const whatsapp = (spend * share.whatsapp) / sum;
    out.whatsapp += whatsapp;
    out.landing += spend - whatsapp;
  }
  return {
    total: round2(out.total),
    landing: round2(out.landing),
    whatsapp: round2(out.whatsapp),
    unknown: round2(out.unknown),
  };
}

export interface ChannelCell {
  /** USD; null when unknown (no daily detail, no rate or no channel split). */
  spend: number | null;
  /** Real orders; null when the channel of the orders is unknown. */
  orders: number | null;
  units: number | null;
  /** spend / orders; null with 0 orders, 0 spend (never a $0 CPA) or unknown spend. */
  cpaOrder: number | null;
  cpaUnit: number | null;
}

/** Orders of one origin inside a channel. No spend and no CPA: spend only splits by channel. */
export interface OriginCell {
  origin: SaleOrigin;
  orders: number;
  units: number;
  /** orders / orders of the channel; null when the channel has none. */
  share: number | null;
}

export interface ChannelCpaRow {
  key: string;
  name: string;
  campaignCount: number;
  total: ChannelCell;
  landing: ChannelCell;
  whatsapp: ChannelCell;
  /**
   * Origin of the orders inside each channel, in `SALE_ORIGINS` order (every
   * origin of the channel, 0 included; "otro" only when it has orders). Sums
   * to the channel's orders and units. Null when the channel of the orders is
   * unknown.
   */
  origins: Record<SaleChannel, OriginCell[]> | null;
  /** Coverage is incomplete (unassigned campaigns, sources missing, TikTok late). */
  partial: boolean;
  /** Different calendars between ad accounts and orders. */
  approximate: boolean;
  /** Channel split: "partial" = some spend or some orders without channel. */
  split: "ok" | "partial" | "unavailable";
  /** Why a cost is missing or partial, for the row. */
  reason: string;
}

export interface ChannelCpaReport {
  from: string;
  to: string;
  rows: ChannelCpaRow[];
  /** All campaigns (assigned or not) and all real orders of the range. */
  totals: ChannelCpaRow;
  /** Real orders of the range without a channel (no iComfly match). */
  unknownOrders: number;
  /** "unavailable": the orders could not be crossed with iComfly at all. */
  ordersChannel: "ok" | "partial" | "unavailable";
  /** "unavailable": no Meta destination could be read. */
  spendChannel: "ok" | "partial" | "unavailable";
}

const cell = (
  spend: number | null,
  orders: number | null,
  units: number | null,
): ChannelCell => ({
  spend,
  orders,
  units,
  cpaOrder: spend && orders ? spend / orders : null,
  cpaUnit: spend && units ? spend / units : null,
});

type ProductTarget = {
  key: string;
  name: string;
  memberKeys?: string[];
  familyKey?: string;
};

/**
 * CPA por producto y canal for [from, to]. Products are the whole families
 * of the report (or the plain products without families), so rows never
 * overlap; an order with two products counts once in each. The totals row is
 * every campaign over every real order of the range (it is not the sum of
 * the rows).
 */
export function productChannelCpa(input: {
  summary: Pick<
    MarketingSummary,
    | "productFamilies"
    | "familyDataError"
    | "groupedProducts"
    | "products"
    | "timezone"
  > &
    Partial<Pick<MarketingSummary, "store">>;
  sources: MarketingSources | null;
  settings: MarketingSettings | null;
  control: MarketingControl | null;
  fx: UsdRate | null;
  from: string;
  to: string;
}): ChannelCpaReport {
  const { summary, sources, settings, control, fx, from, to } = input;
  const campaigns = assignedCampaigns(summary, sources, settings).map((c) => ({
    ...c,
    split: campaignChannelSpend(c.campaign, c.platform, from, to),
  }));
  const ready = Boolean(
    sources?.meta.status === "ready" && sources.tiktok.status === "ready",
  );
  const metaPartial = Boolean(sources?.meta.data?.unavailable?.length);
  const withSpend = campaigns.filter((c) => (c.split?.total ?? 0) > 0);
  const unmapped = withSpend.filter((c) => !c.mapping).length;
  const coverage = !settings || !ready || metaPartial || unmapped > 0;

  // Orders of the range, by group.
  const days = (control?.days ?? []).filter(
    (d) => d.date >= from && d.date <= to,
  );
  const covered =
    control != null &&
    control.from <= from &&
    control.to >= to &&
    days.every((d) => d.mix != null);
  const groups = covered ? days.flatMap((d) => d.mix ?? []) : [];
  const unknownOrders = groups
    .filter((g) => g[0] === "unknown")
    .reduce((n, g) => n + g[2], 0);
  const realOrders = groups.reduce((n, g) => n + g[2], 0);
  const ordersChannel: ChannelCpaReport["ordersChannel"] = !covered
    ? "unavailable"
    : unknownOrders === 0
      ? "ok"
      : unknownOrders >= realOrders
        ? "unavailable"
        : "partial";

  /** Orders and units of the groups that hold any of `keys` (null = all groups). */
  function orderCounts(keys: Set<string> | null) {
    const zero = () => ({ orders: 0, units: 0 });
    const out = {
      total: zero(),
      landing: zero(),
      whatsapp: zero(),
      unknown: zero(),
    };
    const byOrigin = {
      landing: new Map<SaleOrigin, { orders: number; units: number }>(),
      whatsapp: new Map<SaleOrigin, { orders: number; units: number }>(),
    };
    for (const [channel, lines, count, origin] of groups) {
      const units = lines
        .filter(([key]) => !keys || keys.has(key))
        .reduce((n, [, u]) => n + u, 0);
      if (keys && !lines.some(([key]) => keys.has(key))) continue;
      const buckets = [out.total, out[channel]];
      if (channel !== "unknown") {
        // An origin that does not belong to the channel (or a payload
        // without origin) counts as "otro": the channel is never dropped.
        const known =
          origin && SALE_ORIGINS[channel].includes(origin) ? origin : "otro";
        const bucket = byOrigin[channel].get(known) ?? zero();
        byOrigin[channel].set(known, bucket);
        buckets.push(bucket);
      }
      for (const bucket of buckets) {
        bucket.orders += count;
        bucket.units += units * count;
      }
    }
    const origins = {} as Record<SaleChannel, OriginCell[]>;
    for (const channel of SALE_CHANNELS)
      origins[channel] = SALE_ORIGINS[channel]
        .map((origin): OriginCell => {
          const bucket = byOrigin[channel].get(origin) ?? zero();
          return {
            origin,
            orders: bucket.orders,
            units: bucket.units,
            share: out[channel].orders
              ? bucket.orders / out[channel].orders
              : null,
          };
        })
        .filter((c) => c.origin !== "otro" || c.orders > 0);
    return { ...out, origins };
  }

  function spendOf(list: typeof campaigns) {
    let daily = true,
      rate = true;
    const usd = { total: 0, landing: 0, whatsapp: 0, unknown: 0 };
    for (const c of list) {
      if (!c.split) {
        daily = false;
        continue;
      }
      for (const part of ["total", "landing", "whatsapp", "unknown"] as const) {
        const value = asUsd(c.split[part], c.account.currency, fx);
        if (value == null) rate = false;
        else usd[part] += value;
      }
    }
    return { usd, daily, rate };
  }

  function row(
    target: ProductTarget,
    related: typeof campaigns,
    keys: Set<string> | null,
    coveragePartial: boolean,
  ): ChannelCpaRow {
    const counts = orderCounts(keys);
    const spend = spendOf(related);
    const late = related.some(
      (c) =>
        c.platform === "tiktok" &&
        (c.observedThrough == null || c.observedThrough < to),
    );
    const approximate = related.some(
      (c) => !summaryClockZones(summary).has(c.account.timezone),
    );
    const partial = coveragePartial || late;
    const total = spend.daily && spend.rate ? spend.usd.total : null;
    // Never a guessed split: any spend without destination blanks the
    // channel spend; orders without channel only mark it as partial.
    const spendSplit = total != null && spend.usd.unknown <= 0.005;
    const ordersKnown = ordersChannel !== "unavailable";
    const split: ChannelCpaRow["split"] =
      !spendSplit && !ordersKnown
        ? "unavailable"
        : !spendSplit || !ordersKnown || counts.unknown.orders > 0
          ? "partial"
          : "ok";
    const channelCell = (channel: SaleChannel) =>
      cell(
        spendSplit ? spend.usd[channel] : null,
        ordersKnown ? counts[channel].orders : null,
        ordersKnown ? counts[channel].units : null,
      );
    const reason = !covered
      ? "Pedidos reales no disponibles"
      : !spend.daily
        ? "Detalle diario pendiente"
        : !spend.rate
          ? "Conversión pendiente"
          : !related.length && keys
            ? "Asigna sus campañas"
            : !counts.total.orders
              ? "Sin pedidos reales"
              : late
                ? "TikTok no reporta todo el rango"
                : partial
                  ? "Solo pauta asignada, cobertura parcial"
                  : approximate
                    ? "Calendarios distintos"
                    : "Pauta / pedidos reales";
    return {
      key: target.key,
      name: target.name,
      campaignCount: related.length,
      total: covered
        ? cell(total, counts.total.orders, counts.total.units)
        : cell(total, null, null),
      landing: channelCell("landing"),
      whatsapp: channelCell("whatsapp"),
      origins: ordersKnown ? counts.origins : null,
      partial,
      approximate,
      split,
      reason,
    };
  }

  const products: ProductTarget[] = summary.groupedProducts
    ? summary.groupedProducts.filter((p) => p.scope === "all")
    : summary.products;
  const rows = products
    .map((p) => {
      const members = new Set(p.memberKeys?.length ? p.memberKeys : [p.key]);
      const related = campaigns.filter(
        (c) =>
          c.mapping &&
          (c.mapping.product_key === p.key ||
            (p.familyKey != null && c.mapping.family_key === p.familyKey) ||
            members.has(c.mapping.product_key)),
      );
      return row(p, related, members, coverage);
    })
    .filter((r) => (r.total.spend ?? 0) > 0 || (r.total.orders ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.total.spend ?? -1) - (a.total.spend ?? -1) ||
        (b.total.orders ?? 0) - (a.total.orders ?? 0) ||
        a.name.localeCompare(b.name, "es"),
    );
  const totals = row(
    { key: "total", name: "Total" },
    campaigns,
    null,
    !ready || metaPartial,
  );
  const metaSpend = campaigns.filter(
    (c) => c.platform === "meta" && (c.split?.total ?? 0) > 0,
  );
  const unknownMeta = metaSpend.filter((c) => (c.split?.unknown ?? 0) > 0);
  return {
    from,
    to,
    rows,
    totals,
    unknownOrders,
    ordersChannel,
    spendChannel: !unknownMeta.length
      ? "ok"
      : unknownMeta.length === metaSpend.length &&
          unknownMeta.every((c) => c.split!.unknown >= c.split!.total - 0.005)
        ? "unavailable"
        : "partial",
  };
}

/* ------------------------------------------------ búsqueda por producto */

const foldText = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Products whose name contains every word typed, without accents or case
 * ("colageno bio" finds "Colágeno Hidrolizado + Biotina"). Empty = all rows.
 */
export function filterCpaRows<T extends Pick<ChannelCpaRow, "name">>(
  rows: T[],
  query: string,
): T[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((row) => {
    const name = foldText(row.name);
    return words.every((word) => name.includes(word));
  });
}

/**
 * Origins of several products added up, for the summary when the table is
 * filtered. An order with two of these products counts once in each (as in
 * the rows), so the result can exceed the real orders. Null when any of the
 * rows has no origin detail.
 */
export function sumCpaOrigins(
  rows: Array<Pick<ChannelCpaRow, "origins">>,
): Record<SaleChannel, OriginCell[]> | null {
  if (!rows.length || rows.some((row) => !row.origins)) return null;
  const out = {} as Record<SaleChannel, OriginCell[]>;
  for (const channel of SALE_CHANNELS) {
    const sums = new Map<SaleOrigin, { orders: number; units: number }>();
    for (const row of rows)
      for (const cellOf of row.origins![channel]) {
        const current = sums.get(cellOf.origin) ?? { orders: 0, units: 0 };
        current.orders += cellOf.orders;
        current.units += cellOf.units;
        sums.set(cellOf.origin, current);
      }
    const orders = Array.from(sums.values()).reduce((n, s) => n + s.orders, 0);
    out[channel] = SALE_ORIGINS[channel]
      .filter((origin) => origin !== "otro" || (sums.get(origin)?.orders ?? 0) > 0)
      .map((origin) => {
        const sum = sums.get(origin) ?? { orders: 0, units: 0 };
        return {
          origin,
          orders: sum.orders,
          units: Math.round(sum.units * 1000) / 1000,
          share: orders ? sum.orders / orders : null,
        };
      });
  }
  return out;
}
