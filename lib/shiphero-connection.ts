// Conexión de Marketing con ShipHero (Mireva CR). Solo servidor.
//
// - Conectar: la contraseña (o el refresh token) se usa una sola vez contra
//   ShipHero y se descarta. Se guarda solo el acceso que entrega ShipHero,
//   cifrado con SHIPHERO_TOKEN_KEY (lib/secret-box.ts).
// - Sincronizar: el cron (4 veces al día) y "Sincronizar ahora" guardan una
//   foto `source='shiphero'` del inventario. El tablero lee esa foto y nunca
//   llama a ShipHero al abrir la página.
// - Desconectar: un UPDATE que borra el acceso guardado; la fila (auditoría) y
//   las fotos se conservan. La tabla no tiene permiso de DELETE.
// - Cada foto guarda su alcance (cuenta|cliente|almacén). El tablero solo usa
//   fotos del alcance actual, y la base solo guarda una foto si la conexión
//   no cambió durante la lectura (token_generation + alcance).
// - «Todos los almacenes» (warehouse_id "*", elegido a mano y solo con 2 o más
//   almacenes activos): se lee sin filtro de almacén y el stock se suma por
//   SKU. Cada fila debe seguir siendo de la cuenta (o del cliente 3PL); se
//   acepta cualquier almacén de esa cuenta, también uno nuevo que aún no esté
//   en la lista guardada.
// Tabla: supabase/migrations/20261106120000_marketing_shiphero_connection.sql.
import { getDB } from "./db";
import { timeCrText } from "./marketing-copy";
import { marketingDate, shiftDate } from "./marketing-dates";
import { matchInventoryToCatalog } from "./marketing-inventory-csv";
import {
  InventoryStorageError,
  displayUploader,
  isMissingRelation,
  readInventorySnapshots,
  saveShipHeroSnapshot,
} from "./marketing-inventory-db";
import type {
  MarketingInventory,
  MarketingSource,
} from "./marketing-source-types";
import {
  SHIPHERO_KEY_VAR,
  SecretKeyError,
  loadSecretKey,
  openSecret,
  sealSecret,
  sealedWithCurrentKey,
  secretKeyStatus,
} from "./secret-box";
import {
  SHIPHERO_ALL_WAREHOUSES,
  SHIPHERO_ALL_WAREHOUSES_NAME,
  SHIPHERO_MESSAGES,
  ShipHeroError,
  aggregateShipHeroStock,
  discoverAccount,
  login,
  readIncoming,
  readWarehouseProducts,
  refreshAccess,
  shipheroLegacyId,
  type ShipHeroAuth,
  type ShipHeroDeps,
  type ShipHeroScope,
} from "./shiphero-client";

type Env = Record<string, string | undefined>;
const TABLE = "marketing_shiphero_connection";

export const SHIPHERO_PENDING_MIGRATION =
  "Pendiente: aplicar migración de ShipHero.";
export const SHIPHERO_KEY_PENDING = `Pendiente: configurar ${SHIPHERO_KEY_VAR}.`;
/** A cached access token with less than this left is refreshed first. */
const REFRESH_MARGIN_MS = 3 * 86_400_000;
const LEASE_SECONDS = 90;
const CATALOG_TIMEOUT_MS = 10_000;
/** After the ShipHero deadline: time left for the catalog wait, before the DB writes. */
const CATALOG_GRACE_MS = 5_000;
export const SHIPHERO_INCOMING_DAYS = 180;
/** Between manual syncs: ShipHero credits are shared with Boxful's other integrations. */
export const SHIPHERO_SYNC_COOLDOWN_MS = 10 * 60_000;
/**
 * Deadline for the ShipHero reads of one sync, from the request start. The
 * routes run with maxDuration = 60: the catalog wait (≤ 5 s) and the DB writes
 * fit in the remaining time.
 */
export const SHIPHERO_SYNC_BUDGET_MS = 40_000;

export type ShipHeroState =
  | "not_connected"
  | "connected"
  | "needs_scope"
  | "reconnect"
  | "disconnected";

export interface ShipHeroChoices {
  warehouses: Array<{ id: string; name: string; active: boolean }>;
  customers: Array<{ id: string; name: string }>;
  customersTruncated: boolean;
}

