// Pestaña "Publicidad" de Marketing (25/11/2026): la tabla del administrador de
// anuncios (campañas, conjuntos de anuncios y anuncios con sus métricas) dentro
// de Kairo, para no tener que abrir otra herramienta solo para mirar.
//
// SOLO LECTURA: aquí no hay encender/apagar, ni presupuestos editables, ni
// crear campañas. El token de Meta que tiene Kairo es de lectura y el equipo
// pidió "solo ver" por ahora.
//
// Los números son los que reporta Meta (insights): compras y valor de compra
// del píxel/CAPI, leads = acción `lead`, resultados = el resultado del objetivo
// de optimización del conjunto. NO son los pedidos reales de Kairo.
//
// Este archivo es puro (sin red, sin token) y lo usan el servidor y el
// navegador: normaliza lo que manda Meta, decide qué filas se muestran y
// calcula las métricas derivadas. CTR, CPC, costo por compra, ROAS y costo por
// resultado SIEMPRE se recalculan desde las sumas; nunca se suman cocientes.
// La lectura de Meta está en lib/marketing-publicidad-server.ts.
// Pruebas: tests/marketing-publicidad.test.ts.
import type { UsdRate } from "./marketing-charlie-types";
import type { MarketingAdsData } from "./marketing-source-types";
import type { CharlieAccount } from "./marketing-charlie-types";
import { asUsd } from "./marketing-usd-rate";

export type PublicidadLevel = "campaign" | "adset" | "ad";
export type PublicidadPlatform = "meta" | "tiktok";
export type PublicidadStatus = "active" | "paused" | "other" | "unknown";

export const PUBLICIDAD_LEVELS: readonly PublicidadLevel[] = [
  "campaign",
  "adset",
  "ad",
];

export interface PublicidadBudget {
  /** Major units of the account currency. */
  amount: number;
  kind: "daily" | "lifetime";
  /** "campaign": the ad set has no budget of its own (CBO). */
  scope: "own" | "campaign";
}

/** One row of the table, in the account currency. null = Meta/TikTok gave no value. */
export interface PublicidadRow {
  id: string;
  name: string;
  accountId: string;
  accountName?: string;
  currency: string;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  status: PublicidadStatus;
  statusLabel: string;
  budget: PublicidadBudget | null;
  /** Campaign with a known budget read and none of its own: it lives on the ad sets. */
  budgetInAdsets?: boolean;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number | null;
  purchaseValue: number | null;
  leads: number | null;
  results: number | null;
  /** Meta's result indicator without the `actions:` prefix; "mixed" when the row mixes several. */
  resultType?: string;
  costPerResult: number | null;
}

export interface PublicidadAccount {
  accountId: string;
  accountName: string;
  currency: string;
  /** Status and budget read: "partial" lacks some entities, "unavailable" all of them. */
  entities: "ok" | "partial" | "unavailable";
  /** "unavailable": Meta refused `results` / `cost_per_result` and the report was read without them. */
  results: "ok" | "unavailable";
}

export interface PublicidadPayload {
  platform: PublicidadPlatform;
  /** "pending": the platform is not configured. */
  status: "ready" | "pending";
  message?: string;
  level: PublicidadLevel;
  from: string;
  to: string;
  generatedAt: string;
  accounts: PublicidadAccount[];
  rows: PublicidadRow[];
  /** Accounts that could not be read; the reason never carries provider text. */
  unavailable: Array<{ accountId: string; reason: string }>;
  /** TikTok (sent by Make): last stored day per table, null when nothing was ever sent. */
  tiktok?: { campaignsUntil: string | null; adsUntil: string | null };
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A provider number: absent → 0; present but not a finite number ≥ 0 → throws
 * (the account fails instead of showing a wrong zero).
 */
export function providerNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (!["string", "number"].includes(typeof value))
    throw new Error("Invalid metric");
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Invalid metric");
  return parsed;
}

/* ------------------------------------------------------------- acciones */

/** Same canonical order as `purchasesOf` in lib/marketing-sources.ts. */
export const PURCHASE_ACTIONS = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
];
/**
 * `lead` already includes the pixel leads and the instant-form leads: only
 * the first type present is read, so the same lead is never counted twice.
 */
export const LEAD_ACTIONS = [
  "lead",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.lead_grouped",
];

