// "Pasar a COST CAP" con un botón (25/11/2026): lectura y ESCRITURA en Meta.
// Solo servidor: el token se lee aquí y nunca sale.
//
// Es lo primero de Kairo que escribe en Meta. Lo único que puede escribir es:
//   POST /act_<cuenta>/ads          → UN anuncio ACTIVO en un conjunto que ya
//                                     existe de una COST CAP que ya existe.
//   POST /act_<cuenta>/adcreatives  → UN creativo a partir de la publicación,
//                                     solo cuando no se puede reutilizar el del
//                                     anuncio original (otra cuenta, o Meta lo
//                                     rechazó).
// Nada de presupuestos, pujas, estados ni campañas; nada se borra; nada es
// automático (no hay cron: solo la ruta, con un clic confirmado).
//
// Lecturas, siempre por los bordes de la cuenta (NUNCA `?ids=`: Meta rechazó
// esa consulta en estas cuentas, ver lib/marketing-publicidad-server.ts):
//   /act_X?fields=id,name,account_status,currency       (qué cuentas están activas)
//   /act_X/ads?filtering=[id IN …]                      (el anuncio de origen)
//   /act_X/campaigns?effective_status=["ACTIVE"]        (campañas de cada cuenta activa)
//   /act_X/adsets?filtering=[campaign.id IN …]          (conjuntos de las COST CAP destino)
//   /act_X/ads?filtering=[campaign.id IN …]             (¿la publicación ya está ahí?)
//   /act_X/insights?level=adset&filtering=[campaign.id IN …]  (gasto, para sugerir)
//
// Antes de escribir se relee TODO (nunca se confía en el navegador) y se
// anota una reserva en el registro manual de cambios: así queda rastro aunque
// algo falle después, y un segundo clic (u otro servidor) ve la reserva y no
// crea otro anuncio. Si Meta rechaza el anuncio, la reserva se borra; si lo
// crea, la reserva pasa a ser el "Hecho" de Acciones; si no se supo (tiempo de
// espera, error 5xx), la reserva se queda como rastro y frena los reintentos
// unos minutos, hasta que Meta ya liste el anuncio si es que lo creó.
//
// Nunca se reenvía el mensaje de Meta (puede traer datos de la cuenta): se
// traduce a un motivo corto y el detalle técnico va a console.warn sin token.
// Lo que decide es puro y está en lib/marketing-cost-cap-move.ts.
// Pruebas: tests/marketing-cost-cap-move-route.test.ts.
import { getDB } from "./db";
import { buildKeywordIndex } from "./marketing-campaign-keywords";
import {
  buildMovePreview,
  metaMoveAd,
  metaMoveAdset,
  metaMoveCampaign,
  metaWriteFailure,
  moveCandidates,
  moveClaimDetail,
  moveDoneDetail,
  moveMarker,
  moveProduct,
  isMoveClaim,
  MOVE_FAILURE_TEXT,
  MOVE_TEXT,
  validateMoveTarget,
  type MoveAccount,
  type MoveAd,
  type MoveAdset,
  type MoveCampaign,
  type MoveFailure,
  type MovePreview,
  type MoveProduct,
} from "./marketing-cost-cap-move";
import { getMarketingData } from "./marketing-data";
import { marketingDate, presetPeriod, shiftDate } from "./marketing-dates";
import { DECISION_RULES, DONE_PREFIX } from "./marketing-decisions";
import { displayUploader, isMissingRelation } from "./marketing-inventory-db";
import { metaConfigured } from "./marketing-meta-accounts";
import {
  effectiveAssignment,
  type MarketingFamily,
} from "./marketing-product-families";
import { readMarketingVariantMappings } from "./marketing-product-groups-db";
import {
  campaignKey,
  type CampaignKeywordRule,
  type CampaignProduct,
} from "./marketing-settings-types";
import type { ManualCampaignChange } from "./marketing-source-types";
import {
  metaAccountFailure,
  metaAccountIds,
  metaPages,
} from "./marketing-sources";
import type { FinanceStoreConfig } from "./stores";

