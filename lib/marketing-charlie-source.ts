import { createHash } from "crypto";
import { metaAccountIds } from "./marketing-sources";
import {
  marketingDate,
  marketingPeriod,
  shiftDate,
  type MarketingPeriod,
} from "./marketing-dates";
import type {
  CharlieAccount,
  CharlieAd,
  CharlieAdset,
  CharlieReport,
} from "./marketing-charlie-types";
type Json = Record<string, unknown>;
const metadataCache = new Map<
  string,
  { at: number; promise: Promise<[Json[] | null, Json[] | null]> }
>();
const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown) => (Array.isArray(value) ? value : []);
function metric(value: unknown) {
  const number = Number(value);
  if (value == null || value === "" || !Number.isFinite(number) || number < 0)
    throw new Error("Invalid metric");
  return number;
}
function action(rows: unknown, names: string[]): number | null {
  const entries = list(rows).map(object);
  for (const name of names) {
    const row = entries.find((row) => row.action_type === name);
    if (row) return metric(row.value);
  }
  return null;
}
async function account(
  id: string,
  period: MarketingPeriod,
  env: Record<string, string | undefined>,
  fetcher: typeof fetch,
  signal: AbortSignal,
  includeStructure: boolean,
  structureOnly = false,
): Promise<CharlieAccount> {
  const base = `https://graph.facebook.com/${env.META_CR_GRAPH_VERSION}/act_${id}`,
    headers = { Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}` };
  async function read(url: URL) {
    const response = await fetcher(url, {
      headers,
      signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Meta unavailable");
    const body = object(await response.json());
    if (body.error) throw new Error("Meta error");
    return body;
  }
  async function pages(edge: string, fields: string, insights = false) {
    const rows: Json[] = [];
    let after = "";
    for (let page = 0; page < 25; page++) {
      const url = new URL(`${base}/${edge}`);
      url.searchParams.set("fields", fields);
      url.searchParams.set("limit", insights ? "500" : "100");
      if (after) url.searchParams.set("after", after);
      if (structureOnly && edge === "ads")
        url.searchParams.set("effective_status", JSON.stringify(["ACTIVE"]));
      if (insights) {
        url.searchParams.set("level", structureOnly ? "adset" : "ad");
        if (!structureOnly) url.searchParams.set("time_increment", "1");
        url.searchParams.set(
          "time_range",
          JSON.stringify({ since: period.from, until: period.to }),
        );
        url.searchParams.set(
          "action_attribution_windows",
          JSON.stringify(["7d_click", "1d_view"]),
        );
      }
      const body = await read(url);
      if (!Array.isArray(body.data))
        throw new Error("Incomplete Meta response");
      rows.push(...body.data.map(object));
      const paging = object(body.paging);
      if (!paging.next) return rows;
      const cursor = string(object(paging.cursors).after);
      if (!cursor || cursor === after) throw new Error("Incomplete pagination");
      after = cursor;
    }
    throw new Error("Meta report too large");
  }
  const infoUrl = new URL(base);
  infoUrl.searchParams.set("fields", "id,name,currency,timezone_name");
  const info = await read(infoUrl);
  if (
    info.id !== `act_${id}` ||
    !/^[A-Z]{3}$/.test(string(info.currency)) ||
    !string(info.timezone_name)
  )
    throw new Error("Invalid account");
  const metadataKey = createHash("sha256")
    .update(
      JSON.stringify([
        id,
        env.META_CR_GRAPH_VERSION,
        env.META_CR_ACCESS_TOKEN,
        structureOnly,
      ]),
    )
    .digest("hex");
  const useCache = includeStructure && fetcher === fetch;
  let metadata = useCache ? metadataCache.get(metadataKey) : undefined;
  if (!includeStructure)
    metadata = { at: Date.now(), promise: Promise.resolve([[], []]) };
  if (!metadata || Date.now() - metadata.at > 300000) {
    const promise = Promise.all([
      pages(
        "ads",
        "id,name,adset_id,campaign_id,effective_status,creative{id,effective_object_story_id,asset_feed_spec}",
      ).catch(() =>
        pages(
          "ads",
          "id,name,adset_id,campaign_id,effective_status,creative{id,effective_object_story_id}",
        ).catch(() => null),
      ),
      pages(
        "adsets",
        "id,name,campaign_id,effective_status,is_dynamic_creative",
      ).catch(() => null),
    ]);
    metadata = { at: Date.now(), promise };
    if (useCache) {
      if (metadataCache.size >= 20) metadataCache.clear();
      metadataCache.set(metadataKey, metadata);
    }
  }
  void metadata.promise.then(([ads, sets]) => {
    if (!ads || !sets) metadataCache.delete(metadataKey);
  });
  const [rows, [adsMeta, loadedSets]] = await Promise.all([
    pages(
      "insights",
      structureOnly
        ? "adset_id,spend"
        : `ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,frequency,actions,action_values${includeStructure ? "" : ",adset_name,campaign_name"}`,
      true,
    ),
    metadata.promise,
  ]);
  const setsMeta: Json[] | null = includeStructure
    ? loadedSets
    : Array.from(
        new Map(
          rows.map((row) => [
            string(row.adset_id),
            {
              id: row.adset_id,
              name: row.adset_name,
              campaign_id: row.campaign_id,
            },
          ]),
        ).values(),
      );
  if (!adsMeta || !setsMeta) metadataCache.delete(metadataKey);
  const ads = new Map<string, CharlieAd>();
  const makeAd = (
    id: string,
    name: string,
    adsetId: string,
    campaignId: string,
  ): CharlieAd => ({
    id,
    name: name || id,
    adsetId,
    campaignId,
    effectiveStatus: "",
    postId: null,
    creativeId: null,
    assets: null,
    daily: [],
  });
  const setSpend = new Map<string, number>();
  for (const row of rows) {
    if (structureOnly) {
      const setId = string(row.adset_id);
      if (!/^\d+$/.test(setId) || setSpend.has(setId))
        throw new Error("Invalid adset report");
      setSpend.set(setId, metric(row.spend));
      continue;
    }
    const adId = string(row.ad_id),
      date = string(row.date_start);
    if (
      !/^\d+$/.test(adId) ||
      !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
      date < period.from ||
      date > period.to ||
      !/^\d+$/.test(string(row.adset_id)) ||
      !/^\d+$/.test(string(row.campaign_id))
    )
      throw new Error("Invalid ad report");
    const ad =
      ads.get(adId) ??
      makeAd(
        adId,
        string(row.ad_name),
        string(row.adset_id),
        string(row.campaign_id),
      );
    if (ad.daily.some((day) => day.date === date))
      throw new Error("Duplicate daily report");
    if (!includeStructure) {
      ad.adsetName = string(row.adset_name) || undefined;
      ad.campaignName = string(row.campaign_name) || undefined;
    }
    const purchases =
      action(row.actions, [
        "omni_purchase",
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
      ]) ?? 0;
    const value = action(row.action_values, [
      "omni_purchase",
      "purchase",
      "offsite_conversion.fb_pixel_purchase",
    ]);
    const frequency = row.frequency == null ? null : metric(row.frequency);
    ad.daily.push({
      date,
      spend: metric(row.spend),
      impressions: metric(row.impressions),
      clicks: metric(row.clicks),
      frequency: frequency && frequency > 0 ? frequency : null,
      purchases,
      purchaseValue: purchases > 0 ? value : (value ?? 0),
      interactions: action(row.actions, ["post_engagement"]) ?? 0,
    });
    ads.set(adId, ad);
  }
  for (const row of adsMeta ?? []) {
    const id = string(row.id);
    if (!/^\d+$/.test(id)) throw new Error("Invalid ad metadata");
    const ad =
      ads.get(id) ??
      makeAd(
        id,
        string(row.name),
        string(row.adset_id),
        string(row.campaign_id),
      );
    const creative = object(row.creative),
      spec = object(creative.asset_feed_spec),
      post =
        string(creative.effective_object_story_id) ||
        string(creative.object_story_id);
    ad.effectiveStatus = string(row.effective_status);
    ad.creativeId = string(creative.id) || null;
    ad.postId = /^\d+_\d+$/.test(post) ? post : null;
    ad.assets = Object.keys(spec).length
      ? {
          creatives:
            Array.isArray(spec.images) || Array.isArray(spec.videos)
              ? list(spec.images).length + list(spec.videos).length
              : null,
          bodies: Array.isArray(spec.bodies) ? list(spec.bodies).length : null,
          titles: Array.isArray(spec.titles) ? list(spec.titles).length : null,
        }
      : null;
    ads.set(id, ad);
  }
  const adsets: CharlieAdset[] = (setsMeta ?? []).map((row) => ({
    id: string(row.id),
    name: string(row.name),
    campaignId: string(row.campaign_id),
    effectiveStatus: string(row.effective_status),
    dynamic: row.is_dynamic_creative === true,
    ...(structureOnly
      ? { periodSpend: setSpend.get(string(row.id)) ?? 0 }
      : {}),
  }));
  return {
    id,
    name: string(info.name) || id,
    currency: string(info.currency),
    timezone: string(info.timezone_name),
    ads: Array.from(ads.values()),
    adsets,
    ...(structureOnly ? { creativeScope: "active" as const } : {}),
    ...(!includeStructure || !adsMeta || !setsMeta
      ? {
          metadataMessage: includeStructure
            ? "Los resultados están disponibles, pero la estructura o los Post IDs no se pudieron consultar por completo."
            : "Los metadatos completos se consultan al abrir Control y Testing.",
        }
      : {}),
  };
}
export async function getCharlieReport(
  period: MarketingPeriod,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
  now = new Date(),
  /**
   * Cuentas de TikTok por anuncio (lib/tiktok-anuncios.ts, enviadas por Make).
   * Si fallan, el reporte sigue con Meta: no se pierde la matriz por TikTok.
   */
  tiktok?: (from: string, to: string) => Promise<CharlieAccount[]>,
  includeStructure = true,
  includeTrailing = true,
  structureOnly = false,
): Promise<CharlieReport> {
  const checkedAt = now.toISOString();
  if (
    !env.META_CR_ACCESS_TOKEN ||
    !/^v\d+\.\d+$/.test(env.META_CR_GRAPH_VERSION || "") ||
    !(env.META_CR_AD_ACCOUNT_IDS || env.META_CR_AD_ACCOUNT_ID)
  )
    return {
      status: "pending",
      checkedAt,
      message: "Falta configurar la lectura de las cuentas Meta de Costa Rica.",
      data: null,
    };
  const today = marketingDate(now),
    trailTo = period.to < today ? period.to : today,
    trailFrom = includeTrailing ? shiftDate(trailTo, -6) : period.from;
  const expanded = marketingPeriod(
    period.from < trailFrom ? period.from : trailFrom,
    trailTo,
  );
  if (!expanded)
    return {
      status: "error",
      checkedAt,
      message: "Elige un período válido sin días futuros.",
      data: null,
    };
  try {
    const signal = AbortSignal.timeout(40_000);
    const [meta, deTiktok] = await Promise.all([
      Promise.all(
        metaAccountIds(env).map((id) =>
          account(
            id,
            expanded,
            env,
            fetcher,
            signal,
            includeStructure,
            structureOnly,
          ),
        ),
      ),
      tiktok
        ? tiktok(expanded.from, expanded.to).catch(() => null)
        : Promise.resolve([] as CharlieAccount[]),
    ]);
    const accounts = [...meta, ...(deTiktok ?? [])];
    return {
      status: "ready",
      checkedAt,
      message:
        deTiktok === null
          ? "Lectura de anuncios de Meta completada; TikTok no se pudo leer."
          : "Lectura de anuncios y estructura completada.",
      data: { accounts, from: period.from, to: period.to, trailFrom, trailTo },
    };
  } catch {
    return {
      status: "error",
      checkedAt,
      data: null,
      message:
        "No se pudieron consultar todos los anuncios de las cuentas de Costa Rica. Actualiza o reduce el rango de fechas.",
    };
  }
}