/** Safe for the browser: no tokens. */
export interface ShipHeroStatus {
  key: { configured: boolean; message: string | null };
  state: ShipHeroState;
  authMethod: "password" | "refresh_token" | null;
  userEmail: string | null;
  accountKind: "3pl" | "cuenta" | null;
  customer: { id: string; name: string } | null;
  /**
   * null = sin filtro (una sola bodega visible). id "*" = «Todos los
   * almacenes» (suma); `count` = almacenes activos que suma.
   */
  warehouse: { id: string; name: string; count?: number } | null;
  choices: ShipHeroChoices;
  connectedBy: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncOkAt: string | null;
  lastSyncRows: number | null;
  incoming: boolean | null;
  lastError: string | null;
  /** SHIPHERO_CR_* completo (configuración del servidor). */
  staticEnv: boolean;
  /** Milliseconds (server clock) until "Sincronizar ahora" is allowed again. */
  syncInMs: number;
}

export interface ConnectionRow {
  store_id: number;
  state: "connected" | "needs_scope" | "reconnect" | "disconnected";
  auth_method: "password" | "refresh_token" | null;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_expires_at: string | null;
  token_generation: number;
  sh_user_email: string | null;
  sh_account_id: string | null;
  sh_account_legacy_id: number | null;
  is_3pl: boolean | null;
  customer_account_id: string | null;
  customer_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  choices: unknown;
  connected_by: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
  last_sync_ok_at: string | null;
  last_sync_rows: number | null;
  last_sync_incoming: boolean | null;
  last_error: string | null;
}

const COLUMNS =
  "store_id,state,auth_method,refresh_token_enc,access_token_enc,access_expires_at,token_generation,sh_user_email,sh_account_id,sh_account_legacy_id,is_3pl,customer_account_id,customer_name,warehouse_id,warehouse_name,choices,connected_by,connected_at,last_sync_at,last_sync_ok_at,last_sync_rows,last_sync_incoming,last_error";

/** Friendly error: the DB detail stays on the server. */
export class ShipHeroStorageError extends Error {
  constructor(readonly pendingMigration = false) {
    super(
      pendingMigration
        ? SHIPHERO_PENDING_MIGRATION
        : "No se pudo leer la conexión con ShipHero.",
    );
    this.name = "ShipHeroStorageError";
  }
}

/** A choice that is not among the discovered options (400 in the route). */
export class ShipHeroChoiceError extends Error {
  constructor(message = "Esa opción ya no está disponible. Vuelve a conectar.") {
    super(message);
    this.name = "ShipHeroChoiceError";
  }
}

/** A connect/disconnect happened while a refresh or sync was running. */
class Superseded extends Error {}

const aad = (storeId: number, column: "refresh" | "access") =>
  `shiphero:${storeId}:${column}`;

/** Scope of the rows of one sync: "<account>|<customer>|<warehouse>" (ids only). Same formula as the SQL guard. */
export const shipheroScopeKey = (
  row: Pick<ConnectionRow, "sh_account_id" | "customer_account_id" | "warehouse_id">,
) =>
  `${row.sh_account_id ?? ""}|${row.customer_account_id ?? ""}|${row.warehouse_id ?? ""}`;

/** Milliseconds until a manual sync is allowed (0 = now). */
export function syncCooldownLeftMs(
  row: Pick<ConnectionRow, "last_sync_at"> | null,
  nowMs = Date.now(),
): number {
  const last = row?.last_sync_at ? Date.parse(row.last_sync_at) : NaN;
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, SHIPHERO_SYNC_COOLDOWN_MS - (nowMs - last));
}

const EMPTY_CHOICES: ShipHeroChoices = {
  warehouses: [],
  customers: [],
  customersTruncated: false,
};

const staticEnvConfigured = (env: Env) =>
  [
    "SHIPHERO_CR_ACCESS_TOKEN",
    "SHIPHERO_CR_ACCOUNT_ID",
    "SHIPHERO_CR_WAREHOUSE_ID",
  ].every((key) => Boolean(env[key]?.trim()));

function choicesOf(value: unknown): ShipHeroChoices {
  const raw =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rows = (entry: unknown) =>
    (Array.isArray(entry) ? entry : []).filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    );
  return {
    warehouses: rows(raw.warehouses)
      .filter((item) => typeof item.id === "string" && item.id)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name || item.id).slice(0, 200),
        active: item.active !== false,
      })),
    customers: rows(raw.customers)
      .filter((item) => typeof item.id === "string" && item.id)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name || item.id).slice(0, 200),
      })),
    customersTruncated: raw.customersTruncated === true,
  };
}