type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

const READ_TIMEOUT_MS = 25_000;
const WRITE_TIMEOUT_MS = 20_000;
const AD_FIELDS =
  "id,name,status,effective_status,adset_id,campaign_id,creative{id,effective_object_story_id,object_story_id}";
const AD_FIELDS_TAGS =
  "id,name,status,effective_status,adset_id,campaign_id,creative{id,effective_object_story_id,object_story_id,url_tags}";
const CAMPAIGN_FIELDS = "id,name,effective_status,bid_strategy";
const ADSET_FIELDS =
  "id,name,campaign_id,effective_status,bid_amount,bid_strategy,daily_budget,optimization_goal";

/** Lo que no deja ni mostrar la vista previa (config, lectura del anuncio, asignaciones). */
export class MoveReadError extends Error {
  constructor(
    public readonly reason: string,
    public readonly status: number,
  ) {
    super("Cost cap move read failed");
  }
}

/* ------------------------------------------------ Productos asignados */

export interface MoveAssignments {
  families: MarketingFamily[];
  mappings: CampaignProduct[];
  keywords: CampaignKeywordRule[];
  /** false = el catálogo no se pudo leer entero: sin asignación automática. */
  enabled: boolean;
}

const FAMILIES_TTL_MS = 5 * 60_000;
let familiesCache: {
  at: number;
  storeId: number;
  families: MarketingFamily[];
  enabled: boolean;
} | null = null;

/** Test hook. */
export function clearMoveCaches() {
  familiesCache = null;
  inFlight.clear();
}

/**
 * Campaña → producto, igual que el resto de Marketing: el catálogo (familias)
 * sale del mismo resumen que ve la pantalla y las asignaciones guardadas se
 * leen frescas cada vez (alguien pudo asignar el producto hace un minuto). El
 * catálogo casi no cambia y es la lectura pesada: se guarda 5 minutos.
 */
export async function loadMoveAssignments(
  store: FinanceStoreConfig,
  now: () => number = Date.now,
): Promise<MoveAssignments> {
  const cached =
    familiesCache &&
    familiesCache.storeId === store.id &&
    now() - familiesCache.at < FAMILIES_TTL_MS
      ? familiesCache
      : null;
  const [catalog, mappings, keywords] = await Promise.all([
    cached
      ? Promise.resolve(cached)
      : getMarketingData(store, presetPeriod("today")).then((summary) => ({
          at: now(),
          storeId: store.id,
          families: summary.productFamilies ?? [],
          enabled: !summary.familyDataError,
        })),
    readMarketingVariantMappings(store.id),
    // La tabla de palabras clave es más nueva: sin ella el resto igual sirve.
    Promise.resolve(
      getDB()
        .from("marketing_campaign_keywords")
        .select("keyword,family_key,product_name")
        .eq("store_id", store.id)
        .order("keyword")
        .range(0, 999),
    )
      .then((result) =>
        result.error || !result.data
          ? []
          : (result.data as unknown as CampaignKeywordRule[]),
      )
      .catch(() => [] as CampaignKeywordRule[]),
  ]);
  // Un catálogo incompleto no se guarda: la próxima vez se vuelve a leer.
  if (!cached && catalog.enabled) familiesCache = catalog;
  return {
    families: catalog.families,
    mappings,
    keywords,
    enabled: catalog.enabled,
  };
}

/* ------------------------------------------------------------ Lectura */

export interface MoveDeps {
  env?: Env;
  fetcher?: typeof fetch;
  now?: () => Date;
  assignments: () => Promise<MoveAssignments>;
}

interface Graph {
  version: string;
  token: string;
  headers: Record<string, string>;
  fetcher: typeof fetch;
  ids: string[];
}

