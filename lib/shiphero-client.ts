// Cliente HTTP de la API pública de ShipHero (solo servidor, sin base de datos).
//
// La contraseña solo viaja a /auth/token. Nunca se registra ni se devuelve.
// Los textos de ShipHero tampoco salen de aquí: pueden repetir credenciales o
// datos de la cuenta. Hacia afuera solo van códigos (ShipHeroError.code) y los
// mensajes fijos de SHIPHERO_MESSAGES.
//
// Lo no confirmado de la API (ver la investigación del 06/11/2026) se maneja
// de forma defensiva: argumentos opcionales armados según la cuenta, guardia de
// cuenta/almacén en cada fila y "en camino" solo cuando la lectura es completa.
import { inventorySkuKey } from "./marketing-inventory-csv";
import type { MarketingStock } from "./marketing-source-types";

export const SHIPHERO_BASE = "https://public-api.shiphero.com";

export type ShipHeroErrorCode =
  | "bad_credentials" // 401/403 en /auth/token
  | "auth_gone" // 404/405/410 en /auth/token (endpoint retirado)
  | "api_disabled" // 403 "Public API access is disabled"
  | "locked" // cuenta bloqueada
  | "token_expired" // 401 / "Token is expired" en /graphql (se maneja adentro)
  | "reconnect" // /auth/refresh 401/403
  | "throttled" // créditos (code 30) tras reintentos, o 429
  | "too_complex" // required_credits > max_available
  | "timeout"
  | "network"
  | "scope_mismatch" // filas de otra cuenta/almacén
  | "needs_scope" // falta elegir cliente/almacén
  | "unexpected";

export interface ShipHeroChoice {
  id: string;
  name: string;
}

export class ShipHeroError extends Error {
  constructor(
    readonly code: ShipHeroErrorCode,
    readonly retryAfterMs?: number,
    /** Almacenes vistos en las filas cuando hay que elegir uno (needs_scope). */
    readonly warehouses?: ShipHeroChoice[],
  ) {
    super(code); // never the provider's text: it may echo credentials
    this.name = "ShipHeroError";
  }
}

export const SHIPHERO_MESSAGES: Record<ShipHeroErrorCode, string> = {
  bad_credentials:
    "Usuario o contraseña incorrectos, o el usuario no tiene acceso a la API de ShipHero.",
  auth_gone:
    "ShipHero ya no acepta usuario y contraseña. Pide a Boxful un token de desarrollador y usa «Tengo un token».",
  api_disabled:
    "Tu usuario de ShipHero no tiene «API Access». Pide a Boxful que lo active.",
  locked: "La cuenta de ShipHero está bloqueada. Habla con Boxful.",
  token_expired: "El acceso de ShipHero venció. Vuelve a conectar.",
  reconnect: "ShipHero rechazó el acceso guardado. Vuelve a conectar.",
  throttled:
    "ShipHero está ocupado (límite de consultas). Prueba en unos minutos.",
  too_complex:
    "La consulta a ShipHero es demasiado grande. Avísale a soporte de Kairo.",
  timeout: "ShipHero no respondió a tiempo. Prueba de nuevo en unos minutos.",
  network: "No se pudo conectar con ShipHero. Prueba de nuevo en unos minutos.",
  scope_mismatch:
    "ShipHero devolvió datos de otra cuenta o almacén. No se guardó nada.",
  needs_scope: "Elige el cliente y el almacén de ShipHero.",
  unexpected: "Respuesta inesperada de ShipHero. No se guardó nada.",
};

export interface ShipHeroDeps {
  fetcher?: typeof fetch; // tests inject a mock
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal; // outer abort
  deadline?: number; // epoch ms; no new request starts with < 5 s left, none runs past it
}

export interface ShipHeroTokens {
  accessToken: string;
  refreshToken: string | null; // null on refresh when ShipHero did not rotate it
  expiresAt: string; // ISO = now + expires_in
}

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
    throw new ShipHeroError("unexpected");
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ShipHeroError("unexpected");
  return parsed;
}

