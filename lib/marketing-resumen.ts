// Resumen de Marketing (rediseño del reporte, parte 1): lo que el dueño lee en
// menos de un minuto. Productos con etiqueta Empujar / Frenar, lista de "Qué
// está roto" y la serie de pedidos reales por día. Puro.
import type { MarketingSummary } from "./marketing";
import type {
  MarketingSources,
  MarketingStock,
} from "./marketing-source-types";
import type { CampaignProduct } from "./marketing-settings-types";
import type { UsdRate } from "./marketing-charlie-types";
import type { InventoryAlert } from "./marketing-inventory-decide";
import type { PixelHealthAlert } from "./marketing-pixel";
import type { MarketingView } from "./marketing-loading";
import type { MarketingFamily } from "./marketing-product-families";
import { mappingMemberKeys } from "./marketing-real-cpa";
import { stockIndex, targetCoverage, type Coverage } from "./marketing-coverage";
import { asUsd } from "./marketing-usd-rate";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { shiftDate } from "./marketing-dates";
import { countText, moneyText, shortDateText } from "./marketing-copy";

const usd = (value: number | null) => moneyText(value, "USD");
const pct = (value: number) =>
  new Intl.NumberFormat("es-CR", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);

/* ---------------------------------------------------------------- serie */

export interface DailyRealPoint {
  date: string;
  real: number;
  created: number;
  /** Today: still in progress. */
  inProgress: boolean;
}

/** Real orders (created − annulled) per day of the period. */
export function dailyRealSeries(
  daily: MarketingSummary["daily"],
  today: string,
): DailyRealPoint[] {
  return daily.map((d) => ({
    date: d.date,
    real: Math.max(0, d.generated - d.annulled),
    created: d.generated,
    inProgress: d.date === today,
  }));
}

/**
 * Period close at today's pace: the period's real orders with today's so far
 * swapped for today's projection (the period ends today: no future days).
 */
export function periodProjection(input: {
  periodReal: number;
  todayReal: number;
  todayProjected: number | null;
}): number | null {
  if (input.todayProjected == null) return null;
  return Math.max(
    input.periodReal,
    input.periodReal - input.todayReal + input.todayProjected,
  );
}

/* ------------------------------------------------------------ productos */

export type ProductTag = "empujar" | "frenar" | "neutral";

export interface ProductHighlight {
  key: string;
  name: string;
  realOrders: number;
  created: number;
  /** USD spend of the campaigns that sell the product, in the period. */
  spendUsd: number | null;
  /** Spend ÷ real orders; Infinity = spend without real orders; null = no CPA. */
  cpaReal: number | null;
  /** Unassigned spend, partial Meta or different calendars: ≈. */
  approximate: boolean;
  /** Why there is no CPA ("Sin campaña asignada"). */
  cpaNote: string | null;
  coverage: Coverage;
  tag: ProductTag;
  /** Short reason of the tag, in Spanish. */
  reason: string;
}

export interface HighlightCampaign {
  spend: number;
  currency: string;
  mapping: CampaignProduct | null;
}

/**
 * Top products by real orders in the period, with real CPA (spend of the
 * campaigns assigned to the product ÷ the product's real orders, as in "CPA
 * general por producto") and days of stock. Empujar: CPA real ≤ meta and
 * stock ok. Frenar: CPA real over the target or stock red. Else neutral.
 */
