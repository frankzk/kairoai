// Secciones de /api/marketing/insights (módulos 4–12). Solo servidor.
// Cada sección tiene su propia caché en memoria (por instancia) para que abrir
// la pestaña Análisis varias veces no repita lecturas pesadas ni llamadas a
// Meta: pedidos y productos 5 min, cuentas 10 min, segmentación 60 min.
import { getOrdersDataset } from "@/app/api/finance/_shared/orders-dataset";
import { getDB } from "./db";
import { buildFinanceControlCenter } from "./finance-orders";
import type { marketingAccess } from "./marketing-access";
import { readCharlieSettings } from "./marketing-charlie-settings";
import type { UsdRate } from "./marketing-charlie-types";
import {
  dateTime,
  MARKETING_DAY,
  marketingDate,
  shiftDate,
} from "./marketing-dates";
import type {
  AccountsPayload,
  InsightSection,
  OrderFactsPayload,
  ProductInsightsPayload,
  SegmentationPayload,
  TiktokFeedStatus,
} from "./marketing-insights-types";
import {
  readMetaAccountStatuses,
  readMetaAgeGender,
} from "./marketing-meta-accounts";
import { encodeOrderFacts } from "./marketing-order-facts";
import {
  listOrderFactRows,
  readRepeatOrders,
} from "./marketing-order-facts-db";
import { buildProductInsights } from "./marketing-product-insights";
import { readMarketingProductCatalog } from "./marketing-product-groups-db";
import { MARKETING_TARGETS } from "./marketing-targets";
import { getMarketingPenRate, getMarketingUsdRate } from "./marketing-usd-rate";
import { buildVariantIndex } from "./marketing-variant-keys";
import { TABLA as TIKTOK_TABLE } from "./tiktok-diario";

type Store = NonNullable<ReturnType<typeof marketingAccess>>["store"];

export const INSIGHT_TTL_MS: Record<InsightSection, number> = {
  pedidos: 5 * 60_000,
  productos: 5 * 60_000,
  cuentas: 10 * 60_000,
  segmentacion: 60 * 60_000,
};
const MAX_ENTRIES = 30;
/**
 * Days loaded before the end of the period (or yesterday) so complement drops
 * always have 5 complete weeks.
 */
export const FACTS_MIN_DAYS = 35;
const DATASET_TIMEOUT_MS = 45_000;

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Test hook: empties the in-memory cache. */
export function clearInsightCache() {
  cache.clear();
}

/**
 * Returns the cached value of `key` while fresh, else runs `load` once (the
 * in-flight promise is shared). Failures are never cached.
 */