const REQUEST_TIMEOUT_MS = 15_000;
const DEADLINE_MARGIN_MS = 5_000;
/** A request with less time than this before the deadline is not started. */
const MIN_REQUEST_MS = 3_000;
const DAY_S = 86_400;

const nowMs = (deps: ShipHeroDeps) =>
  deps.now ? deps.now().getTime() : Date.now();
const sleepOf = (deps: ShipHeroDeps) =>
  deps.sleep ??
  ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

function checkDeadline(deps: ShipHeroDeps, extraMs = 0) {
  if (deps.deadline && deps.deadline - nowMs(deps) < DEADLINE_MARGIN_MS + extraMs)
    throw new ShipHeroError("timeout");
  if (deps.signal?.aborted) throw new ShipHeroError("timeout");
}

interface RawResponse {
  status: number;
  body: Json;
  /** Only for regex checks inside this file; never forwarded. */
  text: string;
  retryAfter: string | null;
}

async function send(
  path: string,
  init: { headers: Record<string, string>; body: string },
  deps: ShipHeroDeps,
): Promise<RawResponse> {
  const fetcher = deps.fetcher ?? fetch;
  // Never past the deadline: the caller still needs time to save (maxDuration).
  const timeoutMs = deps.deadline
    ? Math.min(REQUEST_TIMEOUT_MS, deps.deadline - nowMs(deps))
    : REQUEST_TIMEOUT_MS;
  if (timeoutMs < MIN_REQUEST_MS) throw new ShipHeroError("timeout");
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (deps.signal) signals.push(deps.signal);
  let response: Response;
  try {
    response = await fetcher(`${SHIPHERO_BASE}${path}`, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new ShipHeroError(
      name === "AbortError" || name === "TimeoutError" ? "timeout" : "network",
    );
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    throw new ShipHeroError("network");
  }
  let body: Json = {};
  try {
    body = obj(JSON.parse(text));
  } catch {
    body = {};
  }
  return {
    status: response.status,
    body,
    text: text.slice(0, 4000),
    retryAfter: response.headers?.get?.("retry-after") ?? null,
  };
}

function parseTokens(
  body: Json,
  deps: ShipHeroDeps,
  refreshRequired: boolean,
): ShipHeroTokens {
  const access = str(body.access_token);
  if (access.length < 20 || access.length > 8000)
    throw new ShipHeroError("unexpected");
  const rawRefresh = str(body.refresh_token);
  const refresh =
    rawRefresh.length >= 10 && rawRefresh.length <= 2000 ? rawRefresh : null;
  if (refreshRequired && !refresh) throw new ShipHeroError("unexpected");
  const expires = body.expires_in;
  // A strange value is not trusted: 7 days makes Kairo refresh early.
  const seconds =
    typeof expires === "number" &&
    Number.isInteger(expires) &&
    expires >= 60 &&
    expires <= 90 * DAY_S
      ? expires
      : 7 * DAY_S;
  return {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: new Date(nowMs(deps) + seconds * 1000).toISOString(),
  };
}

function authFailure(res: RawResponse, path: "token" | "refresh"): never {
  const { status, text } = res;
  if (status === 401 || status === 403) {
    if (path === "refresh") throw new ShipHeroError("reconnect");
    if (/public api access is disabled/i.test(text))
      throw new ShipHeroError("api_disabled");
    if (/"locked"\s*:\s*true/i.test(text)) throw new ShipHeroError("locked");
    throw new ShipHeroError("bad_credentials");
  }
  if (path === "token" && [404, 405, 410].includes(status))
    throw new ShipHeroError("auth_gone");
  if (status === 429) throw new ShipHeroError("throttled");
  if (status >= 500) throw new ShipHeroError("network");
  throw new ShipHeroError("unexpected");
}

/**
 * Usuario y contraseña → tokens. Una sola llamada, sin reintentos (ShipHero
 * limita /auth/token y a veces devuelve 401 intermitente).
 */
export async function login(
  username: string,
  password: string,
  deps: ShipHeroDeps = {},
): Promise<ShipHeroTokens & { refreshToken: string }> {
  checkDeadline(deps);
  // Sin Authorization: un bearer enviado aquí rompe el login.
  const res = await send(
    "/auth/token",
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
    deps,
  );
  if (res.status < 200 || res.status >= 300) authFailure(res, "token");
  const tokens = parseTokens(res.body, deps, true);
  return { ...tokens, refreshToken: tokens.refreshToken! };
}

/** Refresh token → access token nuevo. Un reintento solo ante 5xx o red. */
export async function refreshAccess(
  refreshToken: string,
  deps: ShipHeroDeps = {},
): Promise<ShipHeroTokens> {
  for (let attempt = 0; attempt < 2; attempt++) {
    checkDeadline(deps);
    try {
      const res = await send(
        "/auth/refresh",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
        deps,
      );
      if (res.status < 200 || res.status >= 300) authFailure(res, "refresh");
      return parseTokens(res.body, deps, false);
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof ShipHeroError &&
        error.code === "network"
      ) {
        await sleepOf(deps)(1_000);
        continue;
      }
      throw error;
    }
  }
  throw new ShipHeroError("network");
}