export function buildProductHighlights(input: {
  summary: Pick<
    MarketingSummary,
    "products" | "groupedProducts" | "productFamilies"
  >;
  campaigns: HighlightCampaign[];
  stock: MarketingStock[] | null;
  fx: UsdRate | null;
  /** Assignments loaded (without them no CPA is computed). */
  settingsReady: boolean;
  /** Spend complete and on the same calendar as the orders. */
  aligned: boolean;
  limit?: number;
  t?: MarketingTargets;
}): ProductHighlight[] {
  const t = input.t ?? MARKETING_TARGETS;
  const families: MarketingFamily[] = input.summary.productFamilies ?? [];
  const groups = input.summary.groupedProducts?.filter(
    (p) => p.scope === "all",
  );
  const items = (
    groups?.length
      ? groups.map((g) => ({
          ...g,
          familyKey: g.familyKey as string | null,
          members: g.memberKeys,
        }))
      : input.summary.products.map((p) => ({
          ...p,
          familyKey: null as string | null,
          members: [p.key],
        }))
  )
    .filter((p) => p.realOrders > 0 || p.orders > 0)
    .sort(
      (a, b) =>
        b.realOrders - a.realOrders ||
        b.orders - a.orders ||
        a.name.localeCompare(b.name),
    )
    .slice(0, input.limit ?? 5);
  const index = stockIndex(input.stock);
  const catalog = input.summary.products.map((p) => ({
    key: p.key,
    sku: p.sku,
    recentUnits: p.recentUnits,
  }));
  const unassignedSpend = input.campaigns.some(
    (c) => c.spend > 0 && !c.mapping,
  );
  const sells = input.campaigns.map((c) => ({
    ...c,
    members: c.mapping ? mappingMemberKeys(c.mapping, families) : [],
  }));
  return items.map((p) => {
    const members = new Set(p.members);
    const related = sells.filter(
      (c) =>
        c.mapping &&
        (c.mapping.product_key === p.key ||
          (p.familyKey != null && c.mapping.family_key === p.familyKey) ||
          c.members.some((m) => members.has(m))),
    );
    const amounts = related.map((c) => asUsd(c.spend, c.currency, input.fx));
    const spendUsd =
      input.settingsReady && related.length && amounts.every((v) => v != null)
        ? amounts.reduce<number>((n, v) => n + v!, 0)
        : null;
    const cpaNote = !input.settingsReady
      ? "Asignaciones no disponibles"
      : !related.length
        ? "Sin campaña asignada"
        : spendUsd == null
          ? "Conversión de moneda pendiente"
          : spendUsd <= 0
            ? "Sin gasto en el período"
            : null;
    const cpaReal =
      cpaNote != null || spendUsd == null
        ? null
        : p.realOrders > 0
          ? spendUsd / p.realOrders
          : Infinity;
    const coverage = targetCoverage(p.members, catalog, index, t);
    const overCpa = cpaReal != null && cpaReal > t.cpaUsd;
    const redStock = coverage.tone === "red";
    const tag: ProductTag =
      overCpa || redStock
        ? "frenar"
        : cpaReal != null && cpaReal <= t.cpaUsd && coverage.tone === "ok"
          ? "empujar"
          : "neutral";
    const cpaText =
      cpaReal == null
        ? null
        : Number.isFinite(cpaReal)
          ? `CPA real ${usd(cpaReal)}`
          : `${usd(spendUsd)} sin pedidos reales`;
    const stockText =
      coverage.tone === "red" || coverage.tone === "yellow" || coverage.tone === "ok"
        ? coverage.label === "Agotado"
          ? "agotado"
          : `stock para ${coverage.label}`
        : coverage.label.toLocaleLowerCase("es");
    const reason =
      tag === "frenar"
        ? [
            overCpa ? `${cpaText} sobre la meta de ${usd(t.cpaUsd)}` : "",
            redStock ? stockText : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : tag === "empujar"
          ? `${cpaText} dentro de la meta · ${stockText}`
          : [cpaText ?? cpaNote, stockText].filter(Boolean).join(" · ");
    return {
      key: p.key,
      name: p.name,
      realOrders: p.realOrders,
      created: p.orders,
      spendUsd,
      cpaReal,
      approximate:
        cpaReal != null && (unassignedSpend || !input.aligned),
      cpaNote,
      coverage,
      tag,
      reason: reason.charAt(0).toLocaleUpperCase("es") + reason.slice(1),
    };
  });
}

/* ------------------------------------------------------- qué está roto */

export interface BrokenItem {
  key: string;
  tone: "risk" | "wait";
  title: string;
  detail: string;
  target: { view: MarketingView; anchor?: string };
  link: string;
}

export interface BrokenInput {
  /** Problems of the account status (banner data). */
  accountProblems: Array<{
    platform: "meta" | "tiktok";
    accountId: string;
    label: string;
    title: string;
    tone: "risk" | "wait" | "good";
  }>;
  sources: MarketingSources | null;
  /** Meta accounts that could not be read, already named. */
  metaUnavailable: string[];
  pixelHealth: PixelHealthAlert[];
  /** Closed-day cancellation rate (CancellationsPanel headline). */
  cancellations: { rate: number | null; days: number; annulled: number; base: number } | null;
  inventoryAlerts: InventoryAlert[];
  today: string;
  t?: MarketingTargets;
}

const SOURCE_NAME = { meta: "Meta Ads", tiktok: "TikTok Ads" } as const;

/** Only what is wrong right now, risk first. Empty = "Todo en orden". */
export function buildBrokenItems(input: BrokenInput): BrokenItem[] {
  const t = input.t ?? MARKETING_TARGETS;
  const items: BrokenItem[] = [];
  const toSources = { view: "sources" as const };
  for (const p of input.accountProblems)
    if (p.tone !== "good")
      items.push({
        key: `cuenta:${p.platform}:${p.accountId}`,
        tone: p.tone,
        title: `${p.label}: ${p.title}`,
        detail:
          p.platform === "meta"
            ? "La cuenta de Meta no entrega con normalidad."
            : "El gasto de TikTok no está llegando.",
        target: { view: "analysis", anchor: "analisis-cuentas" },
        link: "Ver estado de las cuentas",
      });
  for (const platform of ["meta", "tiktok"] as const) {
    const source = input.sources?.[platform];
    if (!source || source.status === "ready") continue;
    items.push({
      key: `fuente:${platform}`,
      tone: "risk",
      title:
        source.status === "pending"
          ? `${SOURCE_NAME[platform]} sin conectar`
          : `No se pudo consultar ${SOURCE_NAME[platform]}`,
      detail: "El gasto y el CPA real quedan incompletos.",
      target: toSources,
      link: "Ver fuentes",
    });
  }
  if (input.metaUnavailable.length)
    items.push({
      key: "meta:parcial",
      tone: "risk",
      title: `Meta parcial: no se pudo leer ${input.metaUnavailable.length === 1 ? "la cuenta" : "las cuentas"} ${input.metaUnavailable.join(", ")}`,
      detail:
        "El gasto de Meta está incompleto: el CPA real sale más bajo de lo que es.",
      target: toSources,
      link: "Ver fuentes",
    });
  const shiphero = input.sources?.shiphero;
  if (shiphero && shiphero.status !== "ready")
    items.push({
      key: "fuente:shiphero",
      tone: "wait",
      title:
        shiphero.status === "pending"
          ? "Inventario sin conectar"
          : "No se pudo leer el inventario",
      detail: "Sin stock no se calculan los días de cobertura.",
      target: toSources,
      link: shiphero.connection ? "Ver conexión" : "Conectar ShipHero",
    });
  else if (shiphero?.connection === "reconnect")
    items.push({
      key: "fuente:shiphero",
      tone: "wait",
      title: "ShipHero pide reconectar",
      detail: "Se muestra la última foto del inventario.",
      target: toSources,
      link: "Ver conexión",
    });
  const since = shiftDate(input.today, -2);
  for (const alert of input.pixelHealth.filter((a) => a.date >= since))
    items.push({
      key: `pixel:${alert.platform}:${alert.accountLabel}:${alert.date}`,
      tone: "risk",
      title:
        alert.code === "sin_conversiones"
          ? `Píxel de ${alert.accountLabel} sin compras el ${shortDateText(alert.date)}`
          : `Píxel de ${alert.accountLabel} cayó el ${shortDateText(alert.date)}`,
      detail: `${countText(alert.pixel)} en el píxel contra ${countText(Math.round(alert.real))} pedidos reales.`,
      target: { view: "report", anchor: "pixel-title" },
      link: "Ver píxel contra pedidos",
    });
  const c = input.cancellations;
  if (c && c.rate != null && c.rate > t.cancelRateAlert)
    items.push({
      key: "cancelaciones",
      tone: "risk",
      title: `Cancelaciones en ${pct(c.rate)}: sobre el límite de ${pct(t.cancelRateAlert)}`,
      detail: `${countText(c.annulled)} anulados de ${countText(c.base)} pedidos en ${countText(c.days)} ${c.days === 1 ? "día cerrado" : "días cerrados"}.`,
      target: { view: "analysis", anchor: "analisis-cancelaciones" },
      link: "Ver cancelaciones",
    });
  for (const alert of input.inventoryAlerts) {
    if (alert.code === "anuncio_sin_stock")
      items.push({
        key: alert.key,
        tone: "risk",
        title: alert.title,
        detail: alert.detail,
        target: { view: "acciones", anchor: "actions-title" },
        link: "Pausar en Acciones",
      });
    else if (alert.code === "inventario_viejo")
      items.push({
        key: alert.key,
        tone: "wait",
        title: alert.title,
        detail: alert.detail,
        target: toSources,
        link: "Actualizar inventario",
      });
  }
  const order = { risk: 0, wait: 1 } as const;
  return items.sort((a, b) => order[a.tone] - order[b.tone]);
}

/** "Meta parcial" names: the manual label of the account, else its id. */
export function unavailableMetaNames(
  sources: MarketingSources | null,
  labels: Array<{ platform: string; account_id: string; label: string }>,
): string[] {
  return (sources?.meta.data?.unavailable ?? []).map(
    (u) =>
      labels.find((l) => l.platform === "meta" && l.account_id === u.accountId)
        ?.label || u.accountId,
  );
}