/** "boxful Costa Rica" twice → "boxful Costa Rica (132509)" and "(133649)". Only colliding names change. */
export function labelWarehouses<T extends { id: string; name: string }>(
  warehouses: T[],
): T[] {
  const norm = (name: string) => name.trim().toLowerCase();
  const seen = new Map<string, number>();
  for (const item of warehouses)
    seen.set(norm(item.name), (seen.get(norm(item.name)) ?? 0) + 1);
  return warehouses.map((item) =>
    (seen.get(norm(item.name)) ?? 0) > 1
      ? {
          ...item,
          name: `${item.name} (${shipheroLegacyId(item.id) ?? item.id.slice(-8)})`.slice(
            0,
            200,
          ),
        }
      : item,
  );
}

const activeCount = (choices: ShipHeroChoices) =>
  choices.warehouses.filter((item) => item.active).length;

export async function readConnectionRow(
  storeId: number,
): Promise<ConnectionRow | null> {
  const { data, error } = await getDB()
    .from(TABLE)
    .select(COLUMNS)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) throw new ShipHeroStorageError(isMissingRelation(error));
  return (data as ConnectionRow | null) ?? null;
}

async function updateRow(
  storeId: number,
  values: Record<string, unknown>,
  generation?: number,
): Promise<number> {
  let query = getDB()
    .from(TABLE)
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("store_id", storeId);
  if (generation !== undefined) query = query.eq("token_generation", generation);
  const { data, error } = await query.select("store_id");
  if (error) throw new ShipHeroStorageError(isMissingRelation(error));
  return Array.isArray(data) ? data.length : 0;
}

function stateOf(row: ConnectionRow | null): ShipHeroState {
  if (!row || (!row.connected_at && !row.refresh_token_enc))
    return "not_connected";
  if (row.state === "disconnected" || !row.refresh_token_enc)
    return "disconnected";
  return row.state;
}

/**
 * Status for the browser. The choices (other warehouses and, for a 3PL login,
 * other customers of the 3PL) only go to editors, and only while the
 * connection is usable; a chosen customer is cut down to itself.
 */
export function statusFromRow(
  row: ConnectionRow | null,
  env: Env = process.env,
  viewer: { canEdit?: boolean; now?: number } = {},
): ShipHeroStatus {
  const key = secretKeyStatus(env, SHIPHERO_KEY_VAR);
  const state = stateOf(row);
  const live = state !== "not_connected";
  const showChoices =
    viewer.canEdit === true && (state === "connected" || state === "needs_scope");
  const stored = choicesOf(row?.choices);
  const labeled = labelWarehouses(stored.warehouses);
  const choices = showChoices ? { ...stored, warehouses: labeled } : EMPTY_CHOICES;
  if (showChoices && row?.customer_account_id)
    choices.customers = choices.customers.filter(
      (item) => item.id === row.customer_account_id,
    );
  return {
    key: {
      configured: key === "ok",
      message:
        key === "ok" ? null : new SecretKeyError(key, SHIPHERO_KEY_VAR).message,
    },
    state,
    authMethod: live ? (row?.auth_method ?? null) : null,
    userEmail: live ? (row?.sh_user_email ?? null) : null,
    accountKind:
      live && row?.is_3pl != null ? (row.is_3pl ? "3pl" : "cuenta") : null,
    customer:
      live && row?.customer_account_id
        ? {
            id: row.customer_account_id,
            name: row.customer_name || row.customer_account_id,
          }
        : null,
    warehouse:
      live && row?.warehouse_id
        ? row.warehouse_id === SHIPHERO_ALL_WAREHOUSES
          ? {
              id: SHIPHERO_ALL_WAREHOUSES,
              name: SHIPHERO_ALL_WAREHOUSES_NAME,
              count: activeCount(stored),
            }
          : {
              id: row.warehouse_id,
              name:
                labeled.find((item) => item.id === row.warehouse_id)?.name ||
                row.warehouse_name ||
                row.warehouse_id,
            }
        : null,
    choices,
    connectedBy: row?.connected_by ? displayUploader(row.connected_by) : null,
    connectedAt: row?.connected_at ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
    lastSyncOkAt: row?.last_sync_ok_at ?? null,
    lastSyncRows: row?.last_sync_rows ?? null,
    incoming: row?.last_sync_incoming ?? null,
    lastError: row?.last_error ?? null,
    staticEnv: staticEnvConfigured(env),
    syncInMs: syncCooldownLeftMs(row, viewer.now),
  };
}

export async function readShipHeroStatus(
  storeId: number,
  env: Env = process.env,
  viewer: { canEdit?: boolean } = {},
): Promise<ShipHeroStatus> {
  return statusFromRow(await readConnectionRow(storeId), env, viewer);
}