export interface GqlResult {
  data: Json;
  complexity: number | null;
  creditsRemaining: number | null;
}

const EXPIRED = /token is expired|unauthorized request/i;
const THROTTLE_ATTEMPTS = 3;
const BUSY_BACKOFF_MS = [1_000, 3_000];

function throttleWait(errors: Json[]): number {
  for (const error of errors) {
    const raw = str(error.time_remaining ?? obj(error.extensions).time_remaining);
    const match = /(\d+(?:\.\d+)?)\s*second/i.exec(raw);
    if (match) return (Math.ceil(Number(match[1])) + 1) * 1000;
  }
  return 5_000;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/** POST /graphql with throttling handled inside (never in parallel). */
export async function graphql(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  deps: ShipHeroDeps = {},
): Promise<GqlResult> {
  let throttles = 0;
  let busy = 0;
  for (;;) {
    checkDeadline(deps);
    const res = await send(
      "/graphql",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      },
      deps,
    );
    const message = str(res.body.message);
    if (res.status === 401 || (EXPIRED.test(message) && !res.body.data))
      throw new ShipHeroError("token_expired");
    if (res.status === 403)
      throw new ShipHeroError(
        /public api access is disabled/i.test(res.text)
          ? "api_disabled"
          : "unexpected",
      );
    if ([429, 502, 503, 504].includes(res.status)) {
      const header = Number(res.retryAfter);
      const wait =
        Number.isFinite(header) && header >= 0
          ? Math.min(header * 1000, 10_000)
          : BUSY_BACKOFF_MS[busy] ?? 3_000;
      const left = deps.deadline ? deps.deadline - nowMs(deps) : Infinity;
      if (busy < 2 && left > wait + DEADLINE_MARGIN_MS) {
        busy++;
        await sleepOf(deps)(wait);
        continue;
      }
      throw new ShipHeroError(res.status === 429 ? "throttled" : "network");
    }
    if (res.status >= 500) throw new ShipHeroError("network");
    if (res.status < 200 || res.status >= 300)
      throw new ShipHeroError("unexpected");

    const errors = list(res.body.errors).map(obj);
    if (errors.length) {
      const throttle = errors.find(
        (error) =>
          Number(error.code ?? obj(error.extensions).code) === 30 ||
          /not enough credits/i.test(str(error.message)),
      );
      if (throttle) {
        const required = numberOrNull(
          throttle.required_credits ?? obj(throttle.extensions).required_credits,
        );
        const max = numberOrNull(
          throttle.max_available ??
            obj(throttle.extensions).max_available ??
            obj(obj(obj(res.body.extensions).throttling).user_quota)
              .max_available,
        );
        if (required != null && max != null && required > max)
          throw new ShipHeroError("too_complex");
        const wait = throttleWait(errors);
        throttles++;
        const left = deps.deadline ? deps.deadline - nowMs(deps) : Infinity;
        if (throttles < THROTTLE_ATTEMPTS && left > wait + DEADLINE_MARGIN_MS) {
          await sleepOf(deps)(wait);
          continue;
        }
        throw new ShipHeroError("throttled", wait);
      }
      if (errors.some((error) => EXPIRED.test(str(error.message))))
        throw new ShipHeroError("token_expired");
      // Only the codes matter; provider messages never leave this function.
      throw new ShipHeroError("unexpected");
    }
    const data = obj(res.body.data);
    const complexity =
      Object.values(data)
        .map((entry) => numberOrNull(obj(entry).complexity))
        .find((value) => value != null) ?? null;
    return {
      data,
      complexity,
      creditsRemaining: numberOrNull(
        obj(obj(obj(res.body.extensions).throttling).user_quota)
          .credits_remaining,
      ),
    };
  }
}

