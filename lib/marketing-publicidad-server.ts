// Lectura de Meta para la pestaña "Publicidad" de Marketing (25/11/2026).
// Solo servidor: el token se lee aquí y nunca sale. Solo peticiones GET: Kairo
// no enciende, apaga ni edita nada en Meta.
//
// Por cada cuenta, en paralelo y sin que una tumbe a las demás:
//   1. Insights del período (totales, sin time_increment) al nivel pedido.
//      `results` / `cost_per_result` no existen en todas las versiones del
//      Graph: si Meta rechaza la consulta se repite una vez sin ellos y esas
//      columnas quedan en "—".
//   2. Estado y presupuesto por los bordes de la cuenta (/act_X/campaigns,
//      /adsets, /ads). NUNCA con `?ids=a,b,c`: en producción Meta rechazó esa
//      consulta para todos los objetos de estas cuentas (ver adsetDestinations
//      en lib/marketing-sources.ts). Si esta lectura falla, las filas salen
//      igual con estado y presupuesto en "—".
//
// Una cuenta que no se puede leer va a `unavailable` con un motivo genérico:
// el mensaje del proveedor puede traer datos de la cuenta o el token y nunca
// se reenvía. Hay una caché corta en memoria (60 s) por cuenta, nivel, rango y
// filtros para que cambiar de pestaña no vuelva a consultar a Meta;
// `refresh` la salta.
//
// Los normalizadores son puros y viven en lib/marketing-publicidad.ts.
// Pruebas: tests/marketing-publicidad-server.test.ts.
import { metaConfigured } from "./marketing-meta-accounts";
import {
  buildPublicidadRows,
  mergeInsights,
  metaEntity,
  metaInsight,
  type PublicidadAccount,
  type PublicidadEntity,
  type PublicidadInsight,
  type PublicidadLevel,
  type PublicidadPayload,
  type PublicidadRow,
} from "./marketing-publicidad";
import {
  ATTRIBUTION_WINDOWS,
  metaAccountFailure,
  metaAccountIds,
  metaPages,
  purchasesOf,
} from "./marketing-sources";

type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;

export interface PublicidadQuery {
  level: PublicidadLevel;
  from: string;
  to: string;
  /** One configured account; without it, all of them. */
  account?: string;
  /** Drill-down: only this campaign (ad sets and ads). */
  campaign?: string;
  /** Drill-down: only this ad set (ads). */
  adset?: string;
  /** Skips the 60 s cache. */
  refresh?: boolean;
}

const ACCOUNT_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 300;
const CAMPAIGN_CHUNK = 50;

const LEVEL_FIELDS: Record<PublicidadLevel, string> = {
  campaign: "campaign_id,campaign_name",
  adset: "campaign_id,campaign_name,adset_id,adset_name",
  ad: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name",
};
const METRIC_FIELDS = "spend,impressions,clicks,actions,action_values";
const RESULT_FIELDS = "results,cost_per_result";

const EDGE: Record<PublicidadLevel, { path: string; fields: string }> = {
  campaign: {
    path: "campaigns",
    fields: "id,name,effective_status,daily_budget,lifetime_budget",
  },
  adset: {
    path: "adsets",
    fields: "id,name,campaign_id,effective_status,daily_budget,lifetime_budget",
  },
  ad: {
    path: "ads",
    fields: "id,name,adset_id,campaign_id,effective_status",
  },
};

/** Every status, so entities that delivered and were archived afterwards answer too. */
const ALL_STATUSES = JSON.stringify([
  "ACTIVE",
  "PAUSED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "ARCHIVED",
  "DELETED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
]);
const ONLY_ACTIVE = JSON.stringify(["ACTIVE"]);

interface AccountRead {
  account: PublicidadAccount;
  rows: PublicidadRow[];
}

const cache = new Map<string, { at: number; value: AccountRead }>();

/** Test hook: empties the 60 s cache. */
export function clearPublicidadCache() {
  cache.clear();
}