/** Missing customer/warehouse choice (3PL needs a customer; several warehouses need one). */
function scopeComplete(
  is3pl: boolean,
  customerId: string | null,
  warehouseId: string | null,
  choices: ShipHeroChoices,
): boolean {
  if (is3pl && !customerId) return false;
  const active = choices.warehouses.filter((item) => item.active);
  return Boolean(warehouseId) || active.length <= 1;
}

export async function connectShipHero(
  storeId: number,
  input:
    | { mode: "password"; username: string; password: string }
    | { mode: "token"; refreshToken: string },
  by: string,
  deps: ShipHeroDeps & { env?: Env } = {},
): Promise<ShipHeroStatus> {
  const env = deps.env ?? process.env;
  // Before any ShipHero call: never log in and then fail to store the result.
  const key = loadSecretKey(env, SHIPHERO_KEY_VAR);
  const now = deps.now ? deps.now() : new Date();
  const tokens =
    input.mode === "password"
      ? await login(input.username, input.password, deps)
      : await refreshAccess(input.refreshToken, deps);
  const refreshToken =
    tokens.refreshToken ?? (input.mode === "token" ? input.refreshToken : null);
  if (!refreshToken) throw new ShipHeroError("unexpected");
  const account = await discoverAccount(tokens.accessToken, deps);

  const choices: ShipHeroChoices = {
    warehouses: account.warehouses.map((item) => ({
      id: item.id,
      name: item.name,
      active: item.active,
    })),
    customers: account.customers.map((item) => ({
      id: item.id,
      name: item.name,
    })),
    customersTruncated: account.customersTruncated,
  };
  // Never guess "Mireva" by name: one customer is auto-chosen, more ask.
  const customer =
    account.is3pl && account.customers.length === 1
      ? account.customers[0]
      : null;
  if (customer) choices.customers = [{ id: customer.id, name: customer.name }];
  const active = labelWarehouses(account.warehouses).filter(
    (item) => item.active,
  );
  const warehouse = active.length === 1 ? active[0] : null;
  const complete = scopeComplete(
    account.is3pl,
    customer?.id ?? null,
    warehouse?.id ?? null,
    choices,
  );

  const current = await readConnectionRow(storeId);
  const { error } = await getDB()
    .from(TABLE)
    .upsert(
      {
        store_id: storeId,
        state: complete ? "connected" : "needs_scope",
        auth_method: input.mode === "password" ? "password" : "refresh_token",
        refresh_token_enc: sealSecret(refreshToken, {
          ...key,
          aad: aad(storeId, "refresh"),
        }),
        access_token_enc: sealSecret(tokens.accessToken, {
          ...key,
          aad: aad(storeId, "access"),
        }),
        access_expires_at: tokens.expiresAt,
        token_generation: (current?.token_generation ?? 0) + 1,
        sh_user_email: account.email,
        sh_account_id: account.id.slice(0, 100),
        sh_account_legacy_id: account.legacyId,
        is_3pl: account.is3pl,
        customer_account_id: customer?.id.slice(0, 100) ?? null,
        customer_name: customer?.name ?? null,
        warehouse_id: warehouse?.id.slice(0, 100) ?? null,
        warehouse_name: warehouse?.name ?? null,
        choices,
        connected_by: by.slice(0, 200),
        connected_at: now.toISOString(),
        last_error:
          account.is3pl && !account.customers.length
            ? "Ese usuario es de Boxful y no tiene clientes en ShipHero."
            : null,
        last_error_at: null,
        // A new connection syncs at once (no cooldown from the previous one).
        // The lease is left alone: a running sync keeps it until it ends, and
        // the new token_generation stops it from saving anything.
        last_sync_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: "store_id" },
    );
  // ShipHero has no revoke endpoint: on a failed write the tokens are simply dropped.
  if (error) throw new ShipHeroStorageError(isMissingRelation(error));
  return readShipHeroStatus(storeId, env, { canEdit: true });
}