function graphOf(deps: MoveDeps): Graph {
  const env = deps.env ?? process.env;
  const version = env.META_CR_GRAPH_VERSION || "";
  if (!metaConfigured(env) || !/^v\d+\.\d+$/.test(version))
    throw new MoveReadError(
      "Meta Ads: pendiente de configurar el acceso.",
      503,
    );
  let ids: string[];
  try {
    ids = metaAccountIds(env);
  } catch {
    throw new MoveReadError(
      "Meta Ads: pendiente de configurar el acceso.",
      503,
    );
  }
  const token = env.META_CR_ACCESS_TOKEN || "";
  return {
    version,
    token,
    headers: { Authorization: `Bearer ${token}` },
    fetcher: deps.fetcher ?? fetch,
    ids,
  };
}

const baseOf = (graph: Graph, account: string) =>
  `https://graph.facebook.com/${graph.version}/act_${account}`;
const inFilter = (field: string, value: string[]) =>
  JSON.stringify([{ field, operator: "IN", value }]);

/** Detalle técnico al registro del servidor, sin el token. */
function warn(graph: Pick<Graph, "token">, step: string, detail: Json) {
  const text = JSON.stringify(detail).slice(0, 600);
  console.warn(
    "[cost-cap-move]",
    step,
    graph.token ? text.split(graph.token).join("[token]") : text,
  );
}