async function accountInfo(
  base: string,
  id: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<{ name: string; currency: string }> {
  const response = await fetcher(`${base}?fields=id,name,currency`, {
    headers,
    signal,
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Provider HTTP error ${response.status}`);
  const body = (await response.json().catch(() => null)) as Json | null;
  const currency = typeof body?.currency === "string" ? body.currency : "";
  if (
    !body ||
    body.error ||
    body.id !== `act_${id}` ||
    !/^[A-Z]{3}$/.test(currency)
  )
    throw new Error("Invalid Meta account");
  return {
    name: typeof body.name === "string" && body.name ? body.name : id,
    currency,
  };
}

interface Scope {
  field: "campaign.id" | "adset.id" | "id";
  value: string[];
}

async function readInsights(
  base: string,
  query: PublicidadQuery,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<{ insights: PublicidadInsight[]; results: "ok" | "unavailable" }> {
  const scope: Scope | null =
    query.adset && query.level === "ad"
      ? { field: "adset.id", value: [query.adset] }
      : query.campaign
        ? { field: "campaign.id", value: [query.campaign] }
        : null;
  const read = (fields: string) =>
    metaPages(
      fetcher,
      (after) => {
        const url = new URL(`${base}/insights`);
        url.searchParams.set("fields", fields);
        url.searchParams.set("level", query.level);
        // Period totals: one row per entity, no time_increment.
        url.searchParams.set(
          "time_range",
          JSON.stringify({ since: query.from, until: query.to }),
        );
        url.searchParams.set("action_attribution_windows", ATTRIBUTION_WINDOWS);
        if (scope)
          url.searchParams.set(
            "filtering",
            JSON.stringify([{ ...scope, operator: "IN" }]),
          );
        url.searchParams.set("limit", "500");
        if (after) url.searchParams.set("after", after);
        return url;
      },
      headers,
      signal,
    );
  const base_fields = `${LEVEL_FIELDS[query.level]},${METRIC_FIELDS}`;
  let results: "ok" | "unavailable" = "ok";
  const rows = await read(`${base_fields},${RESULT_FIELDS}`).catch((err) => {
    if (signal.aborted) throw err;
    results = "unavailable";
    return read(base_fields);
  });
  return {
    insights: mergeInsights(
      rows.flatMap((row) => {
        // Same purchase count as the rest of Marketing (first canonical type).
        const insight = metaInsight(row, query.level, purchasesOf(row));
        return insight ? [insight] : [];
      }),
    ),
    results,
  };
}

/** One account edge, optionally narrowed; a refused status list is retried without it. */
async function readEdge(
  base: string,
  level: PublicidadLevel,
  currency: string,
  options: { scope?: Scope; statuses: string },
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<PublicidadEntity[]> {
  const edge = EDGE[level];
  const read = (scope: Scope | undefined, statuses: string | null) =>
    metaPages(
      fetcher,
      (after) => {
        const url = new URL(`${base}/${edge.path}`);
        url.searchParams.set("fields", edge.fields);
        if (scope)
          url.searchParams.set(
            "filtering",
            JSON.stringify([{ ...scope, operator: "IN" }]),
          );
        if (statuses) url.searchParams.set("effective_status", statuses);
        url.searchParams.set("limit", "500");
        if (after) url.searchParams.set("after", after);
        return url;
      },
      headers,
      signal,
    );
  const attempt = async (scope: Scope | undefined) => {
    try {
      return await read(scope, options.statuses);
    } catch (err) {
      // The ACTIVE-only read must stay ACTIVE-only: never widened on failure.
      if (signal.aborted || options.statuses === ONLY_ACTIVE) throw err;
      return read(scope, null);
    }
  };
  let rows: Json[];
  try {
    rows = await attempt(options.scope);
  } catch (err) {
    // On the campaigns edge the filter field may be the plain `id`.
    if (
      signal.aborted ||
      level !== "campaign" ||
      options.scope?.field !== "campaign.id"
    )
      throw err;
    rows = await attempt({ field: "id", value: options.scope.value });
  }
  return rows.flatMap((row) => {
    const entity = metaEntity(row, currency);
    return entity ? [entity] : [];
  });
}

/**
 * Entities of `level` for the campaigns that delivered plus the ACTIVE ones
 * (or only those of the drill-down). `complete` false = some read failed.
 */
async function readEntities(
  base: string,
  level: PublicidadLevel,
  currency: string,
  query: PublicidadQuery,
  campaignIds: string[],
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<{ entities: PublicidadEntity[] | null; complete: boolean }> {
  const run = (options: { scope?: Scope; statuses: string }) =>
    readEdge(base, level, currency, options, headers, signal, fetcher);
  const reads: Array<Promise<PublicidadEntity[]>> = [];
  if (query.adset && level === "ad")
    reads.push(
      run({
        scope: { field: "adset.id", value: [query.adset] },
        statuses: ALL_STATUSES,
      }),
    );
  else if (query.campaign)
    reads.push(
      run({
        scope: { field: "campaign.id", value: [query.campaign] },
        statuses: ALL_STATUSES,
      }),
    );
  else {
    for (let i = 0; i < campaignIds.length; i += CAMPAIGN_CHUNK)
      reads.push(
        run({
          scope: {
            field: "campaign.id",
            value: campaignIds.slice(i, i + CAMPAIGN_CHUNK),
          },
          statuses: ALL_STATUSES,
        }),
      );
    reads.push(run({ statuses: ONLY_ACTIVE }));
  }
  const settled = await Promise.allSettled(reads);
  const byId = new Map<string, PublicidadEntity>();
  let read = 0;
  for (const result of settled)
    if (result.status === "fulfilled") {
      read++;
      for (const entity of result.value) byId.set(entity.id, entity);
    }
  return {
    entities: read ? Array.from(byId.values()) : null,
    complete: read === settled.length,
  };
}

async function readAccount(
  id: string,
  query: PublicidadQuery,
  env: Env,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<AccountRead & { cacheable: boolean }> {
  const version = env.META_CR_GRAPH_VERSION || "";
  if (!/^\d+$/.test(id) || !/^v\d+\.\d+$/.test(version))
    throw new Error("Invalid Meta configuration");
  const base = `https://graph.facebook.com/${version}/act_${id}`;
  const headers = { Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}` };
  const [info, report] = await Promise.all([
    accountInfo(base, id, headers, signal, fetcher),
    readInsights(base, query, headers, signal, fetcher),
  ]);
  const campaignIds = Array.from(
    new Set(report.insights.map((row) => row.campaignId).filter(Boolean)),
  );
  const none = { entities: null, complete: false };
  const [own, parents] = await Promise.all([
    readEntities(
      base,
      query.level,
      info.currency,
      query,
      campaignIds,
      headers,
      signal,
      fetcher,
    ).catch(() => none),
    // Ad sets of a CBO campaign have no budget: the campaign's is shown.
    query.level === "adset"
      ? readEntities(
          base,
          "campaign",
          info.currency,
          query,
          campaignIds,
          headers,
          signal,
          fetcher,
        ).catch(() => none)
      : Promise.resolve({ entities: null, complete: true }),
  ]);
  const account: PublicidadAccount = {
    accountId: id,
    accountName: info.name,
    currency: info.currency,
    entities: !own.entities
      ? "unavailable"
      : own.complete && parents.complete
        ? "ok"
        : "partial",
    results: report.results,
  };
  return {
    account,
    rows: buildPublicidadRows({
      level: query.level,
      account,
      insights: report.insights,
      entities: own.entities,
      campaigns: parents.entities,
    }),
    // A partial read is not kept: the next request tries the whole thing again.
    cacheable: account.entities === "ok",
  };
}

/**
 * The table of one level for the configured Meta accounts (or one of them).
 * Never throws for a provider failure: failing accounts go to `unavailable`.
 */
export async function getPublicidadMeta(
  query: PublicidadQuery,
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<PublicidadPayload> {
  const base = {
    platform: "meta" as const,
    level: query.level,
    from: query.from,
    to: query.to,
    generatedAt: new Date(now()).toISOString(),
  };
  const pending: PublicidadPayload = {
    ...base,
    status: "pending",
    message: "Meta Ads: pendiente de configurar acceso de lectura.",
    accounts: [],
    rows: [],
    unavailable: [],
  };
  if (!metaConfigured(env)) return pending;
  let ids: string[];
  try {
    ids = metaAccountIds(env);
  } catch {
    return pending;
  }
  if (query.account) ids = ids.filter((id) => id === query.account);
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const key = [
        id,
        query.level,
        query.from,
        query.to,
        query.campaign ?? "",
        query.adset ?? "",
      ].join("|");
      const hit = cache.get(key);
      if (!query.refresh && hit && now() - hit.at < CACHE_TTL_MS)
        return hit.value;
      const { cacheable, ...value } = await readAccount(
        id,
        query,
        env,
        fetcher,
        AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
      );
      if (cacheable) {
        cache.delete(key);
        cache.set(key, { at: now(), value });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      }
      return value;
    }),
  );
  const accounts: PublicidadAccount[] = [];
  const rows: PublicidadRow[] = [];
  const unavailable: PublicidadPayload["unavailable"] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      accounts.push(result.value.account);
      rows.push(...result.value.rows);
    } else
      unavailable.push({
        accountId: ids[index],
        // Generic reason only: provider text can echo the token or account data.
        reason: metaAccountFailure(result.reason),
      });
  });
  return {
    ...base,
    status: "ready",
    accounts,
    rows: rows.sort((a, b) => b.spend - a.spend),
    unavailable,
  };
}