export async function chooseShipHeroScope(
  storeId: number,
  input: { customerAccountId?: string | null; warehouseId?: string | null },
  by: string,
  env: Env = process.env,
): Promise<ShipHeroStatus> {
  const row = await readConnectionRow(storeId);
  const state = stateOf(row);
  if (!row || (state !== "connected" && state !== "needs_scope"))
    throw new ShipHeroChoiceError("Primero conecta ShipHero.");
  const choices = choicesOf(row.choices);
  const values: Record<string, unknown> = {};
  let customerId = row.customer_account_id;
  let warehouseId = row.warehouse_id;
  if (
    input.customerAccountId !== undefined &&
    input.customerAccountId !== row.customer_account_id
  ) {
    if (!row.is_3pl) throw new ShipHeroChoiceError();
    // A 3PL login sees every customer of the 3PL: once one is chosen it is
    // locked, and only a new connection (with credentials) can change it.
    if (row.customer_account_id)
      throw new ShipHeroChoiceError(
        "Para cambiar de cliente, vuelve a conectar ShipHero.",
      );
    const found = choices.customers.find(
      (item) => item.id === input.customerAccountId,
    );
    if (!found) throw new ShipHeroChoiceError();
    customerId = found.id;
    values.customer_account_id = found.id;
    values.customer_name = found.name;
    // The other customers are not kept: they are other brands of the 3PL.
    values.choices = {
      ...choices,
      customers: [found],
      customersTruncated: false,
    };
  }
  if (input.warehouseId !== undefined) {
    if (input.warehouseId === null) {
      warehouseId = null;
      values.warehouse_id = null;
      values.warehouse_name = null;
    } else if (input.warehouseId === SHIPHERO_ALL_WAREHOUSES) {
      // Explicit opt-in: the stock of every warehouse of the account is summed.
      if (activeCount(choices) < 2)
        throw new ShipHeroChoiceError(
          "«Todos los almacenes» solo está disponible con dos o más almacenes activos.",
        );
      warehouseId = SHIPHERO_ALL_WAREHOUSES;
      values.warehouse_id = SHIPHERO_ALL_WAREHOUSES;
      values.warehouse_name = SHIPHERO_ALL_WAREHOUSES_NAME;
    } else {
      const found = labelWarehouses(choices.warehouses).find(
        (item) => item.id === input.warehouseId,
      );
      if (!found) throw new ShipHeroChoiceError();
      warehouseId = found.id;
      values.warehouse_id = found.id;
      values.warehouse_name = found.name;
    }
  }
  const complete = scopeComplete(
    Boolean(row.is_3pl),
    customerId,
    warehouseId,
    choices,
  );
  const scopeChanged =
    customerId !== row.customer_account_id || warehouseId !== row.warehouse_id;
  const changed = await updateRow(
    storeId,
    {
      ...values,
      state: complete ? "connected" : "needs_scope",
      last_error: null,
      last_error_at: null,
      connected_by: by.slice(0, 200),
      ...(scopeChanged
        ? {
            // A sync still reading the old scope can no longer save it, and
            // the new scope syncs at once (no cooldown).
            token_generation: row.token_generation + 1,
            last_sync_at: null,
          }
        : {}),
    },
    row.token_generation,
  );
  if (!changed) throw new ShipHeroChoiceError("La conexión cambió. Vuelve a cargar.");
  return readShipHeroStatus(storeId, env, { canEdit: true });
}

/**
 * UPDATE, not delete: drops the saved access and the discovered choices; the
 * row and every snapshot stay. A running sync keeps its lease until it ends,
 * and the new token_generation stops it from saving.
 */
export async function disconnectShipHero(
  storeId: number,
  by: string,
  env: Env = process.env,
): Promise<ShipHeroStatus> {
  const row = await readConnectionRow(storeId);
  if (row)
    await updateRow(storeId, {
      refresh_token_enc: null,
      access_token_enc: null,
      access_expires_at: null,
      state: "disconnected",
      token_generation: (row.token_generation ?? 0) + 1,
      choices: EMPTY_CHOICES,
      disconnected_by: by.slice(0, 200),
      disconnected_at: new Date().toISOString(),
    });
  return readShipHeroStatus(storeId, env, { canEdit: true });
}

/**
 * A usable access token: the cached one while it has more than 3 days left,
 * otherwise a refresh (persisted only if no connect/disconnect happened since).
 */