/**
 * Access token plus an optional way to renew it. On "token expired" the
 * request is retried once with a renewed token (once per auth object); a
 * second "token expired" means the saved access is no longer accepted.
 */
export interface ShipHeroAuth {
  token: string;
  renew?: () => Promise<string>;
  renewed?: boolean;
}

async function authedGraphql(
  auth: string | ShipHeroAuth,
  query: string,
  variables: Record<string, unknown>,
  deps: ShipHeroDeps,
): Promise<GqlResult> {
  const current = typeof auth === "string" ? { token: auth } : auth;
  try {
    return await graphql(current.token, query, variables, deps);
  } catch (error) {
    if (
      !(error instanceof ShipHeroError) ||
      error.code !== "token_expired" ||
      !current.renew ||
      current.renewed
    )
      throw error;
  }
  current.renewed = true;
  current.token = await current.renew();
  try {
    return await graphql(current.token, query, variables, deps);
  } catch (error) {
    if (error instanceof ShipHeroError && error.code === "token_expired")
      throw new ShipHeroError("reconnect");
    throw error;
  }
}

// ─── Identity ────────────────────────────────────────────────────────────────

export interface ShipHeroAccount {
  id: string;
  legacyId: number | null;
  email: string | null;
  is3pl: boolean;
  warehouses: Array<{
    id: string;
    legacyId: number | null;
    name: string;
    active: boolean;
  }>;
  /** Only when is3pl (id and username; never the e-mail). */
  customers: Array<{ id: string; legacyId: number | null; name: string }>;
  customersTruncated: boolean;
}

const WAREHOUSE_FIELDS = "id legacy_id identifier active";
const accountQuery = (connection: boolean) => `query KairoAccount {
  account {
    request_id complexity
    data {
      id legacy_id email username is_3pl
      warehouses { ${connection ? `edges { node { ${WAREHOUSE_FIELDS} } }` : WAREHOUSE_FIELDS} }
    }
  }
}`;
const CUSTOMERS_QUERY = `query KairoCustomers($after: String) {
  account {
    request_id complexity
    data {
      customers(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges { node { id legacy_id username } }
      }
    }
  }
}`;

/** Accepts a plain list or a `{ edges: [{ node }] }` connection. */
function nodes(value: unknown): Json[] {
  if (Array.isArray(value)) return value.map(obj);
  return list(obj(value).edges).map((edge) => obj(obj(edge).node));
}

/** Who the token belongs to, its warehouses and (3PL) its customers. */
export async function discoverAccount(
  accessToken: string,
  deps: ShipHeroDeps = {},
): Promise<ShipHeroAccount> {
  // Whether `warehouses` is a list or a connection is not confirmed: the list
  // shape goes first and the connection shape only if the first is rejected.
  let result: GqlResult;
  try {
    result = await graphql(accessToken, accountQuery(false), {}, deps);
  } catch (error) {
    if (!(error instanceof ShipHeroError) || error.code !== "unexpected")
      throw error;
    result = await graphql(accessToken, accountQuery(true), {}, deps);
  }
  const data = obj(obj(result.data.account).data);
  const id = str(data.id);
  if (!id || typeof data.is_3pl !== "boolean")
    throw new ShipHeroError("unexpected");
  const warehouses = nodes(data.warehouses)
    .map((row) => ({
      id: str(row.id),
      legacyId: numberOrNull(row.legacy_id),
      name: (str(row.identifier) || str(row.id)).slice(0, 200),
      active: row.active !== false,
    }))
    .filter((row) => row.id);
  const customers: ShipHeroAccount["customers"] = [];
  let customersTruncated = false;
  if (data.is_3pl) {
    let after: string | null = null;
    for (let page = 0; ; page++) {
      if (page === 4) {
        customersTruncated = true;
        break;
      }
      const res = await graphql(accessToken, CUSTOMERS_QUERY, { after }, deps);
      const connection = obj(obj(obj(res.data.account).data).customers);
      for (const row of nodes(connection)) {
        const customerId = str(row.id);
        if (!customerId) continue;
        customers.push({
          id: customerId,
          legacyId: numberOrNull(row.legacy_id),
          // Never the e-mail: other brands of the 3PL must not be exposed.
          name: (str(row.username) || customerId).slice(0, 200),
        });
      }
      const paging = obj(connection.pageInfo);
      const next = str(paging.endCursor);
      if (paging.hasNextPage !== true || !next || next === after) break;
      after = next;
    }
  }
  return {
    id,
    legacyId: numberOrNull(data.legacy_id),
    email: (str(data.email) || str(data.username) || null)?.slice(0, 200) ?? null,
    is3pl: data.is_3pl,
    warehouses,
    customers,
    customersTruncated,
  };
}