function edge(
  graph: Graph,
  account: string,
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<Json[]> {
  return metaPages(
    graph.fetcher,
    (after) => {
      const url = new URL(`${baseOf(graph, account)}/${path}`);
      for (const [key, value] of Object.entries(params))
        url.searchParams.set(key, value);
      url.searchParams.set("limit", "500");
      if (after) url.searchParams.set("after", after);
      return url;
    },
    graph.headers,
    signal,
  );
}

/** `account_status` de una cuenta: 1 = activa. Lanza si no se puede leer. */
async function readAccount(
  graph: Graph,
  id: string,
  signal: AbortSignal,
): Promise<MoveAccount> {
  const url = new URL(baseOf(graph, id));
  url.searchParams.set("fields", "id,name,account_status,currency");
  const response = await graph.fetcher(url, {
    headers: graph.headers,
    signal,
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Provider HTTP error ${response.status}`);
  const body = obj(await response.json().catch(() => null));
  if (body.error || body.id !== `act_${id}`)
    throw new Error("Invalid Meta account");
  return {
    id,
    name: typeof body.name === "string" && body.name ? body.name : id,
    currency:
      typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)
        ? body.currency
        : "",
    active: Number(body.account_status) === 1,
  };
}

async function readAds(
  graph: Graph,
  account: string,
  filtering: string,
  signal: AbortSignal,
  withTags = false,
): Promise<MoveAd[]> {
  const read = (fields: string) =>
    edge(graph, account, "ads", { fields, filtering }, signal);
  const rows = withTags
    ? // Los parámetros de URL son un extra: si Meta rechaza el campo, sin ellos.
      await read(AD_FIELDS_TAGS).catch((err) => {
        if (signal.aborted) throw err;
        return read(AD_FIELDS);
      })
    : await read(AD_FIELDS);
  return rows.flatMap((row) => {
    const ad = metaMoveAd(row);
    return ad ? [ad] : [];
  });
}

async function readCampaigns(
  graph: Graph,
  account: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<MoveCampaign[]> {
  const rows = await edge(
    graph,
    account,
    "campaigns",
    { fields: CAMPAIGN_FIELDS, ...params },
    signal,
  );
  return rows.flatMap((row) => {
    const campaign = metaMoveCampaign(row, account);
    return campaign ? [campaign] : [];
  });
}

interface MoveRead {
  preview: MovePreview;
  source: MoveAd | null;
  sourceCampaign: MoveCampaign | null;
  product: MoveProduct | null;
}

/**
 * Todo lo que hace falta para la vista previa y para validar el POST, leído
 * en vivo. Lanza MoveReadError solo cuando no se puede decir nada (config,
 * anuncio o asignaciones ilegibles); lo demás sale como `blocked`.
 */
async function readMove(
  query: { account: string; ad: string },
  deps: MoveDeps,
): Promise<MoveRead> {
  const graph = graphOf(deps);
  if (!graph.ids.includes(query.account))
    throw new MoveReadError("Cuenta no autorizada para Costa Rica.", 400);
  const now = (deps.now ?? (() => new Date()))();
  const today = marketingDate(now);
  const window = {
    from: shiftDate(today, -DECISION_RULES.windowDays),
    to: shiftDate(today, -1),
  };
  const signal = AbortSignal.timeout(READ_TIMEOUT_MS);

  const [accountResults, sourceAds, assignments] = await Promise.all([
    Promise.allSettled(graph.ids.map((id) => readAccount(graph, id, signal))),
    readAds(
      graph,
      query.account,
      inFilter("id", [query.ad]),
      signal,
      true,
    ).catch((error) => {
      warn(graph, "leer anuncio", { reason: metaAccountFailure(error) });
      throw new MoveReadError(
        "No se pudo leer el anuncio en Meta. Vuelve a intentarlo.",
        502,
      );
    }),
    deps.assignments().catch(() => {
      throw new MoveReadError(
        "No se pudieron leer los productos asignados en Marketing. Vuelve a intentarlo.",
        503,
      );
    }),
  ]);
  const accounts: MoveAccount[] = [];
  const skipped: MovePreview["skippedAccounts"] = [];
  accountResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      accounts.push(result.value);
      if (!result.value.active)
        skipped.push({
          accountId: result.value.id,
          name: result.value.name,
          reason: "Cuenta desactivada en Meta.",
        });
    } else
      skipped.push({
        accountId: graph.ids[index],
        name: null,
        // Motivo genérico: el texto del proveedor nunca se reenvía.
        reason: metaAccountFailure(result.reason),
      });
  });
  const source = sourceAds.find((ad) => ad.id === query.ad) ?? null;

  // Campañas ACTIVAS de cada cuenta ACTIVA (una cuenta que falla no se ofrece).
  const active = accounts.filter((account) => account.active);
  const lists = await Promise.allSettled(
    active.map((account) =>
      readCampaigns(
        graph,
        account.id,
        { effective_status: JSON.stringify(["ACTIVE"]) },
        signal,
      ),
    ),
  );
  const campaigns: MoveCampaign[] = [];
  lists.forEach((result, index) => {
    if (result.status === "fulfilled") campaigns.push(...result.value);
    else
      skipped.push({
        accountId: active[index].id,
        name: active[index].name,
        reason: "No se pudieron leer sus campañas.",
      });
  });

  // La campaña del anuncio: suele estar entre las activas de su cuenta; si
  // no (pausada, o cuenta no activa), se pide por el borde de la cuenta.
  let sourceCampaign: MoveCampaign | null = null;
  if (source?.campaignId) {
    sourceCampaign =
      campaigns.find(
        (c) => c.accountId === query.account && c.id === source.campaignId,
      ) ?? null;
    if (!sourceCampaign) {
      const one = (field: string) =>
        readCampaigns(
          graph,
          query.account,
          { filtering: inFilter(field, [source.campaignId]) },
          signal,
        );
      const found = await one("campaign.id")
        // En el borde de campañas el filtro puede ser el `id` a secas.
        .catch((err) => {
          if (signal.aborted) throw err;
          return one("id");
        })
        .catch((error) => {
          warn(graph, "leer campaña", { reason: metaAccountFailure(error) });
          throw new MoveReadError(
            "No se pudo leer la campaña del anuncio en Meta. Vuelve a intentarlo.",
            502,
          );
        });
      sourceCampaign = found.find((c) => c.id === source.campaignId) ?? null;
    }
  }

  const index = buildKeywordIndex(assignments.families, assignments.keywords);
  const stored = new Map(
    assignments.mappings.map((m) => [
      campaignKey(m.platform, m.account_id, m.campaign_id),
      m,
    ]),
  );
  const productOf = (campaign: MoveCampaign) =>
    moveProduct(
      effectiveAssignment(
        stored.get(campaignKey("meta", campaign.accountId, campaign.id)),
        assignments.families,
        "meta",
        campaign.accountId,
        campaign.id,
        campaign.name,
        assignments.enabled,
        assignments.mappings,
        index,
      ),
      assignments.families,
    );
  const first = moveCandidates({
    source,
    sourceCampaign,
    accounts,
    campaigns,
    productOf,
  });

  // Conjuntos, anuncios (duplicados) y gasto de las COST CAP destino.
  const byAccount = new Map<string, string[]>();
  for (const campaign of first.candidates)
    byAccount.set(campaign.accountId, [
      ...(byAccount.get(campaign.accountId) ?? []),
      campaign.id,
    ]);
  const adsets = new Map<string, MoveAdset[] | null>();
  const ads = new Map<string, MoveAd[] | null>();
  const spend = new Map<string, number>();
  await Promise.all(
    Array.from(byAccount).map(async ([accountId, ids]) => {
      const currency =
        accounts.find((account) => account.id === accountId)?.currency ?? "";
      const filtering = inFilter("campaign.id", ids);
      const [sets, existing, insights] = await Promise.all([
        edge(
          graph,
          accountId,
          "adsets",
          { fields: ADSET_FIELDS, filtering },
          signal,
        )
          .then((rows) =>
            rows.flatMap((row) => {
              const set = metaMoveAdset(row, currency);
              return set ? [set] : [];
            }),
          )
          .catch(() => null),
        readAds(graph, accountId, filtering, signal).catch(() => null),
        // Solo para sugerir el conjunto de más gasto: si falla, sin sugerencia.
        edge(
          graph,
          accountId,
          "insights",
          {
            fields: "campaign_id,adset_id,spend",
            level: "adset",
            time_range: JSON.stringify({
              since: window.from,
              until: window.to,
            }),
            filtering,
          },
          signal,
        ).catch(() => null),
      ]);
      adsets.set(accountId, sets);
      ads.set(accountId, existing);
      for (const row of insights ?? []) {
        const id = typeof row.adset_id === "string" ? row.adset_id : "";
        const value = Number(row.spend);
        if (id && Number.isFinite(value) && value >= 0)
          spend.set(id, (spend.get(id) ?? 0) + value);
      }
    }),
  );
  return {
    preview: buildMovePreview({
      window,
      source,
      sourceCampaign,
      accounts,
      skippedAccounts: skipped,
      blocked: first.blocked,
      product: first.product,
      candidates: first.candidates,
      adsets,
      ads,
      spend,
    }),
    source,
    sourceCampaign,
    product: first.product,
  };
}

/** GET: la vista previa (solo lecturas). */
export async function previewCostCapMove(
  query: { account: string; ad: string },
  deps: MoveDeps,
): Promise<MovePreview> {
  return (await readMove(query, deps)).preview;
}

/* ------------------------------------------- Registro de cambios (auditoría) */

const TABLE = "marketing_campaign_changes";
const COLUMNS =
  "id,platform,account_id,campaign_id,campaign_name,product_key,kind,detail,changed_at,created_by";
/** Una reserva más vieja que esto quedó huérfana (el servidor murió a medias): ya no bloquea. */
const CLAIM_TTL_MS = 3 * 60_000;
/** Un "Hecho" reciente bloquea aunque Meta todavía no liste el anuncio nuevo. */
const DONE_GUARD_MS = 10 * 60_000;

type ChangeRow = {
  id: number | string;
  platform: "meta" | "tiktok";
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  product_key: string | null;
  kind: ManualCampaignChange["kind"];
  detail: string;
  changed_at: string;
  created_by: string;
};
const toChange = (row: ChangeRow): ManualCampaignChange => ({
  platform: row.platform,
  accountId: row.account_id,
  campaignId: row.campaign_id,
  at: new Date(row.changed_at).toISOString(),
  kind: row.kind,
  detail: row.detail,
  source: "manual",
  id: String(row.id),
  by: displayUploader(row.created_by),
  campaignName: row.campaign_name,
  productKey: row.product_key,
});

export interface MoveLedger {
  /** Anota la reserva; si ya hay otra (o un "Hecho" reciente) para la misma publicación y campaña, no deja seguir. */
  claim(entry: {
    accountId: string;
    campaignId: string;
    campaignName: string;
    productKey: string | null;
    detail: string;
    marker: string;
  }): Promise<
    | { ok: true; id: string }
    | { ok: false; status: number; reason: string; duplicate?: boolean }
  >;
  /** La reserva pasa a ser el "Hecho" definitivo. null = no se pudo anotar. */
  confirm(id: string, detail: string): Promise<ManualCampaignChange | null>;
  /** Borra la reserva (Meta no creó nada). */
  release(id: string): Promise<void>;
}

const NO_LEDGER =
  "No se pudo anotar la acción en el registro de cambios, así que no se creó nada en Meta. Vuelve a intentarlo.";

/** El registro manual de cambios de Marketing (la tabla detrás de «Registrar cambio» y de «Hecho»). */
export function dbMoveLedger(
  storeId: number,
  author: string,
  now: () => number = Date.now,
): MoveLedger {
  const release = async (id: string) => {
    try {
      const { error } = await getDB()
        .from(TABLE)
        .delete()
        .eq("store_id", storeId)
        .eq("id", id);
      if (error) console.warn("[cost-cap-move] reserva sin borrar", id);
    } catch {
      console.warn("[cost-cap-move] reserva sin borrar", id);
    }
  };
  return {
    async claim(entry) {
      const at = now();
      const inserted = await getDB()
        .from(TABLE)
        .insert({
          store_id: storeId,
          platform: "meta",
          account_id: entry.accountId,
          campaign_id: entry.campaignId,
          campaign_name: entry.campaignName.slice(0, 300),
          product_key:
            entry.productKey &&
            entry.productKey.length >= 5 &&
            entry.productKey.length <= 300
              ? entry.productKey
              : null,
          // "creativo": duplicar el anuncio no toca la campaña de origen (no
          // reinicia su aprendizaje), igual que el "Hecho" a mano.
          kind: "creativo",
          detail: entry.detail,
          changed_at: new Date(at).toISOString(),
          created_by: author,
        })
        .select("id")
        .single();
      const id =
        inserted.data && !inserted.error
          ? String((inserted.data as { id: number | string }).id)
          : "";
      if (!id)
        return {
          ok: false,
          status: 503,
          reason: isMissingRelation(inserted.error)
            ? "Pendiente: aplicar migración del registro de cambios. No se creó nada en Meta."
            : NO_LEDGER,
        };
      // ¿Alguien llegó antes con la misma publicación y campaña?
      const others = await getDB()
        .from(TABLE)
        .select("id,detail,changed_at")
        .eq("store_id", storeId)
        .eq("platform", "meta")
        .like("detail", `%${entry.marker}%`)
        .gte("changed_at", new Date(at - DONE_GUARD_MS).toISOString())
        .order("id", { ascending: true })
        .limit(50);
      if (others.error || !Array.isArray(others.data)) {
        await release(id);
        return { ok: false, status: 503, reason: NO_LEDGER };
      }
      for (const row of others.data as unknown as Array<{
        id: number | string;
        detail: string;
        changed_at: string;
      }>) {
        if (String(row.id) === id || Number(row.id) > Number(id)) continue;
        const age = at - Date.parse(row.changed_at);
        if (String(row.detail).startsWith(DONE_PREFIX)) {
          await release(id);
          return {
            ok: false,
            status: 409,
            reason: MOVE_TEXT.duplicate,
            duplicate: true,
          };
        }
        if (isMoveClaim(String(row.detail)) && age < CLAIM_TTL_MS) {
          await release(id);
          return { ok: false, status: 409, reason: MOVE_TEXT.inProgress };
        }
      }
      return { ok: true, id };
    },
    async confirm(id, detail) {
      try {
        const { data, error } = await getDB()
          .from(TABLE)
          .update({ detail, changed_at: new Date(now()).toISOString() })
          .eq("store_id", storeId)
          .eq("id", id)
          .select(COLUMNS)
          .single();
        return error || !data ? null : toChange(data as unknown as ChangeRow);
      } catch {
        return null;
      }
    },
    release,
  };
}

/* ---------------------------------------------------------- Escritura */

type Posted = { ok: true; id: string } | { ok: false; failure: MoveFailure };

/** Un POST al Graph: devuelve el id creado o el motivo, nunca el texto de Meta. */
async function graphPost(
  graph: Graph,
  account: string,
  path: "ads" | "adcreatives",
  params: Record<string, string>,
): Promise<Posted> {
  try {
    const response = await graph.fetcher(`${baseOf(graph, account)}/${path}`, {
      method: "POST",
      headers: {
        ...graph.headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    const body = obj(await response.json().catch(() => null));
    const id = typeof body.id === "string" ? body.id : "";
    if (response.ok && !body.error && /^\d{1,40}$/.test(id))
      return { ok: true, id };
    const error = obj(body.error);
    const code = Number.isInteger(Number(error.code))
      ? Number(error.code)
      : null;
    warn(graph, `POST ${path}`, {
      account,
      http: response.status,
      code,
      subcode: error.error_subcode ?? null,
      type: error.type ?? null,
      trace: error.fbtrace_id ?? null,
      message: typeof error.message === "string" ? error.message : null,
    });
    return {
      ok: false,
      failure: metaWriteFailure({
        // Un 200 sin id es una respuesta que no se entiende: no se sabe si creó algo.
        http: response.ok ? 0 : response.status,
        code,
        transient: error.is_transient === true,
      }),
    };
  } catch (error) {
    warn(graph, `POST ${path}`, {
      account,
      error: error instanceof Error ? error.name : "error",
    });
    return { ok: false, failure: metaWriteFailure({ http: 0 }) };
  }
}

export type MoveOutcome =
  | {
      ok: true;
      adId: string;
      adName: string;
      /** "creative" = se reutilizó el creativo; "post" = creativo nuevo desde la publicación. */
      method: "creative" | "post";
      creativeId: string;
      destination: {
        accountId: string;
        accountName: string;
        campaignId: string;
        campaignName: string;
        adsetId: string;
        adsetName: string;
      };
      /** La línea del registro de cambios (null si no se pudo anotar el "Hecho"). */
      change: ManualCampaignChange | null;
    }
  | { ok: false; status: number; reason: string; kind?: string };

const STATUS_OF: Record<MoveFailure["kind"], number> = {
  token: 502,
  permission: 502,
  limit: 429,
  temporary: 502,
  rejected: 422,
};

/** Solicitudes idénticas en curso en este servidor (el doble clic de siempre). */
const inFlight = new Set<string>();

/**
 * POST: relee y valida todo, reserva en el registro, crea el anuncio ACTIVO y
 * deja el "Hecho". Lanza MoveReadError si ni siquiera se pudo leer.
 */
export async function createCostCapAd(
  input: { account: string; ad: string; targetAccount: string; adset: string },
  deps: MoveDeps & { ledger: MoveLedger },
): Promise<MoveOutcome> {
  const key = [input.account, input.ad, input.targetAccount, input.adset].join(
    ":",
  );
  if (inFlight.has(key))
    return { ok: false, status: 409, reason: MOVE_TEXT.inProgress };
  inFlight.add(key);
  try {
    return await create(input, deps);
  } finally {
    inFlight.delete(key);
  }
}

async function create(
  input: { account: string; ad: string; targetAccount: string; adset: string },
  deps: MoveDeps & { ledger: MoveLedger },
): Promise<MoveOutcome> {
  const graph = graphOf(deps);
  // La comprobación de duplicados es parte de esta lectura: va justo antes de escribir.
  const read = await readMove(input, deps);
  const check = validateMoveTarget(read.preview, input);
  if (!check.ok)
    return {
      ok: false,
      status: check.duplicate ? 409 : 422,
      reason: check.reason,
    };
  const { destination, adset } = check;
  const source = read.source!,
    sourceCampaign = read.sourceCampaign!,
    postId = source.postId!;
  const marker = moveMarker(postId, destination.campaignId);
  const move = {
    adId: source.id,
    postId,
    campaignId: destination.campaignId,
    adsetId: adset.id,
  };
  const claim = await deps.ledger.claim({
    accountId: sourceCampaign.accountId,
    campaignId: sourceCampaign.id,
    campaignName: sourceCampaign.name,
    productKey: read.product?.key ?? null,
    detail: moveClaimDetail(move),
    marker,
  });
  if (!claim.ok)
    return { ok: false, status: claim.status, reason: claim.reason };

  const name = read.preview.newAdName;
  const target = destination.accountId;
  const postAd = (creativeId: string) =>
    graphPost(graph, target, "ads", {
      name,
      adset_id: adset.id,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: "ACTIVE",
    });
  /** Tras un fallo dudoso: ¿Meta creó el anuncio de todos modos? Una sola lectura. */
  const createdAnyway = async (): Promise<string | null> => {
    try {
      const now = await readAds(
        graph,
        target,
        inFilter("campaign.id", [destination.campaignId]),
        AbortSignal.timeout(READ_TIMEOUT_MS),
      );
      return (
        now.find(
          (ad) =>
            ad.campaignId === destination.campaignId && ad.postId === postId,
        )?.id ?? null
      );
    } catch {
      return null;
    }
  };
  const fail = async (
    failure: MoveFailure,
    /** No se sabe si Meta creó el anuncio: la reserva se queda y frena reintentos. */
    unsure = false,
  ): Promise<MoveOutcome> => {
    if (!unsure) await deps.ledger.release(claim.id);
    return {
      ok: false,
      status: STATUS_OF[failure.kind],
      reason: failure.reason,
      kind: failure.kind,
    };
  };
  const done = async (
    adId: string,
    method: "creative" | "post",
    creativeId: string,
  ): Promise<MoveOutcome> => ({
    ok: true,
    adId,
    adName: name,
    method,
    creativeId,
    destination: {
      accountId: destination.accountId,
      accountName: destination.accountName,
      campaignId: destination.campaignId,
      campaignName: destination.campaignName,
      adsetId: adset.id,
      adsetName: adset.name,
    },
    change: await deps.ledger.confirm(
      claim.id,
      moveDoneDetail({
        ...move,
        newAdId: adId,
        targetAccount: destination.sameAccount ? null : destination.accountId,
      }),
    ),
  });

  // 1. Misma cuenta: el mismo creativo (misma publicación, mismos parámetros de URL).
  if (destination.sameAccount && source.creativeId) {
    const reused = await postAd(source.creativeId);
    if (reused.ok) return done(reused.id, "creative", source.creativeId);
    if (reused.failure.kind === "temporary") {
      const existing = await createdAnyway();
      return existing
        ? done(existing, "creative", source.creativeId)
        : fail(reused.failure, true);
    }
    // Permiso, token o límite: otro intento fallaría igual.
    if (reused.failure.kind !== "rejected") return fail(reused.failure);
  }
  // 2. Otra cuenta (un creativo no se comparte entre cuentas) o creativo
  //    rechazado: UN creativo nuevo desde la publicación y, con él, el anuncio.
  const creative = await graphPost(graph, target, "adcreatives", {
    object_story_id: postId,
    ...(source.urlTags ? { url_tags: source.urlTags } : {}),
  });
  if (!creative.ok)
    return fail(
      !destination.sameAccount &&
        (creative.failure.kind === "rejected" ||
          creative.failure.kind === "permission")
        ? {
            kind: creative.failure.kind,
            reason: "La cuenta destino no puede usar esta publicación.",
          }
        : creative.failure.kind === "rejected"
          ? { kind: "rejected", reason: MOVE_FAILURE_TEXT.rejected }
          : creative.failure,
    );
  const fresh = await postAd(creative.id);
  if (fresh.ok) return done(fresh.id, "post", creative.id);
  if (fresh.failure.kind === "temporary") {
    const existing = await createdAnyway();
    return existing
      ? done(existing, "post", creative.id)
      : fail(fresh.failure, true);
  }
  return fail(fresh.failure);
}