export async function getValidAccessToken(
  conn: ConnectionRow,
  deps: ShipHeroDeps & { env: Env; force?: boolean },
): Promise<{ token: string; conn: ConnectionRow }> {
  const storeId = conn.store_id;
  const opts = (column: "refresh" | "access") => ({
    env: deps.env,
    varName: SHIPHERO_KEY_VAR,
    aad: aad(storeId, column),
  });
  const now = deps.now ? deps.now().getTime() : Date.now();
  if (!conn.refresh_token_enc) throw new ShipHeroError("reconnect");
  // An early refresh (the cached token still works) that fails keeps the cached token.
  const cachedStillValid =
    !deps.force &&
    Boolean(conn.access_token_enc) &&
    Boolean(conn.access_expires_at) &&
    Date.parse(conn.access_expires_at!) > now;
  try {
    if (
      !deps.force &&
      conn.access_token_enc &&
      conn.access_expires_at &&
      Date.parse(conn.access_expires_at) - now > REFRESH_MARGIN_MS
    )
      return {
        token: openSecret(conn.access_token_enc, opts("access")),
        conn,
      };
    const refreshToken = openSecret(conn.refresh_token_enc, opts("refresh"));
    const tokens = await refreshAccess(refreshToken, deps);
    const key = loadSecretKey(deps.env, SHIPHERO_KEY_VAR);
    const values: Record<string, unknown> = {
      access_token_enc: sealSecret(tokens.accessToken, {
        ...key,
        aad: aad(storeId, "access"),
      }),
      access_expires_at: tokens.expiresAt,
    };
    // A rotated refresh token is stored; one sealed with the previous key is resealed.
    if (
      tokens.refreshToken ||
      !sealedWithCurrentKey(conn.refresh_token_enc, deps.env, SHIPHERO_KEY_VAR)
    )
      values.refresh_token_enc = sealSecret(tokens.refreshToken ?? refreshToken, {
        ...key,
        aad: aad(storeId, "refresh"),
      });
    const changed = await updateRow(storeId, values, conn.token_generation);
    if (!changed) throw new Superseded();
    return {
      token: tokens.accessToken,
      conn: {
        ...conn,
        access_token_enc: values.access_token_enc as string,
        access_expires_at: tokens.expiresAt,
        refresh_token_enc:
          (values.refresh_token_enc as string | undefined) ??
          conn.refresh_token_enc,
      },
    };
  } catch (error) {
    if (cachedStillValid && error instanceof ShipHeroError) {
      let cached: string | null = null;
      try {
        cached = openSecret(conn.access_token_enc!, opts("access"));
      } catch {
        cached = null;
      }
      if (cached) {
        // Only the code: never the body or the token.
        console.warn("shiphero early refresh failed", error.code);
        return { token: cached, conn };
      }
    }
    if (error instanceof ShipHeroError && error.code === "reconnect") {
      // Keep refresh_token_enc: ShipHero has intermittent 401s, the next run tries again.
      await updateRow(
        storeId,
        {
          state: "reconnect",
          access_token_enc: null,
          access_expires_at: null,
          last_error: SHIPHERO_MESSAGES.reconnect,
          last_error_at: new Date().toISOString(),
        },
        conn.token_generation,
      ).catch(() => 0);
    } else if (error instanceof SecretKeyError && error.reason === "changed") {
      await updateRow(
        storeId,
        {
          state: "reconnect",
          last_error: error.message.slice(0, 300),
          last_error_at: new Date().toISOString(),
        },
        conn.token_generation,
      ).catch(() => 0);
    }
    throw error;
  }
}

export interface ShipHeroSyncResult {
  ok: boolean;
  /** cambio = the connection or its scope changed during the read: nothing saved. */
  skipped?: "sin_conexion" | "ocupado" | "sin_clave" | "falta_elegir" | "cambio";
  rows?: number;
  snapshotDate?: string;
  incoming?: boolean;
  complexity?: number | null;
  creditsRemaining?: number | null;
  /** Spanish, short, from SHIPHERO_MESSAGES (never provider text). */
  error?: string;
  note?: string;
}

type Catalog = Array<{ key: string; sku: string; name: string }>;

/** Catalog started earlier (in parallel with ShipHero); waits at most `waitMs`. */
async function unmatchedCount(
  items: Array<{ sku: string; name?: string }>,
  catalog: Promise<Catalog | null> | null,
  waitMs: number,
): Promise<number> {
  if (!catalog || waitMs <= 0) return 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const list = await Promise.race([
    catalog,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs);
    }),
  ]).finally(() => clearTimeout(timer));
  return list ? matchInventoryToCatalog(items, list).unmatched.length : 0;
}

function syncErrorMessage(error: unknown): string {
  if (error instanceof ShipHeroError) return SHIPHERO_MESSAGES[error.code];
  if (error instanceof SecretKeyError) return error.message;
  if (error instanceof InventoryStorageError) return error.message;
  if (error instanceof ShipHeroStorageError) return error.message;
  // Never error.message of anything else: it may carry provider or DB detail.
  return SHIPHERO_MESSAGES.unexpected;
}

/**
 * Reads the whole ShipHero inventory of the connection and saves today's
 * snapshot. One run at a time (DB lease). Never saves a partial snapshot.
 */