// ─── IDs ─────────────────────────────────────────────────────────────────────

function decodeId(id: string): { type: string | null; n: number } | null {
  if (/^\d+$/.test(id)) return { type: null, n: Number(id) };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(id)) return null;
  const match = /^([A-Za-z]+):(\d+)$/.exec(
    Buffer.from(id, "base64").toString("utf8"),
  );
  return match ? { type: match[1], n: Number(match[2]) } : null;
}

/** Legacy number of a public id (base64 "<Type>:<n>") or of a digits-only id. */
export function shipheroLegacyId(id: string): number | null {
  return decodeId(id)?.n ?? null;
}

/** Same ShipHero entity: equal strings, or the same legacy number (and type, when both carry one). */
export function sameShipHeroId(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const left = decodeId(a);
  const right = decodeId(b);
  if (!left || !right || left.n !== right.n) return false;
  return !left.type || !right.type || left.type === right.type;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export interface ShipHeroScope {
  is3pl: boolean;
  /** Own account id (account.data.id). */
  accountId: string;
  accountLegacyId: number | null;
  /** Required when is3pl. */
  customerAccountId: string | null;
  /** null = no warehouse filter (customer token with 0 visible warehouses). */
  warehouseId: string | null;
}

export interface ShipHeroStockRow {
  id: string;
  sku: string;
  name: string;
  warehouseId: string;
  warehouseName: string;
  onHand: number;
  available: number;
  allocated: number;
  backorder: number | null;
}

/** Variables and argument list: `customer_account_id` only for a 3PL token (omit it otherwise). */
function scopeArgs(scope: ShipHeroScope) {
  const defs: string[] = [];
  const args: string[] = [];
  const variables: Record<string, unknown> = {};
  if (scope.warehouseId) {
    defs.push("$warehouse: String");
    args.push("warehouse_id: $warehouse");
    variables.warehouse = scope.warehouseId;
  }
  if (scope.is3pl) {
    defs.push("$customer: String");
    args.push("customer_account_id: $customer");
    variables.customer = scope.customerAccountId;
  }
  return { defs, args, variables };
}

export function stockQuery(scope: ShipHeroScope): {
  query: string;
  variables: Record<string, unknown>;
} {
  const { defs, args, variables } = scopeArgs(scope);
  const call = args.length ? `warehouse_products(${args.join(", ")})` : "warehouse_products";
  return {
    query: `query KairoStock(${["$after: String", ...defs].join(", ")}) {
  ${call} {
    request_id complexity
    data(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id sku account_id warehouse_id warehouse_identifier on_hand available allocated backorder product { name } } }
    }
  }
}`,
    variables,
  };
}

const MAX_STOCK_PAGES = 25;

/** Whole inventory of the scope, page by page. Never returns a partial result. */
export async function readWarehouseProducts(
  accessToken: string | ShipHeroAuth,
  scope: ShipHeroScope,
  deps: ShipHeroDeps = {},
  onPage?: (result: GqlResult) => void,
): Promise<ShipHeroStockRow[]> {
  if (scope.is3pl && !scope.customerAccountId)
    throw new ShipHeroError("needs_scope");
  const expectedAccount = scope.is3pl
    ? scope.customerAccountId!
    : scope.accountId;
  const { query, variables } = stockQuery(scope);
  const rows: ShipHeroStockRow[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < MAX_STOCK_PAGES; page++) {
    const result = await authedGraphql(
      accessToken,
      query,
      { ...variables, after },
      deps,
    );
    onPage?.(result);
    const data = obj(obj(result.data.warehouse_products).data);
    if (!Array.isArray(data.edges)) throw new ShipHeroError("unexpected");
    for (const entry of data.edges) {
      const row = obj(obj(entry).node);
      const id = str(row.id);
      const sku = str(row.sku).trim();
      if (!id || !sku) throw new ShipHeroError("unexpected");
      if (!sameShipHeroId(str(row.account_id), expectedAccount))
        throw new ShipHeroError("scope_mismatch");
      const warehouseId = str(row.warehouse_id);
      if (!warehouseId) throw new ShipHeroError("unexpected");
      if (scope.warehouseId && !sameShipHeroId(warehouseId, scope.warehouseId))
        throw new ShipHeroError("scope_mismatch");
      if (seen.has(id)) throw new ShipHeroError("unexpected");
      seen.add(id);
      rows.push({
        id,
        sku,
        name: str(obj(row.product).name).slice(0, 300),
        warehouseId,
        warehouseName: (str(row.warehouse_identifier) || warehouseId).slice(
          0,
          200,
        ),
        onHand: metric(row.on_hand),
        available: metric(row.available),
        allocated: metric(row.allocated),
        backorder: row.backorder == null ? null : metric(row.backorder),
      });
    }
    const paging = obj(data.pageInfo);
    if (paging.hasNextPage === false) {
      if (!scope.warehouseId) {
        // Stock of different warehouses (countries) is never added up silently.
        const distinct = new Map<string, string>();
        for (const row of rows)
          if (!distinct.has(row.warehouseId))
            distinct.set(row.warehouseId, row.warehouseName);
        if (distinct.size > 1)
          throw new ShipHeroError(
            "needs_scope",
            undefined,
            Array.from(distinct, ([warehouseId, name]) => ({
              id: warehouseId,
              name,
            })),
          );
      }
      return rows;
    }
    const next = str(paging.endCursor);
    if (paging.hasNextPage !== true || !next || next === after)
      throw new ShipHeroError("unexpected");
    after = next;
  }
  throw new ShipHeroError("too_complex");
}

export type ShipHeroStockItem = MarketingStock & {
  name: string;
  warehouses: string[];
};

/** One row per SKU (stockIndex treats a repeated SKU as ambiguous). */
export function aggregateShipHeroStock(
  rows: ShipHeroStockRow[],
  incoming: Map<string, number> | null,
): ShipHeroStockItem[] {
  const grouped = new Map<
    string,
    ShipHeroStockItem & { warehouseIds: Set<string> }
  >();
  for (const row of rows) {
    const key = inventorySkuKey(row.sku);
    const current = grouped.get(key) ?? {
      sku: row.sku,
      name: "",
      warehouseId: row.warehouseId,
      warehouses: [],
      warehouseIds: new Set<string>(),
      onHand: 0,
      available: 0,
      allocated: 0,
      backorder: null,
    };
    current.name ||= row.name;
    current.onHand += row.onHand;
    current.available += row.available;
    current.allocated += row.allocated;
    if (row.backorder != null)
      current.backorder = (current.backorder ?? 0) + row.backorder;
    current.warehouseIds.add(row.warehouseId);
    if (!current.warehouses.includes(row.warehouseName))
      current.warehouses.push(row.warehouseName);
    grouped.set(key, current);
  }
  return Array.from(grouped, ([key, item]) => {
    const { warehouseIds, ...rest } = item;
    return {
      ...rest,
      warehouseId: warehouseIds.size > 1 ? "varias" : rest.warehouseId,
      // No open PO line = no data (null), never 0: the manual plan still applies.
      incoming: incoming ? (incoming.get(key) ?? null) : null,
    };
  }).sort((a, b) => a.sku.localeCompare(b.sku));
}

// ─── Incoming (open purchase orders, best effort) ────────────────────────────

const CLOSED = new Set(["closed", "canceled", "cancelled"]);
const MAX_PO_PAGES = 5;

export function incomingQuery(scope: ShipHeroScope, since: string) {
  // `created_from` type is not confirmed: the date goes inline (validated).
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(since))
    throw new ShipHeroError("unexpected");
  const { defs, args, variables } = scopeArgs(scope);
  return {
    query: `query KairoIncoming(${["$after: String", ...defs].join(", ")}) {
  purchase_orders(${[`created_from: "${since}"`, ...args].join(", ")}) {
    request_id complexity
    data(first: 20, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id po_date fulfillment_status warehouse_id
        line_items(first: 50) {
          pageInfo { hasNextPage }
          edges { node { sku quantity quantity_received quantity_rejected fulfillment_status } }
        }
      } }
    }
  }
}`,
    variables,
  };
}

