// Server-only consumers: tokens are read here, never returned to the browser.
import {
  periodFromInput,
  marketingDate,
  shiftDate,
  type MarketingPeriod,
} from "./marketing-dates";
import {
  readMetaCampaignCatalog,
  type MetaCampaignBudget,
} from "./marketing-meta-budgets";
import {
  changesFromUpdatedTime,
  readMetaActivities,
} from "./marketing-meta-activity";
import type {
  CampaignLifetime,
  MarketingAdsAccounts,
  MarketingAdsData,
  MarketingCampaign,
  MarketingHourlySpend,
  MarketingSource,
  MarketingSources,
  MarketingStock,
} from "./marketing-source-types";

type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");
function metric(value: unknown): number {
  if (
    value == null ||
    value === "" ||
    !["string", "number"].includes(typeof value)
  )
    throw new Error("Invalid metric");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid metric");
  return parsed;
}
function campaigns(rows: MarketingCampaign[]): MarketingCampaign[] {
  const grouped = new Map<string, MarketingCampaign>();
  for (const row of rows) {
    if (!row.id) throw new Error("Missing campaign identifier");
    const current = grouped.get(row.id) ?? {
      id: row.id,
      name: row.name || row.id,
      spend: 0,
      impressions: 0,
      clicks: 0,
    };
    if (row.daily) current.daily = [...(current.daily ?? []), ...row.daily];
    if (row.purchases !== undefined)
      current.purchases = (current.purchases ?? 0) + (row.purchases ?? 0);
    current.spend += row.spend;
    current.impressions += row.impressions;
    current.clicks += row.clicks;
    grouped.set(row.id, current);
  }
  return Array.from(grouped.values())
    .map((row) => ({ ...row, spend: Math.round(row.spend * 100) / 100 }))
    .sort((a, b) => b.spend - a.spend);
}

const PURCHASE_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
];
export const ATTRIBUTION_WINDOWS = JSON.stringify(["7d_click", "1d_view"]);
/** The first canonical purchase type only, so the same purchase is never counted twice. */
export function purchasesOf(row: Json): number {
  const actions = list(row.actions).map(obj);
  const purchase = PURCHASE_TYPES.map((type) =>
    actions.find((action) => action.action_type === type),
  ).find(Boolean);
  return purchase ? metric(purchase.value) : 0;
}

