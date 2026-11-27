// Anuncio de Meta que inició el chat de WhatsApp de un pedido (27/11/2026).
//
// iComfly lo devuelve en GET /orders/{id}/whatsapp-ad-origin (Click-to-WhatsApp):
//   { success: true, data: { via, canal, tipo: "anuncio", ad_id, headline,
//     source_url, has_click, received_at, fuente, campaign_id: "", … } }
// y `data: null` cuando el pedido no trae anuncio. Los nombres de campaña y
// conjunto vienen vacíos (iComfly CR no tiene Facebook Ads conectado): Kairo
// cruza el ad_id con su campaña leyendo Meta (lib/icomfly-whatsapp-ad-db.ts) y
// Marketing solo la usa si esa campaña está en el catálogo verificado
// (lib/marketing-origin-catalog.ts). Nunca se adivina por nombre.
//
// Puro: se prueba en tests/icomfly-whatsapp-ad.test.ts.
import {
  readIcomflyAdOrigin,
  type IcomflyAdOrigin,
  type OriginCampaign,
} from "./icomfly-ad-origin";
import { labelNames, orderSubOrigin } from "./marketing-order-facts";

const text = (v: unknown, max = 300) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const adIdOf = (v: unknown): string | null => {
  const s =
    typeof v === "number" && Number.isSafeInteger(v) ? String(v) : text(v, 40);
  return /^[1-9]\d{5,30}$/.test(s) ? s : null;
};
const isObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isoOrNull = (v: unknown): string | null => {
  const s = text(v, 40);
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** What the endpoint says about one order, ready to store. */
export interface ParsedWhatsappAd {
  hasAd: boolean;
  adId: string | null;
  headline: string | null;
  sourceUrl: string | null;
  hasClick: boolean | null;
  receivedAt: string | null;
  via: string | null;
  tipo: string | null;
  /** Only the ad fields of the response (never customer data), strings ≤ 300 chars. */
  raw: Record<string, string | boolean> | null;
}

const RAW_FIELDS = [
  "via",
  "canal",
  "tipo",
  "ad_id",
  "ad_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "headline",
  "source_url",
  "has_click",
  "icomfly_campaign",
  "received_at",
  "fuente",
] as const;

/**
 * Reads the endpoint body. `null` = unknown shape (`success: false`, not an
 * object, `data` of another type): it is not stored as "sin anuncio", the
 * order is retried. `data: null` (or absent with `success: true`) = no ad.
 */
export function parseWhatsappAdOrigin(body: unknown): ParsedWhatsappAd | null {
  if (!isObject(body) || body.success === false) return null;
  if (!("data" in body) && body.success !== true) return null;
  const data = body.data;
  const empty: ParsedWhatsappAd = {
    hasAd: false,
    adId: null,
    headline: null,
    sourceUrl: null,
    hasClick: null,
    receivedAt: null,
    via: null,
    tipo: null,
    raw: null,
  };
  if (data == null) return empty;
  if (!isObject(data)) return null;
  const adId = adIdOf(data.ad_id);
  const tipo = text(data.tipo, 40).toLowerCase() || null;
  const raw: Record<string, string | boolean> = {};
  for (const key of RAW_FIELDS) {
    const value = data[key];
    if (typeof value === "boolean") raw[key] = value;
    else if (typeof value === "string" && value.trim())
      raw[key] = text(value);
    else if (typeof value === "number" && Number.isSafeInteger(value))
      raw[key] = String(value);
  }
  const sourceUrl = text(data.source_url);
  return {
    // An ad id, or iComfly saying it was an ad (even without the id).
    hasAd: Boolean(adId) || tipo === "anuncio",
    adId,
    headline: text(data.headline) || null,
    sourceUrl: /^https:\/\//i.test(sourceUrl) ? sourceUrl : null,
    hasClick: typeof data.has_click === "boolean" ? data.has_click : null,
    receivedAt: isoOrNull(data.received_at),
    via: text(data.via, 40).toLowerCase() || null,
    tipo,
    raw: Object.keys(raw).length ? raw : null,
  };
}

/** Columns of one stored check that Marketing reads. */
export const WHATSAPP_AD_COLUMNS =
  "icomfly_order_id,skipped,has_ad,ad_id,headline,source_url,has_click,raw,meta_status,meta_account_id,campaign_id,adset_id,ad_name,adset_name,campaign_name";

/** A stored check, as Marketing uses it (only checked orders: skipped/failed ones are absent). */
export interface WhatsappAdCheck {
  hasAd: boolean;
  adId: string | null;
  headline: string;
  sourceUrl: string;
  hasClick: boolean;
  /** From Meta (the store's own account), when it could be read. */
  metaAccountId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adName: string;
  adsetName: string;
  campaignName: string;
  /** Campaign id iComfly itself sent (empty while its Facebook Ads are not connected). */
  icomflyCampaignId: string | null;
}

/** DB row → check; null when the order was not checked (skipped, failed or missing). */
export function whatsappAdCheckOf(row: unknown): WhatsappAdCheck | null {
  if (!isObject(row) || row.skipped === true) return null;
  if (typeof row.has_ad !== "boolean") return null;
  const raw = isObject(row.raw) ? row.raw : {};
  const metaOk = row.meta_status === "ok";
  return {
    hasAd: row.has_ad,
    adId: row.has_ad ? adIdOf(row.ad_id) : null,
    headline: text(row.headline),
    sourceUrl: text(row.source_url),
    hasClick: row.has_click === true,
    metaAccountId: metaOk ? text(row.meta_account_id, 40) || null : null,
    campaignId: metaOk ? adIdOf(row.campaign_id) : null,
    adsetId: metaOk ? adIdOf(row.adset_id) : null,
    adName: text(row.ad_name) || text(raw.ad_name),
    adsetName: text(row.adset_name) || text(raw.adset_name),
    campaignName: text(row.campaign_name) || text(raw.campaign_name),
    icomflyCampaignId: adIdOf(raw.campaign_id),
  };
}

/**
 * The WhatsApp ad as an ad origin, like a web UTM with an ad id. The campaign
 * only when it is verified in the store's catalog (Meta platform, same
 * account when Meta told it); otherwise the ad id stays without campaign.
 * Meta and iComfly naming different campaigns is a conflict: no attribution.
 */
export function whatsappAdOrigin(
  check: WhatsappAdCheck | null | undefined,
  catalog: OriginCampaign[],
): IcomflyAdOrigin | null {
  if (!check?.hasAd) return null;
  const verified = (campaignId: string | null, accountId: string | null) => {
    if (!campaignId) return false;
    const accounts = new Set(
      catalog
        .filter((c) => c.platform === "meta" && c.campaignId === campaignId)
        .map((c) => c.accountId),
    );
    return accountId ? accounts.has(accountId) : accounts.size === 1;
  };
  const conflicts: string[] = [];
  const fromMeta = verified(check.campaignId, check.metaAccountId)
    ? check.campaignId
    : null;
  const fromIcomfly = verified(check.icomflyCampaignId, null)
    ? check.icomflyCampaignId
    : null;
  if (
    check.campaignId &&
    check.icomflyCampaignId &&
    check.campaignId !== check.icomflyCampaignId
  )
    conflicts.push("campaign");
  const campaignId = conflicts.length ? null : (fromMeta ?? fromIcomfly);
  return {
    platform: "meta",
    source: "",
    medium: "",
    campaign: "",
    content: "",
    term: "",
    campaignId,
    adsetId: campaignId && campaignId === fromMeta ? check.adsetId : null,
    adId: check.adId,
    campaignName: campaignId ? check.campaignName : "",
    adsetName: campaignId ? check.adsetName : "",
    adName: check.adName,
    hasClick: check.hasClick,
    origin: "whatsapp",
    conflicts,
    via: "whatsapp",
    headline: check.headline,
  };
}

/** Ad origin of a Marketing row: the captured web UTM wins; else the WhatsApp ad. */
export function rowAdOrigin(
  adOrigin: unknown,
  check: WhatsappAdCheck | null | undefined,
  catalog: OriginCampaign[],
): IcomflyAdOrigin | null {
  return readIcomflyAdOrigin(adOrigin) ?? whatsappAdOrigin(check, catalog);
}

/** Small JSON paths of one iComfly payload that decide whether to ask. */
export interface WhatsappCandidateSignals {
  order_number?: unknown;
  shopify_display_number?: unknown;
  sales_channel?: unknown;
  labels?: unknown;
  creator?: unknown;
  ad_origin?: unknown;
}

const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

/**
 * Whether the order can come from a WhatsApp chat: every WhatsApp origin
 * (label "Venta por bot" or channel whatsapp, creator "Conector IA", any
 * other creator, "MANUAL-…"), and the web form / recovered cart without web
 * UTMs. Not: Shopify orders, and web-form orders that already carry UTMs.
 */
export function isWhatsappCandidate(signals: WhatsappCandidateSignals): boolean {
  const origin = orderSubOrigin({
    shopifyNumber: str(signals.shopify_display_number) || null,
    labels: labelNames(signals.labels),
    salesChannel: str(signals.sales_channel) || null,
    creator: str(signals.creator) || null,
    orderNumber: signals.order_number,
  });
  if (origin === "shopify") return false;
  if (origin === "formulario" || origin === "carrito")
    return readIcomflyAdOrigin(signals.ad_origin) == null;
  return true;
}

/** Previous state of a stored check, for the selection. */
export interface StoredCheckState {
  has_ad: boolean | null;
  skipped: boolean;
  attempts: number;
  checked_at: string;
}

export const RECHECK_AFTER_MS = 48 * 3600_000;
/** A check without ad (or skipped) is looked at once more, after 2 days. */
export const MAX_ATTEMPTS_NO_AD = 2;
/** An order whose request failed is retried up to this many times in total. */
export const MAX_ATTEMPTS_ERROR = 3;

/**
 * Whether the order needs a (new) look: never checked; failed less than 3
 * times; or without ad / skipped once, 2 days ago or more (the chat can be
 * linked later). An order with ad is final.
 */
export function dueForCheck(
  prev: StoredCheckState | null | undefined,
  nowMs: number,
): boolean {
  if (!prev) return true;
  if (prev.has_ad === true) return false;
  const attempts = Number(prev.attempts) || 0;
  if (prev.has_ad == null && !prev.skipped)
    return attempts < MAX_ATTEMPTS_ERROR;
  if (attempts >= MAX_ATTEMPTS_NO_AD) return false;
  const checked = Date.parse(prev.checked_at);
  return !Number.isFinite(checked) || nowMs - checked >= RECHECK_AFTER_MS;
}