/**
 * Value of the first of `types` present in a Meta `actions` / `action_values`
 * list (never the sum of several types: they overlap). null when none is.
 */
export function firstAction(actions: unknown, types: string[]): number | null {
  const rows = list(actions).map(obj);
  for (const type of types) {
    const row = rows.find((entry) => entry.action_type === type);
    if (row) return providerNumber(row.value);
  }
  return null;
}

export const purchasesOfActions = (actions: unknown) =>
  firstAction(actions, PURCHASE_ACTIONS) ?? 0;
export const purchaseValueOfActions = (actionValues: unknown) =>
  firstAction(actionValues, PURCHASE_ACTIONS) ?? 0;
export const leadsOfActions = (actions: unknown) =>
  firstAction(actions, LEAD_ACTIONS) ?? 0;

/**
 * Meta's `results` / `cost_per_result`: a list of
 * `{ indicator: "actions:<type>", values: [{ value, attribution_windows }] }`.
 * Tolerant on purpose (the shape changed between Graph versions): it also
 * accepts `{ action_type, value }` entries and a bare number. Several
 * different indicators in one row → value null, type "mixed".
 */
export function metaResult(raw: unknown): {
  value: number | null;
  type: string | null;
} {
  if (typeof raw === "number" || typeof raw === "string") {
    const value = Number(raw);
    return {
      value: raw !== "" && Number.isFinite(value) && value >= 0 ? value : null,
      type: null,
    };
  }
  const entries = list(raw)
    .map(obj)
    .map((entry) => {
      const values = list(entry.values).map(obj);
      const chosen =
        values.find((v) => list(v.attribution_windows).includes("default")) ??
        values[0];
      const amount = Number(chosen ? chosen.value : entry.value);
      const indicator = str(entry.indicator) || str(entry.action_type);
      return {
        type: indicator.replace(/^[a-z_]+:/, "") || null,
        value:
          (chosen ? chosen.value : entry.value) != null &&
          Number.isFinite(amount) &&
          amount >= 0
            ? amount
            : null,
      };
    })
    .filter((entry) => entry.value != null);
  if (!entries.length) return { value: null, type: null };
  const types = Array.from(new Set(entries.map((entry) => entry.type)));
  if (types.length > 1) return { value: null, type: "mixed" };
  return {
    value: entries.reduce((sum, entry) => sum + entry.value!, 0),
    type: types[0],
  };
}

/** Short Spanish name of a result type ("Compras", "Conversaciones"…). */
export function resultTypeLabel(type: string | null | undefined): string {
  const t = (type ?? "").toLowerCase();
  if (!t) return "";
  if (t === "mixed") return "Varios tipos";
  if (t.includes("purchase")) return "Compras";
  if (t.includes("lead")) return "Leads";
  if (t.includes("messaging_conversation") || t.includes("messaging_first"))
    return "Conversaciones";
  if (t.includes("landing_page_view")) return "Visitas a la página";
  if (t.includes("link_click")) return "Clics en el enlace";
  if (t.includes("add_to_cart")) return "Agregados al carrito";
  if (t.includes("initiate_checkout")) return "Pagos iniciados";
  if (t.includes("complete_registration")) return "Registros";
  if (t.includes("view_content")) return "Vistas de contenido";
  if (t.includes("thruplay") || t.includes("video_view"))
    return "Reproducciones";
  if (t.includes("post_engagement") || t.includes("page_engagement"))
    return "Interacciones";
  if (t === "reach") return "Alcance";
  if (t === "impressions") return "Impresiones";
  return "Otro resultado";
}

/* ---------------------------------------------------- insights de Meta */

export interface PublicidadInsight {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
  leads: number;
  results: number | null;
  resultType: string | null;
  costPerResult: number | null;
}

/**
 * One insights row of `level` → metrics. Rows without the id of the level are
 * dropped (null). `purchases` can be injected so the server counts them with
 * the same function as the rest of Marketing.
 */