export async function syncShipHeroInventory(
  storeId: number,
  opts: {
    by: string;
    /** Epoch ms: no ShipHero request runs past it (SHIPHERO_SYNC_BUDGET_MS from the start). */
    deadline: number;
  } & ShipHeroDeps & {
      env?: Env;
      /** Sales catalog, only to count SKUs without a product (10 s max). */
      catalog?: () => Promise<Catalog | null>;
    },
): Promise<ShipHeroSyncResult> {
  const env = opts.env ?? process.env;
  const now = () => (opts.now ? opts.now() : new Date());
  let row: ConnectionRow | null;
  try {
    row = await readConnectionRow(storeId);
  } catch (error) {
    if (error instanceof ShipHeroStorageError && error.pendingMigration)
      return { ok: true, skipped: "sin_conexion", note: error.message };
    return { ok: false, error: syncErrorMessage(error) };
  }
  if (!row || row.state === "disconnected" || !row.refresh_token_enc)
    return { ok: true, skipped: "sin_conexion" };
  const keyStatus = secretKeyStatus(env, SHIPHERO_KEY_VAR);
  if (keyStatus !== "ok") {
    const message = new SecretKeyError(keyStatus, SHIPHERO_KEY_VAR).message;
    await updateRow(storeId, {
      last_error: message.slice(0, 300),
      last_error_at: now().toISOString(),
    }).catch(() => 0);
    return { ok: false, skipped: "sin_clave", error: message };
  }
  if (row.state === "needs_scope") return { ok: true, skipped: "falta_elegir" };

  const { data: lease, error: leaseError } = await getDB().rpc(
    "marketing_shiphero_lease",
    { p_store: storeId, p_seconds: LEASE_SECONDS },
  );
  if (leaseError)
    return {
      ok: false,
      error: new ShipHeroStorageError(isMissingRelation(leaseError)).message,
    };
  if (typeof lease !== "string" || !lease)
    return { ok: true, skipped: "ocupado" };

  const deps: ShipHeroDeps = {
    fetcher: opts.fetcher,
    now: opts.now,
    sleep: opts.sleep,
    signal: opts.signal,
    deadline: opts.deadline,
  };
  const generation = row.token_generation;
  // Started now, in parallel with ShipHero; awaited with a capped wait.
  const catalog = opts.catalog ? opts.catalog().catch(() => null) : null;
  let complexity: number | null = null;
  let creditsRemaining: number | null = null;
  try {
    let conn = row;
    const first = await getValidAccessToken(conn, { ...deps, env });
    conn = first.conn;
    const auth: ShipHeroAuth = {
      token: first.token,
      renew: async () => {
        const renewed = await getValidAccessToken(conn, {
          ...deps,
          env,
          force: true,
        });
        conn = renewed.conn;
        return renewed.token;
      },
    };
    const allWarehouses = conn.warehouse_id === SHIPHERO_ALL_WAREHOUSES;
    // Deactivated warehouses are not summed: the total matches the count shown.
    const excludeWarehouseIds = allWarehouses
      ? choicesOf(conn.choices)
          .warehouses.filter((item) => !item.active)
          .map((item) => item.id)
      : [];
    const scope: ShipHeroScope = {
      is3pl: Boolean(conn.is_3pl),
      accountId: conn.sh_account_id ?? "",
      accountLegacyId: conn.sh_account_legacy_id,
      customerAccountId: conn.customer_account_id,
      // «Todos los almacenes»: no warehouse filter, rows summed per SKU.
      warehouseId: allWarehouses ? null : conn.warehouse_id,
      allWarehouses,
      ...(excludeWarehouseIds.length ? { excludeWarehouseIds } : {}),
    };
    const rows = await readWarehouseProducts(auth, scope, deps, (page) => {
      if (page.complexity != null)
        complexity = (complexity ?? 0) + page.complexity;
      if (page.creditsRemaining != null)
        creditsRemaining = page.creditsRemaining;
    });
    const incoming = await readIncoming(auth, scope, {
      ...deps,
      since: shiftDate(marketingDate(now()), -SHIPHERO_INCOMING_DAYS),
    }).catch(() => null);
    const incomingComplete = Boolean(incoming?.complete);
    const items = aggregateShipHeroStock(
      rows,
      incomingComplete ? incoming!.bySku : null,
    );
    const unmatched = await unmatchedCount(
      items,
      catalog,
      Math.min(CATALOG_TIMEOUT_MS, opts.deadline + CATALOG_GRACE_MS - Date.now()),
    );
    const snapshotDate = marketingDate(now());
    const saved = await saveShipHeroSnapshot(storeId, {
      snapshotDate,
      items,
      incomingComplete,
      warehouseName: conn.warehouse_name,
      unmatched,
      uploadedBy: opts.by,
      // The database re-checks both inside the save: a connect, disconnect or
      // scope change during the read wins and nothing is saved.
      generation,
      scopeKey: shipheroScopeKey(row),
    });
    if (!saved.id)
      return {
        ok: true,
        skipped: "cambio",
        note: "La conexión cambió durante la lectura. No se guardó nada.",
        complexity,
        creditsRemaining,
      };
    const at = now().toISOString();
    await updateRow(
      storeId,
      {
        last_sync_at: at,
        last_sync_ok_at: at,
        last_sync_rows: items.length,
        last_sync_incoming: incomingComplete,
        last_error: null,
        last_error_at: null,
        ...(conn.state === "reconnect" ? { state: "connected" } : {}),
      },
      generation,
    ).catch(() => 0);
    return {
      ok: true,
      rows: items.length,
      snapshotDate,
      incoming: incomingComplete,
      complexity,
      creditsRemaining,
    };
  } catch (error) {
    if (error instanceof Superseded) return { ok: true, skipped: "ocupado" };
    const message = syncErrorMessage(error).slice(0, 300);
    const at = now().toISOString();
    const values: Record<string, unknown> = {
      last_sync_at: at,
      last_error: message,
      last_error_at: at,
    };
    if (error instanceof ShipHeroError && error.code === "needs_scope") {
      const choices = choicesOf(row.choices);
      for (const found of error.warehouses ?? [])
        if (!choices.warehouses.some((item) => item.id === found.id))
          choices.warehouses.push({ ...found, active: true });
      values.choices = choices;
      values.state = "needs_scope";
      // «Todos los almacenes» is offered (and accepted) only with 2+ active.
      values.last_error =
        activeCount(choices) >= 2
          ? "Hay más de un almacén. Elige cuál leer o «Todos los almacenes»."
          : "Hay más de un almacén. Elige cuál leer.";
    }
    if (error instanceof ShipHeroError && error.code === "reconnect") {
      values.state = "reconnect";
      values.access_token_enc = null;
      values.access_expires_at = null;
    }
    await updateRow(storeId, values, generation).catch(() => 0);
    if (error instanceof ShipHeroError && error.code === "needs_scope")
      return {
        ok: true,
        skipped: "falta_elegir",
        error: values.last_error as string,
        complexity,
        creditsRemaining,
      };
    return { ok: false, error: message, complexity, creditsRemaining };
  } finally {
    await getDB()
      .rpc("marketing_shiphero_release", { p_store: storeId, p_token: lease })
      .then(
        () => undefined,
        () => undefined,
      );
  }
}