/**
 * Units on the way per SKU (lowercase) from open purchase orders created in
 * the window (`since`, 180 days in the sync). An older open PO is not read:
 * the value is approximate, and a SKU without a PO line stays null. Never throws:
 * any doubt gives `complete: false`, and the caller then drops "en camino".
 */
export async function readIncoming(
  accessToken: string | ShipHeroAuth,
  scope: ShipHeroScope,
  deps: ShipHeroDeps & { since: string },
): Promise<{
  bySku: Map<string, number>;
  complete: boolean;
  earliestPoDate: Map<string, string>;
}> {
  const bySku = new Map<string, number>();
  const earliestPoDate = new Map<string, string>();
  const incomplete = { bySku, complete: false, earliestPoDate };
  if (scope.is3pl && !scope.customerAccountId) return incomplete;
  try {
    const { query, variables } = incomingQuery(scope, deps.since);
    let after: string | null = null;
    for (let page = 0; page < MAX_PO_PAGES; page++) {
      const result = await authedGraphql(
        accessToken,
        query,
        { ...variables, after },
        deps,
      );
      const data = obj(obj(result.data.purchase_orders).data);
      if (!Array.isArray(data.edges)) return incomplete;
      for (const entry of data.edges) {
        const po = obj(obj(entry).node);
        if (CLOSED.has(str(po.fulfillment_status).trim().toLowerCase()))
          continue;
        if (
          scope.warehouseId &&
          str(po.warehouse_id) &&
          !sameShipHeroId(str(po.warehouse_id), scope.warehouseId)
        )
          continue;
        const lines = obj(po.line_items);
        if (obj(lines.pageInfo).hasNextPage !== false) return incomplete;
        if (!Array.isArray(lines.edges)) return incomplete;
        for (const lineEntry of lines.edges) {
          const line = obj(obj(lineEntry).node);
          if (CLOSED.has(str(line.fulfillment_status).trim().toLowerCase()))
            continue;
          const sku = str(line.sku).trim();
          if (!sku) return incomplete;
          const pending = Math.max(
            0,
            metric(line.quantity) -
              (line.quantity_received == null
                ? 0
                : metric(line.quantity_received)) -
              (line.quantity_rejected == null
                ? 0
                : metric(line.quantity_rejected)),
          );
          if (!pending) continue;
          const key = inventorySkuKey(sku);
          bySku.set(key, (bySku.get(key) ?? 0) + pending);
          const poDate = str(po.po_date).slice(0, 10);
          if (
            /^\d{4}-\d{2}-\d{2}$/.test(poDate) &&
            (!earliestPoDate.has(key) || poDate < earliestPoDate.get(key)!)
          )
            earliestPoDate.set(key, poDate);
        }
      }
      const paging = obj(data.pageInfo);
      if (paging.hasNextPage === false)
        return { bySku, complete: true, earliestPoDate };
      const next = str(paging.endCursor);
      if (paging.hasNextPage !== true || !next || next === after)
        return incomplete;
      after = next;
    }
    return incomplete;
  } catch {
    return incomplete;
  }
}