export function metaInsight(
  raw: unknown,
  level: PublicidadLevel,
  purchases?: number,
): PublicidadInsight | null {
  const row = obj(raw);
  const prefix = level === "campaign" ? "campaign" : level;
  const id = str(row[`${prefix}_id`]);
  if (!id) return null;
  const result = metaResult(row.results);
  const cost = metaResult(row.cost_per_result);
  return {
    id,
    name: str(row[`${prefix}_name`]) || id,
    campaignId: str(row.campaign_id),
    campaignName: str(row.campaign_name),
    adsetId: level === "campaign" ? "" : str(row.adset_id),
    adsetName: level === "campaign" ? "" : str(row.adset_name),
    spend: providerNumber(row.spend),
    impressions: providerNumber(row.impressions),
    clicks: providerNumber(row.clicks),
    purchases: purchases ?? purchasesOfActions(row.actions),
    purchaseValue: purchaseValueOfActions(row.action_values),
    leads: leadsOfActions(row.actions),
    results: result.value,
    resultType: result.type,
    costPerResult: result.type === "mixed" ? null : cost.value,
  };
}

/** The same entity in two pages/rows is added up (never duplicated). */
export function mergeInsights(rows: PublicidadInsight[]): PublicidadInsight[] {
  const merged = new Map<string, PublicidadInsight>();
  for (const row of rows) {
    const current = merged.get(row.id);
    if (!current) {
      merged.set(row.id, { ...row });
      continue;
    }
    current.spend += row.spend;
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    current.purchases += row.purchases;
    current.purchaseValue += row.purchaseValue;
    current.leads += row.leads;
    if (row.resultType !== current.resultType && row.results != null) {
      current.results = current.results == null ? row.results : null;
      current.resultType = current.results == null ? "mixed" : row.resultType;
    } else if (row.results != null)
      current.results = (current.results ?? 0) + row.results;
    // A cost per result cannot be added up: it is recomputed from the sums.
    current.costPerResult = null;
  }
  return Array.from(merged.values());
}

/* --------------------------------------------- estado y presupuesto */

const STATUS_LABELS: Record<string, [PublicidadStatus, string]> = {
  ACTIVE: ["active", "Activo"],
  PAUSED: ["paused", "Pausado"],
  CAMPAIGN_PAUSED: ["paused", "Pausado"],
  ADSET_PAUSED: ["paused", "Pausado"],
  PENDING_REVIEW: ["other", "En revisión"],
  PREAPPROVED: ["other", "En revisión"],
  IN_PROCESS: ["other", "En proceso"],
  PENDING_BILLING_INFO: ["other", "Falta facturación"],
  WITH_ISSUES: ["other", "Con problemas"],
  DISAPPROVED: ["other", "Rechazado"],
  ARCHIVED: ["other", "Archivado"],
  DELETED: ["other", "Eliminado"],
};

/** Meta `effective_status` → status and short Spanish label; "" → unknown ("—"). */
export function publicidadStatus(effectiveStatus: unknown): {
  status: PublicidadStatus;
  statusLabel: string;
} {
  const key = str(effectiveStatus).trim().toUpperCase();
  if (!key) return { status: "unknown", statusLabel: "—" };
  const [status, statusLabel] = STATUS_LABELS[key] ?? ["other", "Otro estado"];
  return { status, statusLabel };
}

/**
 * Meta budgets come in minor units (cents). Same rule as
 * lib/marketing-meta-budgets.ts: only USD and CRC are converted; for any
 * other currency the offset is not guessed (null → "—").
 */
export function metaBudgetAmount(
  value: unknown,
  currency: string,
): number | null {
  if (!["USD", "CRC"].includes(currency)) return null;
  if (!/^\d+$/.test(String(value ?? ""))) return null;
  const amount = Number(value) / 100;
  return amount > 0 ? amount : null;
}

export interface PublicidadEntity {
  id: string;
  name: string;
  campaignId: string;
  adsetId: string;
  effectiveStatus: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
}

/** A row of `/campaigns`, `/adsets` or `/ads` → entity; null without id. */
export function metaEntity(
  raw: unknown,
  currency: string,
): PublicidadEntity | null {
  const row = obj(raw);
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    name: str(row.name),
    campaignId: str(row.campaign_id),
    adsetId: str(row.adset_id),
    effectiveStatus: str(row.effective_status),
    dailyBudget: metaBudgetAmount(row.daily_budget, currency),
    lifetimeBudget: metaBudgetAmount(row.lifetime_budget, currency),
  };
}

/**
 * Budget shown for an entity: its own daily budget, else its own lifetime
 * budget, else (ad sets of a CBO campaign) the campaign's. Ads have none.
 */