const shortDate = (date: string) =>
  new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(".", "");

/**
 * For the sources route: the saved ShipHero snapshot of the current scope as a
 * MarketingSource, or null when there is no usable connection (none, or
 * disconnected: then SHIPHERO_CR_* or the CSV are used, as before). Snapshots
 * of another account, customer or warehouse are never served.
 */
export async function readShipHeroInventory(
  storeId: number,
): Promise<MarketingSource<MarketingInventory> | null> {
  let row: ConnectionRow | null;
  try {
    row = await readConnectionRow(storeId);
  } catch {
    return null;
  }
  const state = stateOf(row);
  if (!row || state === "not_connected" || state === "disconnected") return null;
  const pending = (message: string): MarketingSource<MarketingInventory> => ({
    status: "pending",
    checkedAt: new Date().toISOString(),
    message,
    data: null,
    connection: state,
  });
  if (state === "needs_scope")
    return pending("ShipHero conectado. Falta elegir qué inventario leer.");
  const { latest, previous } = await readInventorySnapshots(storeId, {
    source: "shiphero",
    scopeKey: shipheroScopeKey(row),
  });
  if (!latest)
    return pending(
      state === "reconnect"
        ? "ShipHero pide volver a conectar. Todavía no hay inventario guardado."
        : "ShipHero conectado. Falta la primera sincronización.",
    );
  const uploadedBy =
    latest.uploadedBy === "cron" ? "ShipHero (automático)" : latest.uploadedBy;
  return {
    status: "ready",
    checkedAt: latest.uploadedAt,
    message: `Inventario de ShipHero del ${shortDate(latest.snapshotDate)}, ${timeCrText(latest.uploadedAt)}.${state === "reconnect" ? " ShipHero pide volver a conectar." : ""}`,
    connection: state,
    data: {
      stock: latest.stock,
      origin: "shiphero",
      snapshotDate: latest.snapshotDate,
      uploadedAt: latest.uploadedAt,
      uploadedBy,
      previous: previous
        ? { snapshotDate: previous.snapshotDate, stock: previous.stock }
        : null,
      columns: {
        backorder: Boolean(latest.backorderColumn),
        incoming: Boolean(latest.incomingColumn),
      },
    },
  };
}