/** `"14:00:00 - 14:59:59"` → 14; anything else → null. */
export function hourOfBreakdown(value: unknown): number | null {
  const match = /^(\d{2}):00:00\s*-\s*\d{2}:59:59$/.exec(str(value).trim());
  const hour = match ? Number(match[1]) : NaN;
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

async function json(
  fetcher: typeof fetch,
  url: string | URL,
  init: RequestInit,
): Promise<Json> {
  const response = await fetcher(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error("Provider HTTP error");
  return obj(await response.json());
}

async function source<T>(
  configured: boolean,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<MarketingSource<T>> {
  if (!configured)
    return {
      status: "pending",
      checkedAt: new Date().toISOString(),
      message: "Pendiente de configurar acceso de lectura.",
      data: null,
    };
  try {
    const data = await load(AbortSignal.timeout(25_000));
    return {
      status: "ready",
      checkedAt: new Date().toISOString(),
      message: "Consulta de lectura completada.",
      data,
    };
  } catch {
    // Provider messages can echo credentials and account details. Never forward them.
    return {
      status: "error",
      checkedAt: new Date().toISOString(),
      message:
        "No se pudo consultar la fuente. Revisa acceso, permisos, límites y configuración de la cuenta.",
      data: null,
    };
  }
}

export function metaAccountIds(env: Env): string[] {
  const value = env.META_CR_AD_ACCOUNT_IDS || env.META_CR_AD_ACCOUNT_ID || "";
  const ids = Array.from(
    new Set(value.split(",").map((id) => id.trim().replace(/^act_/, ""))),
  );
  if (!ids.length || ids.length > 10 || ids.some((id) => !/^\d+$/.test(id)))
    throw new Error("Invalid Meta account list");
  return ids;
}

interface MetaExtras {
  /** Account-level spend per hour for these CR dates (only CR time-zone accounts). */
  hourly?: { from: string; to: string };
  /** Spend and pixel purchases since launch per campaign. */
  lifetime?: boolean;
  /** Activity log since the period start (falls back to `updated_time`). */
  activities?: boolean;
  now?: Date;
}

export async function metaPages(
  fetcher: typeof fetch,
  build: (after: string) => URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Json[]> {
  const rows: Json[] = [];
  let after = "";
  for (let page = 0; page < 25; page++) {
    const body = await json(fetcher, build(after), { headers, signal });
    if (body.error || !Array.isArray(body.data))
      throw new Error("Invalid Meta report");
    rows.push(...body.data.map(obj));
    const paging = obj(body.paging);
    if (!paging.next) return rows;
    const cursor = str(obj(paging.cursors).after);
    if (!cursor || cursor === after) throw new Error("Incomplete Meta report");
    after = cursor;
  }
  throw new Error("Meta pagination limit");
}

/** Lifetime spend and pixel purchases per campaign (`date_preset=maximum`). */
async function metaLifetime(
  base: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<Map<string, { spend: number; purchases: number }>> {
  const rows = await metaPages(
    fetcher,
    (after) => {
      const url = new URL(`${base}/insights`);
      url.searchParams.set("fields", "campaign_id,spend,actions");
      url.searchParams.set("level", "campaign");
      url.searchParams.set("date_preset", "maximum");
      url.searchParams.set("action_attribution_windows", ATTRIBUTION_WINDOWS);
      url.searchParams.set("limit", "500");
      if (after) url.searchParams.set("after", after);
      return url;
    },
    headers,
    signal,
  );
  const totals = new Map<string, { spend: number; purchases: number }>();
  for (const row of rows) {
    const id = str(row.campaign_id);
    if (!id) throw new Error("Missing campaign identifier");
    const current = totals.get(id) ?? { spend: 0, purchases: 0 };
    current.spend += metric(row.spend);
    current.purchases += purchasesOf(row);
    totals.set(id, current);
  }
  return totals;
}

/** Account spend per hour of the account day (`hourly_stats_aggregated_by_advertiser_time_zone`). */
async function metaHourly(
  base: string,
  range: { from: string; to: string },
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<MarketingHourlySpend> {
  const rows = await metaPages(
    fetcher,
    (after) => {
      const url = new URL(`${base}/insights`);
      url.searchParams.set("fields", "spend");
      url.searchParams.set("level", "account");
      url.searchParams.set("time_increment", "1");
      url.searchParams.set(
        "breakdowns",
        "hourly_stats_aggregated_by_advertiser_time_zone",
      );
      url.searchParams.set(
        "time_range",
        JSON.stringify({ since: range.from, until: range.to }),
      );
      url.searchParams.set("limit", "500");
      if (after) url.searchParams.set("after", after);
      return url;
    },
    headers,
    signal,
  );
  const days = new Map<string, number[]>();
  for (const row of rows) {
    const date = str(row.date_start);
    const hour = hourOfBreakdown(
      row.hourly_stats_aggregated_by_advertiser_time_zone,
    );
    if (
      !/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
      date < range.from ||
      date > range.to ||
      hour == null
    )
      throw new Error("Invalid hourly row");
    const hours = days.get(date) ?? Array<number>(24).fill(0);
    hours[hour] += metric(row.spend);
    days.set(date, hours);
  }
  return {
    ...range,
    days: Array.from(days, ([date, hours]) => ({
      date,
      hours: hours.map((v) => Math.round(v * 100) / 100),
    })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Budgets/bids, lifetime, activity log and hourly spend. None of them may fail
 * the account: each failure only leaves a message (spend stays usable).
 */
async function enrichMetaAccount(
  result: MarketingAdsData,
  base: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
  extra: MetaExtras & { details: boolean; since: string },
) {
  const needCatalog = extra.details || extra.lifetime || extra.activities;
  const hourlyAllowed = result.timezone === "America/Costa_Rica";
  const [catalog, lifetime, hourly] = await Promise.all([
    needCatalog
      ? readMetaCampaignCatalog(
          base,
          result.currency,
          headers,
          signal,
          fetcher,
        ).catch(() => null)
      : Promise.resolve(null),
    extra.lifetime
      ? metaLifetime(base, headers, signal, fetcher).catch(() => null)
      : Promise.resolve(null),
    extra.hourly && hourlyAllowed
      ? metaHourly(base, extra.hourly, headers, signal, fetcher).catch(
          () => null,
        )
      : Promise.resolve(null),
  ]);
  if (catalog) {
    const merged = new Map(
      result.campaigns.map((campaign) => [campaign.id, campaign]),
    );
    for (const budget of catalog.campaigns)
      merged.set(budget.id, {
        ...(merged.get(budget.id) ?? {
          id: budget.id,
          name: budget.name,
          spend: 0,
          impressions: 0,
          clicks: 0,
          purchases: 0,
          daily: [],
        }),
        ...(extra.details ? budget : timesOnly(budget)),
      });
    result.campaigns = Array.from(merged.values()).sort(
      (a, b) => b.spend - a.spend,
    );
  } else if (needCatalog)
    result.budgetMessage =
      "La inversión está disponible, pero no se pudo consultar el presupuesto diario actual.";
  if (extra.lifetime) {
    if (!lifetime)
      result.lifetimeMessage =
        "No se pudo consultar el gasto acumulado desde el lanzamiento.";
    else
      for (const campaign of result.campaigns) {
        const total = lifetime.get(campaign.id);
        const launched = campaign.startTime ?? campaign.createdTime ?? null;
        const entry: CampaignLifetime = {
          spend: Math.round((total?.spend ?? 0) * 100) / 100,
          purchases: total ? total.purchases : 0,
          firstDate: launched ? marketingDate(new Date(launched)) : null,
        };
        campaign.lifetime = entry;
      }
  }
  if (extra.hourly) {
    if (!hourlyAllowed)
      result.hourlyMessage =
        "Sin gasto por hora: la cuenta no usa la hora de Costa Rica.";
    else if (!hourly)
      result.hourlyMessage = "No se pudo consultar el gasto por hora.";
    else result.hourly = hourly;
  }
  if (extra.activities) {
    try {
      result.changes = await readMetaActivities(
        base,
        headers,
        signal,
        fetcher,
        extra.since,
        catalog?.adsetCampaign ?? new Map(),
        { currency: result.currency, now: extra.now },
      );
      // Without the catalog, ad set events (COST CAP bids, ABO budgets) have
      // no campaign and are dropped: the log is incomplete.
      result.changesStatus = catalog ? "activity" : "unavailable";
    } catch {
      if (catalog) {
        result.changes = changesFromUpdatedTime(
          result.accountId,
          catalog.campaigns,
        );
        result.changesStatus = "updated_time";
      } else {
        result.changes = [];
        result.changesStatus = "unavailable";
      }
    }
  }
}

/** Without `details`, only launch/edit times are merged (no budget catalogue). */
const timesOnly = (budget: MetaCampaignBudget) => ({
  createdTime: budget.createdTime,
  startTime: budget.startTime,
  updatedTime: budget.updatedTime,
});

async function metaAds(
  id: string,
  period: MarketingPeriod,
  env: Env,
  fetcher: typeof fetch,
  signal: AbortSignal,
  details: boolean,
  overview?: { from: string; to: string },
  daily = details,
  extra: MetaExtras = {},
): Promise<MarketingAdsData> {
  const version = env.META_CR_GRAPH_VERSION || "";
  if (!/^\d+$/.test(id) || !/^v\d+\.\d+$/.test(version))
    throw new Error("Invalid Meta configuration");
  const base = `https://graph.facebook.com/${version}/act_${id}`;
  const headers = { Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}` };
  const account = await json(
    fetcher,
    `${base}?fields=id,name,currency,timezone_name`,
    { headers, signal },
  );
  if (
    account.error ||
    str(account.id) !== `act_${id}` ||
    !/^[A-Z]{3}$/.test(str(account.currency)) ||
    !str(account.timezone_name)
  )
    throw new Error("Invalid Meta account");
  const since =
    overview && overview.from < period.from ? overview.from : period.from;
  const until = period.to;
  const rows: MarketingCampaign[] = [];
  const dailySpend = new Map<string, number>();
  const seen = new Set<string>();
  let after = "";
  for (let page = 0; page < 25; page++) {
    const url = new URL(`${base}/insights`);
    url.searchParams.set(
      "fields",
      `campaign_id,campaign_name,spend,impressions,clicks${daily ? ",actions" : ""}`,
    );
    if (daily || overview) {
      url.searchParams.set("time_increment", "1");
    }
    if (daily) {
      url.searchParams.set("action_attribution_windows", ATTRIBUTION_WINDOWS);
    }
    url.searchParams.set("level", "campaign");
    url.searchParams.set("time_range", JSON.stringify({ since, until }));
    url.searchParams.set("limit", "500");
    if (after) url.searchParams.set("after", after);
    const body = await json(fetcher, url, { headers, signal });
    if (body.error || !Array.isArray(body.data))
      throw new Error("Invalid Meta report");
    for (const rawEntry of body.data) {
      const row = obj(rawEntry);
      const day = str(row.date_start);
      if (daily || overview) {
        if (!/^20\d{2}-\d{2}-\d{2}$/.test(day) || day < since || day > until)
          throw new Error("Invalid report day");
      }
      if (overview) {
        const key = `${str(row.campaign_id)}:${day}`;
        if (!str(row.campaign_id) || seen.has(key))
          throw new Error("Duplicate report day");
        seen.add(key);
        if (day >= overview.from && day <= overview.to)
          dailySpend.set(day, (dailySpend.get(day) ?? 0) + metric(row.spend));
        // The extra trailing days belong only to the graph, never to period spend or CPA.
        if (day < period.from || day > period.to) continue;
      }
      const purchases = purchasesOf(row);
      const entry: MarketingCampaign = {
        id: str(row.campaign_id),
        name: str(row.campaign_name),
        spend: metric(row.spend),
        impressions: metric(row.impressions),
        clicks: metric(row.clicks),
      };
      if (daily) {
        if (
          !/^20\d{2}-\d{2}-\d{2}$/.test(str(row.date_start)) ||
          str(row.date_start) < since ||
          str(row.date_start) > until
        )
          throw new Error("Invalid report day");
        entry.purchases = purchases;
        entry.daily = [
          {
            date: str(row.date_start),
            spend: entry.spend,
            impressions: entry.impressions,
            clicks: entry.clicks,
            purchases,
          },
        ];
      }
      rows.push(entry);
    }
    const paging = obj(body.paging);
    if (!paging.next) {
      const result: MarketingAdsData = {
        accountId: id,
        accountName: str(account.name) || id,
        currency: str(account.currency),
        timezone: str(account.timezone_name),
        campaigns: campaigns(rows),
        ...(overview
          ? {
              dailySpend: {
                ...overview,
                days: Array.from(dailySpend, ([date, spend]) => ({
                  date,
                  spend,
                })),
              },
            }
          : {}),
      };
      if (details || extra.lifetime || extra.activities || extra.hourly)
        await enrichMetaAccount(result, base, headers, signal, fetcher, {
          ...extra,
          details,
          since: period.from,
        });
      return result;
    }
    const cursor = str(obj(paging.cursors).after);
    if (!cursor || cursor === after) throw new Error("Incomplete Meta report");
    // Rebuild the URL with a cursor, never follow provider-controlled next URLs.
    after = cursor;
  }
  throw new Error("Meta pagination limit");
}

async function tiktokAds(
  period: MarketingPeriod,
  env: Env,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<MarketingAdsData> {
  const id = env.TIKTOK_CR_ADVERTISER_ID || "";
  if (!/^\d+$/.test(id)) throw new Error("Invalid TikTok configuration");
  const base = "https://business-api.tiktok.com/open_api/v1.3";
  const headers = { "Access-Token": env.TIKTOK_CR_ACCESS_TOKEN! };
  const accountUrl = new URL(`${base}/advertiser/info/`);
  accountUrl.searchParams.set("advertiser_ids", JSON.stringify([id]));
  accountUrl.searchParams.set(
    "fields",
    JSON.stringify(["advertiser_id", "name", "currency", "timezone"]),
  );
  const info = await json(fetcher, accountUrl, { headers, signal });
  const account = list(obj(info.data).list)
    .map(obj)
    .find((row) => str(row.advertiser_id) === id);
  if (
    info.code !== 0 ||
    !account ||
    !/^[A-Z]{3}$/.test(str(account.currency)) ||
    !str(account.timezone)
  )
    throw new Error("Invalid TikTok account");
  const { from: since, to: until } = period;
  const rows: MarketingCampaign[] = [];
  for (let page = 1; page <= 25; page++) {
    const url = new URL(`${base}/report/integrated/get/`);
    const params = {
      advertiser_id: id,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: JSON.stringify(["campaign_id"]),
      metrics: JSON.stringify([
        "campaign_name",
        "spend",
        "impressions",
        "clicks",
      ]),
      start_date: since,
      end_date: until,
      page: String(page),
      page_size: "1000",
    };
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    const body = await json(fetcher, url, { headers, signal });
    const data = obj(body.data);
    if (body.code !== 0 || !Array.isArray(data.list))
      throw new Error("Invalid TikTok report");
    for (const entry of data.list) {
      const row = obj(entry),
        dimensions = obj(row.dimensions),
        metrics = obj(row.metrics);
      rows.push({
        id: str(dimensions.campaign_id),
        name: str(metrics.campaign_name),
        spend: metric(metrics.spend),
        impressions: metric(metrics.impressions),
        clicks: metric(metrics.clicks),
      });
    }
    const totalPages = Number(obj(data.page_info).total_page);
    if (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 25)
      throw new Error("Incomplete TikTok report");
    if (page >= totalPages)
      return {
        accountId: id,
        accountName: str(account.name) || id,
        currency: str(account.currency),
        timezone: str(account.timezone),
        campaigns: campaigns(rows),
      };
  }
  throw new Error("TikTok pagination limit");
}

async function shipheroStock(
  env: Env,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ stock: MarketingStock[] }> {
  // Both IDs are explicit to avoid reading another 3PL customer's inventory.
  const warehouse = env.SHIPHERO_CR_WAREHOUSE_ID!;
  const account = env.SHIPHERO_CR_ACCOUNT_ID!;
  const stock: MarketingStock[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  const query = `query MarketingStock($warehouse: String!, $account: String!, $after: String) {
    warehouse_products(warehouse_id: $warehouse, customer_account_id: $account) {
      data(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id sku account_id warehouse_id on_hand available allocated } }
      }
    }
  }`;
  for (let page = 0; page < 25; page++) {
    const body = await json(
      fetcher,
      "https://public-api.shiphero.com/graphql",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SHIPHERO_CR_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { warehouse, account, after },
        }),
        signal,
      },
    );
    const data = obj(obj(obj(body.data).warehouse_products).data);
    if (list(body.errors).length || !Array.isArray(data.edges))
      throw new Error("Invalid ShipHero response");
    for (const entry of data.edges) {
      const row = obj(obj(entry).node);
      if (
        str(row.warehouse_id) !== warehouse ||
        str(row.account_id) !== account ||
        !str(row.id) ||
        !str(row.sku)
      )
        throw new Error("ShipHero scope mismatch");
      if (seen.has(str(row.id))) throw new Error("Duplicate ShipHero row");
      seen.add(str(row.id));
      stock.push({
        sku: str(row.sku),
        warehouseId: warehouse,
        onHand: metric(row.on_hand),
        available: metric(row.available),
        allocated: metric(row.allocated),
      });
    }
    const paging = obj(data.pageInfo);
    if (paging.hasNextPage === false) return { stock };
    const next = str(paging.endCursor);
    if (paging.hasNextPage !== true || !next || next === after)
      throw new Error("Incomplete ShipHero inventory");
    after = next;
  }
  throw new Error("ShipHero pagination limit");
}

/** TikTok desde lo que mando Make: sin filas en el periodo no es gasto cero, es "pendiente". */
async function tiktokDesdeMake(
  leer: (from: string, to: string) => Promise<MarketingAdsData[]>,
  period: MarketingPeriod,
): Promise<MarketingSource<MarketingAdsAccounts>> {
  const checkedAt = new Date().toISOString();
  try {
    const accounts = await leer(period.from, period.to);
    if (!accounts.length)
      return {
        status: "pending",
        checkedAt,
        message: "Make todavía no envió gasto de TikTok para este período.",
        data: null,
      };
    return {
      status: "ready",
      checkedAt,
      message: "Gasto diario enviado por Make (reporte de TikTok Ads).",
      data: { accounts },
    };
  } catch {
    return {
      status: "error",
      checkedAt,
      message: "No se pudo leer el gasto de TikTok guardado.",
      data: null,
    };
  }
}

export async function getMarketingSources(
  input: string | Pick<MarketingPeriod, "from" | "to">,
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
  options: {
    details?: boolean;
    overview?: boolean;
    /** Campaign daily metrics without the budget catalogue. */
    daily?: boolean;
    /** Account spend per hour for today and the previous 7 days (CR accounts only). */
    hourly?: boolean;
    /** Actions table: details + daily + lifetime + activity log (Meta) and lifetime (TikTok). */
    actions?: boolean;
    now?: Date;
    /**
     * Gasto de TikTok que manda Make (lib/tiktok-diario.ts), para cuando no hay
     * acceso directo a la API. Recibe los dias YYYY-MM-DD, inclusivos.
     */
    tiktokDesdeMake?: (from: string, to: string) => Promise<MarketingAdsData[]>;
  } = {},
): Promise<MarketingSources> {
  const period = periodFromInput(input);
  if (!period) throw new Error("Invalid period");
  const has = (...keys: string[]) =>
    keys.every((key) => Boolean(env[key]?.trim()));
  const today = marketingDate(options.now ?? new Date());
  const details = options.details === true || options.actions === true;
  const trailTo = period.to < today ? period.to : today;
  const overview = options.overview
    ? { from: shiftDate(trailTo, -6), to: trailTo }
    : undefined;
  const [meta, tiktok, shiphero] = await Promise.all([
    source(
      has("META_CR_GRAPH_VERSION", "META_CR_ACCESS_TOKEN") &&
        Boolean(env.META_CR_AD_ACCOUNT_IDS || env.META_CR_AD_ACCOUNT_ID),
      async (signal) => ({
        // A missing account must not masquerade as complete Meta spend.
        accounts: await Promise.all(
          metaAccountIds(env).map((id) =>
            metaAds(
              id,
              period,
              env,
              fetcher,
              signal,
              details,
              overview,
              options.daily ?? details,
              {
                hourly: options.hourly
                  ? { from: shiftDate(today, -7), to: today }
                  : undefined,
                lifetime: options.actions === true,
                activities: options.actions === true,
                now: options.now,
              },
            ),
          ),
        ),
      }),
    ),
    has("TIKTOK_CR_ADVERTISER_ID", "TIKTOK_CR_ACCESS_TOKEN") ||
    !options.tiktokDesdeMake
      ? source(
          has("TIKTOK_CR_ADVERTISER_ID", "TIKTOK_CR_ACCESS_TOKEN"),
          async (signal) => ({
            accounts: [await tiktokAds(period, env, fetcher, signal)],
          }),
        )
      : tiktokDesdeMake(options.tiktokDesdeMake, period),
    source(
      has(
        "SHIPHERO_CR_ACCESS_TOKEN",
        "SHIPHERO_CR_ACCOUNT_ID",
        "SHIPHERO_CR_WAREHOUSE_ID",
      ),
      (signal) => shipheroStock(env, fetcher, signal),
    ),
  ]);
  return { meta, tiktok, shiphero };
}