export function pickBudget(
  entity: Pick<PublicidadEntity, "dailyBudget" | "lifetimeBudget"> | null,
  campaign?: Pick<PublicidadEntity, "dailyBudget" | "lifetimeBudget"> | null,
): PublicidadBudget | null {
  const own = (
    source: Pick<PublicidadEntity, "dailyBudget" | "lifetimeBudget">,
    scope: PublicidadBudget["scope"],
  ): PublicidadBudget | null =>
    source.dailyBudget != null && source.dailyBudget > 0
      ? { amount: source.dailyBudget, kind: "daily", scope }
      : source.lifetimeBudget != null && source.lifetimeBudget > 0
        ? { amount: source.lifetimeBudget, kind: "lifetime", scope }
        : null;
  return (
    (entity ? own(entity, "own") : null) ??
    (campaign ? own(campaign, "campaign") : null)
  );
}

/* ------------------------------------------------------- filas de Meta */

const hasDelivery = (row: { spend: number; impressions: number }) =>
  row.spend > 0 || row.impressions > 0;

/**
 * Rows of one account: every entity with spend or impressions in the range,
 * plus the ACTIVE ones without delivery (so the team sees what is on).
 * Paused entities without delivery are left out. `entities` null = the status
 * and budget could not be read: the rows stay, with status unknown.
 */
export function buildPublicidadRows(input: {
  level: PublicidadLevel;
  account: { accountId: string; accountName: string; currency: string };
  insights: PublicidadInsight[];
  entities: PublicidadEntity[] | null;
  /** Campaigns of the account (ad set level): CBO budgets and names. */
  campaigns?: PublicidadEntity[] | null;
}): PublicidadRow[] {
  const { level, account } = input;
  const entityById = new Map(
    (input.entities ?? []).map((entity) => [entity.id, entity]),
  );
  const campaignById = new Map(
    ((level === "campaign" ? input.entities : input.campaigns) ?? []).map(
      (entity) => [entity.id, entity],
    ),
  );
  const rows: PublicidadRow[] = [];
  const seen = new Set<string>();
  const push = (
    insight: PublicidadInsight | null,
    entity: PublicidadEntity | null,
  ) => {
    const id = insight?.id ?? entity!.id;
    if (seen.has(id)) return;
    seen.add(id);
    const campaignId =
      level === "campaign"
        ? id
        : insight?.campaignId || entity?.campaignId || "";
    const campaign = campaignById.get(campaignId) ?? null;
    const adsetId =
      level === "ad" ? insight?.adsetId || entity?.adsetId || "" : "";
    const budget =
      level === "campaign"
        ? pickBudget(entity)
        : level === "adset"
          ? pickBudget(entity, campaign)
          : null;
    const spend = round2(insight?.spend ?? 0);
    const results = insight?.results ?? null;
    rows.push({
      id,
      name: entity?.name || insight?.name || id,
      accountId: account.accountId,
      accountName: account.accountName,
      currency: account.currency,
      ...(level !== "campaign" && campaignId
        ? {
            campaignId,
            campaignName: campaign?.name || insight?.campaignName || undefined,
          }
        : {}),
      ...(adsetId
        ? { adsetId, adsetName: insight?.adsetName || undefined }
        : {}),
      ...publicidadStatus(entity?.effectiveStatus),
      budget,
      ...(level === "campaign" &&
      entity &&
      !budget &&
      ["USD", "CRC"].includes(account.currency)
        ? { budgetInAdsets: true }
        : {}),
      spend,
      impressions: insight?.impressions ?? 0,
      clicks: insight?.clicks ?? 0,
      purchases: insight?.purchases ?? 0,
      purchaseValue: round2(insight?.purchaseValue ?? 0),
      leads: insight?.leads ?? 0,
      results,
      ...(insight?.resultType ? { resultType: insight.resultType } : {}),
      costPerResult:
        insight?.costPerResult ??
        (results != null && results > 0 ? round2(spend / results) : null),
    });
  };
  for (const insight of input.insights) {
    const entity = entityById.get(insight.id) ?? null;
    if (hasDelivery(insight) || entity?.effectiveStatus === "ACTIVE")
      push(insight, entity);
  }
  for (const entity of input.entities ?? [])
    if (entity.effectiveStatus === "ACTIVE") push(null, entity);
  return sortPublicidadRows(rows, "spend", "desc");
}