export function cachedInsight<T>(
  key: string,
  section: InsightSection,
  load: () => Promise<T>,
  options: { refresh?: boolean; now?: number } = {},
): Promise<T> {
  const now = options.now ?? Date.now();
  const hit = cache.get(key);
  if (hit && !options.refresh && now - hit.at < INSIGHT_TTL_MS[section])
    return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: now, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  while (cache.size > MAX_ENTRIES) {
    const oldest = Array.from(cache.entries()).sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    cache.delete(oldest[0]);
  }
  return value;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Insight timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** M7, M8, M10 references, M12 provinces: anonymous order facts + repeat purchases. */
export async function orderFactsSection(
  store: Store,
  from: string,
  to: string,
  now = new Date(),
): Promise<OrderFactsPayload> {
  const today = marketingDate(now);
  const yesterday = shiftDate(today, -1);
  const lastComplete = to < yesterday ? to : yesterday;
  const minimum = shiftDate(lastComplete, -(FACTS_MIN_DAYS - 1));
  const loadedFrom = from < minimum ? from : minimum;
  const startIso = new Date(dateTime(loadedFrom)).toISOString();
  const endIso = new Date(dateTime(to) + MARKETING_DAY).toISOString();
  const [read, repeat] = await withTimeout(
    Promise.all([
      listOrderFactRows(store.id, startIso, endIso),
      readRepeatOrders(
        store.id,
        startIso,
        endIso,
        MARKETING_TARGETS.repeatMinDays,
      ),
    ]),
    DATASET_TIMEOUT_MS,
  );
  return {
    ...encodeOrderFacts(read.rows, { from, to, loadedFrom, today }, now),
    repeat,
    truncated: read.truncated,
  };
}

/** M5 per-variant demand and waiting proxy, M6 weekly units. */
export async function productInsightsSection(
  store: Store,
  now = new Date(),
): Promise<ProductInsightsPayload> {
  const [dataset, catalog] = await withTimeout(
    Promise.all([
      getOrdersDataset(store, [
        "rows",
        "matchedSettlementRows",
        "imports",
        "settlementTraceByKey",
      ]),
      // Without the catalog the keys are the plain order keys (variantAware: false).
      readMarketingProductCatalog(store.id).catch(() => null),
    ]),
    DATASET_TIMEOUT_MS,
  );
  const orders = buildFinanceControlCenter(
    dataset.rows,
    dataset.matchedSettlementRows,
    dataset.imports,
    [],
    [],
    dataset.settlementTraceByKey,
  ).orders;
  return buildProductInsights({
    orders,
    rows: dataset.rows,
    index: catalog ? buildVariantIndex(catalog) : null,
    today: marketingDate(now),
    now,
  });
}

/** Most advertisers looked up one by one after the newest rows (bounded). */
const TIKTOK_FEED_MAX_ADVERTISERS = 20;

/**
 * Last day Make sent TikTok spend, per advertiser. The newest rows give the
 * active advertisers; then each advertiser not seen yet is looked up by its
 * newest row, so one whose feed stopped long ago still shows as late.
 */
export async function readTiktokFeed(
  storeId: number,
): Promise<TiktokFeedStatus[]> {
  const columns = "advertiser_id,advertiser_name,fecha,updated_at";
  const { data, error } = await getDB()
    .from(TIKTOK_TABLE)
    .select(columns)
    .eq("store_id", storeId)
    .order("fecha", { ascending: false })
    .limit(1000);
  if (error) throw new Error("TikTok feed unavailable");
  const rows = [...((data ?? []) as Array<Record<string, unknown>>)];
  const seen = new Set(
    rows.map((row) => String(row.advertiser_id ?? "")).filter(Boolean),
  );
  for (let i = 0; i < TIKTOK_FEED_MAX_ADVERTISERS; i++) {
    let query = getDB()
      .from(TIKTOK_TABLE)
      .select(columns)
      .eq("store_id", storeId)
      .not("advertiser_id", "is", null);
    if (seen.size)
      query = query.not(
        "advertiser_id",
        "in",
        `(${Array.from(seen)
          .map((id) => `"${id.replace(/["\\]/g, "")}"`)
          .join(",")})`,
      );
    const older = await query.order("fecha", { ascending: false }).limit(1);
    if (older.error) throw new Error("TikTok feed unavailable");
    const row = (older.data ?? [])[0] as Record<string, unknown> | undefined;
    const id = String(row?.advertiser_id ?? "");
    if (!row || !id || seen.has(id)) break;
    seen.add(id);
    rows.push(row);
  }
  const byAdvertiser = new Map<string, TiktokFeedStatus>();
  for (const row of rows) {
    const id = String(row.advertiser_id ?? "");
    if (!id) continue;
    const date = String(row.fecha ?? "").slice(0, 10) || null;
    const updated = row.updated_at
      ? new Date(String(row.updated_at)).toISOString()
      : null;
    const current = byAdvertiser.get(id) ?? {
      advertiserId: id,
      name: String(row.advertiser_name ?? "").slice(0, 120),
      lastDate: null,
      updatedAt: null,
    };
    if (date && (!current.lastDate || date > current.lastDate))
      current.lastDate = date;
    if (updated && (!current.updatedAt || updated > current.updatedAt))
      current.updatedAt = updated;
    byAdvertiser.set(id, current);
  }
  return Array.from(byAdvertiser.values());
}

/** M11: account status (one light Meta call per account), TikTok feed and applied rates. */
export async function accountsSection(
  store: Store,
  now = new Date(),
): Promise<AccountsPayload> {
  const [meta, tiktok, fx] = await Promise.all([
    readMetaAccountStatuses().then(
      (accounts) => ({ accounts, error: false }),
      () => ({ accounts: null, error: true }),
    ),
    readTiktokFeed(store.id).then(
      (feed) => ({ feed, error: false }),
      () => ({ feed: [] as TiktokFeedStatus[], error: true }),
    ),
    readCharlieSettings(store.id).then(
      (settings) => settings.fx,
      async (): Promise<UsdRate> => ({
        ...(await getMarketingUsdRate()),
        pen: await getMarketingPenRate(),
      }),
    ),
  ]);
  return {
    checkedAt: now.toISOString(),
    meta: meta.accounts,
    metaError: meta.error,
    tiktok: tiktok.feed,
    tiktokError: tiktok.error,
    fx,
  };
}

/** M12: Meta spend and pixel purchases per age × gender (on demand). */
export async function segmentationSection(
  from: string,
  to: string,
): Promise<SegmentationPayload> {
  const result = await readMetaAgeGender(process.env, fetch, from, to);
  return { from, to, ...result };
}