/* ------------------------------------------- filas de TikTok (vía Make) */

/**
 * Campaigns of TikTok from the daily spend Make sends (lib/tiktok-diario.ts).
 * No status, budget, leads, results nor purchase value in that report: null.
 */
export function tiktokCampaignRows(
  accounts: MarketingAdsData[],
): PublicidadRow[] {
  const rows: PublicidadRow[] = accounts.flatMap((account) =>
    account.campaigns.map((campaign) => {
      const days = (campaign.daily ?? []).filter(
        (day) => day.purchases != null,
      );
      return {
        id: campaign.id,
        name: campaign.name || campaign.id,
        accountId: account.accountId,
        accountName: account.accountName || account.accountId,
        currency: account.currency,
        status: "unknown" as const,
        statusLabel: "—",
        budget: null,
        spend: round2(campaign.spend),
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        purchases: days.length
          ? days.reduce((sum, day) => sum + (day.purchases ?? 0), 0)
          : null,
        purchaseValue: null,
        leads: null,
        results: null,
        costPerResult: null,
      };
    }),
  );
  return sortPublicidadRows(rows.filter(hasDelivery), "spend", "desc");
}

/**
 * Ad groups or ads of TikTok from the per-ad daily report Make sends
 * (lib/tiktok-anuncios.ts). Purchases = Complete Payment; a purchase value
 * Make did not send stays null (never 0).
 */
export function tiktokAdRows(
  accounts: CharlieAccount[],
  level: "adset" | "ad",
  filter: { campaign?: string; adset?: string } = {},
): PublicidadRow[] {
  const rows = new Map<string, PublicidadRow>();
  for (const account of accounts) {
    const adsetName = new Map(account.adsets.map((set) => [set.id, set.name]));
    const accountName = account.name.replace(/^TikTok · /, "");
    for (const ad of account.ads) {
      if (filter.campaign && ad.campaignId !== filter.campaign) continue;
      if (filter.adset && ad.adsetId !== filter.adset) continue;
      const id = level === "ad" ? ad.id : ad.adsetId;
      if (!id) continue;
      const key = `${account.id}:${id}`;
      const row = rows.get(key) ?? {
        id,
        name:
          level === "ad" ? ad.name || ad.id : adsetName.get(ad.adsetId) || id,
        accountId: account.id,
        accountName,
        currency: account.currency,
        ...(ad.campaignId
          ? { campaignId: ad.campaignId, campaignName: ad.campaignName }
          : {}),
        ...(level === "ad" && ad.adsetId
          ? { adsetId: ad.adsetId, adsetName: adsetName.get(ad.adsetId) }
          : {}),
        status: "unknown" as const,
        statusLabel: "—",
        budget: null,
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchaseValue: 0 as number | null,
        leads: null,
        results: null,
        costPerResult: null,
      };
      for (const day of ad.daily) {
        row.spend = round2(row.spend + day.spend);
        row.impressions += day.impressions;
        row.clicks += day.clicks;
        row.purchases = (row.purchases ?? 0) + day.purchases;
        row.purchaseValue =
          row.purchaseValue == null || day.purchaseValue == null
            ? null
            : round2(row.purchaseValue + day.purchaseValue);
      }
      rows.set(key, row);
    }
  }
  return sortPublicidadRows(
    Array.from(rows.values()).filter(hasDelivery),
    "spend",
    "desc",
  );
}

/* --------------------------------------------- métricas derivadas y USD */

export interface PublicidadSums {
  spend: number | null;
  impressions: number;
  clicks: number;
  purchases: number | null;
  purchaseValue: number | null;
  leads: number | null;
  results: number | null;
  resultType?: string;
}

export interface PublicidadDerived {
  ctr: number | null;
  cpc: number | null;
  costPerPurchase: number | null;
  roas: number | null;
  costPerResult: number | null;
}

const ratio = (a: number | null, b: number | null) =>
  a != null && b != null && b > 0 ? a / b : null;

/** Every ratio from its own sums; null ("—") when the denominator is 0 or unknown. */
export function derivePublicidad(sums: PublicidadSums): PublicidadDerived {
  return {
    ctr: ratio(sums.clicks, sums.impressions),
    cpc: ratio(sums.spend, sums.clicks),
    costPerPurchase: ratio(sums.spend, sums.purchases),
    roas: ratio(sums.purchaseValue, sums.spend),
    costPerResult: ratio(sums.spend, sums.results),
  };
}

/** A row with its money in USD. `pending`: some amount has no rate (never invented). */
export interface PublicidadUsdRow extends Omit<
  PublicidadRow,
  "spend" | "purchaseValue" | "costPerResult" | "budget"
> {
  spend: number | null;
  purchaseValue: number | null;
  costPerResult: number | null;
  budget: PublicidadBudget | null;
  /** The budget exists but could not be converted. */
  budgetPending: boolean;
  pending: boolean;
  derived: PublicidadDerived;
}

/** Zero is zero in any currency; anything else needs a rate. */
const usd = (amount: number | null, currency: string, fx: UsdRate | null) =>
  amount == null ? null : amount === 0 ? 0 : asUsd(amount, currency, fx);

export function publicidadRowUsd(
  row: PublicidadRow,
  fx: UsdRate | null,
): PublicidadUsdRow {
  const spend = usd(row.spend, row.currency, fx);
  const purchaseValue = usd(row.purchaseValue, row.currency, fx);
  const budgetAmount = row.budget
    ? usd(row.budget.amount, row.currency, fx)
    : null;
  const pending =
    spend == null || (row.purchaseValue != null && purchaseValue == null);
  const sums: PublicidadSums = {
    spend,
    impressions: row.impressions,
    clicks: row.clicks,
    purchases: row.purchases,
    purchaseValue,
    leads: row.leads,
    results: row.results,
  };
  const derived = derivePublicidad(sums);
  return {
    ...row,
    spend,
    purchaseValue,
    budget:
      row.budget && budgetAmount != null
        ? { ...row.budget, amount: budgetAmount }
        : null,
    budgetPending: Boolean(row.budget) && budgetAmount == null,
    // Meta's own cost per result when it came; otherwise spend / results.
    costPerResult:
      row.costPerResult != null
        ? usd(row.costPerResult, row.currency, fx)
        : derived.costPerResult,
    pending,
    derived,
  };
}

/**
 * Totals of the listed rows. Money is null when a row is still pending
 * conversion; results are added only when every row with results shares one
 * type (purchases plus conversations is not a number).
 */
export function publicidadTotals(
  rows: PublicidadUsdRow[],
): PublicidadSums & { derived: PublicidadDerived; count: number } {
  const sumOf = (pick: (row: PublicidadUsdRow) => number | null) => {
    const values = rows.map(pick).filter((v): v is number => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const pending = rows.some((row) => row.pending);
  const withResults = rows.filter(
    (row) => row.results != null || row.resultType === "mixed",
  );
  const types = Array.from(
    new Set(withResults.map((row) => row.resultType ?? "")),
  );
  const sameType = types.length === 1 && types[0] !== "mixed";
  const sums: PublicidadSums = {
    spend: pending
      ? null
      : rows.reduce((sum, row) => sum + (row.spend ?? 0), 0),
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    purchases: sumOf((row) => row.purchases),
    purchaseValue: pending ? null : sumOf((row) => row.purchaseValue),
    leads: sumOf((row) => row.leads),
    results: sameType ? sumOf((row) => row.results) : null,
    ...(types.length ? { resultType: sameType ? types[0] : "mixed" } : {}),
  };
  if (sums.spend != null) sums.spend = round2(sums.spend);
  if (sums.purchaseValue != null)
    sums.purchaseValue = round2(sums.purchaseValue);
  return { ...sums, derived: derivePublicidad(sums), count: rows.length };
}

/* ------------------------------------------------ filtros y ordenamiento */

const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Account, parent campaign / ad set and name search (accent-insensitive). */
export function filterPublicidadRows<
  T extends PublicidadRow | PublicidadUsdRow,
>(
  rows: T[],
  filter: {
    account?: string;
    campaign?: string;
    adset?: string;
    search?: string;
  },
): T[] {
  const needle = fold((filter.search ?? "").trim());
  return rows.filter(
    (row) =>
      (!filter.account || row.accountId === filter.account) &&
      (!filter.campaign || (row.campaignId ?? row.id) === filter.campaign) &&
      (!filter.adset || (row.adsetId ?? row.id) === filter.adset) &&
      (!needle || fold(row.name).includes(needle)),
  );
}

export type PublicidadSortKey =
  | "name"
  | "status"
  | "purchases"
  | "costPerPurchase"
  | "purchaseValue"
  | "roas"
  | "leads"
  | "budget"
  | "spend"
  | "results"
  | "costPerResult"
  | "impressions"
  | "clicks"
  | "ctr";

function sortValue(
  row: PublicidadRow | PublicidadUsdRow,
  key: PublicidadSortKey,
): number | string | null {
  const derived =
    "derived" in row
      ? row.derived
      : derivePublicidad({ ...row, results: row.results });
  switch (key) {
    case "name":
      return fold(row.name);
    case "status":
      return row.statusLabel === "—" ? null : row.statusLabel;
    case "budget":
      return row.budget?.amount ?? null;
    case "costPerPurchase":
      return derived.costPerPurchase;
    case "roas":
      return derived.roas;
    case "ctr":
      return derived.ctr;
    case "costPerResult":
      return row.costPerResult;
    default:
      return row[key];
  }
}

/** Stable sort; rows without the value always go last. */
export function sortPublicidadRows<T extends PublicidadRow | PublicidadUsdRow>(
  rows: T[],
  key: PublicidadSortKey,
  direction: "asc" | "desc",
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, key) }))
    .sort((a, b) => {
      if (a.value == null || b.value == null)
        return a.value == null && b.value == null
          ? a.index - b.index
          : a.value == null
            ? 1
            : -1;
      const order =
        typeof a.value === "string" || typeof b.value === "string"
          ? String(a.value).localeCompare(String(b.value), "es")
          : a.value - b.value;
      return order * sign || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/* ------------------------------------------------------------- columnas */

export type PublicidadColumn =
  | Exclude<PublicidadSortKey, "name">
  | "realOrders";

export const PUBLICIDAD_COLUMNS: ReadonlyArray<{
  id: PublicidadColumn;
  label: string;
  /** Hidden until someone turns it on in "Columnas". */
  optional?: boolean;
}> = [
  { id: "status", label: "Estado" },
  { id: "purchases", label: "Compras" },
  { id: "costPerPurchase", label: "Costo por compra" },
  { id: "purchaseValue", label: "Valor de conversión" },
  { id: "roas", label: "ROAS" },
  { id: "leads", label: "Leads" },
  { id: "budget", label: "Presupuesto" },
  { id: "spend", label: "Importe gastado" },
  { id: "results", label: "Resultados" },
  { id: "costPerResult", label: "Costo por resultado" },
  { id: "impressions", label: "Impresiones" },
  { id: "clicks", label: "Clics" },
  { id: "ctr", label: "CTR" },
  { id: "realOrders", label: "Pedidos reales (UTM) · Kairo", optional: true },
];

/**
 * Columns that have data for a platform and level. TikTok (via Make) has no
 * status, budget, leads nor results, and no purchase value per campaign; the
 * real orders by UTM exist per campaign and per ad, not per ad set.
 */
export function availablePublicidadColumns(
  platform: PublicidadPlatform,
  level: PublicidadLevel,
): PublicidadColumn[] {
  const missing = new Set<PublicidadColumn>();
  if (level === "adset") missing.add("realOrders");
  if (platform === "tiktok") {
    for (const id of [
      "status",
      "leads",
      "budget",
      "results",
      "costPerResult",
    ] as const)
      missing.add(id);
    if (level === "campaign") {
      missing.add("purchaseValue");
      missing.add("roas");
    }
  }
  return PUBLICIDAD_COLUMNS.map((column) => column.id).filter(
    (id) => !missing.has(id),
  );
}

/** Real orders by UTM (Kairo) per row id, from the days of `/api/marketing/control`. */
export function realOrdersByRow(
  days: Array<{
    byCampaign: Record<string, number>;
    byAd: Record<string, number>;
  }>,
  platform: PublicidadPlatform,
  level: PublicidadLevel,
): Map<string, number> | null {
  if (level === "adset") return null;
  const totals = new Map<string, number>();
  const prefix = `${platform}:`;
  for (const day of days)
    for (const [key, orders] of Object.entries(
      level === "campaign" ? day.byCampaign : day.byAd,
    ))
      if (key.startsWith(prefix)) {
        const id = key.slice(prefix.length);
        totals.set(id, (totals.get(id) ?? 0) + orders);
      }
  return totals;
}
