import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("./helpers/shiphero-fake-db");
  return { getDB: () => fakeDb.db };
});

import {
  baseRow,
  fakeDb,
  jsonResponse,
  shipheroFetcher,
} from "./helpers/shiphero-fake-db";
import { loadSecretKey, openSecret, sealSecret } from "../lib/secret-box";
import { SHIPHERO_MESSAGES } from "../lib/shiphero-client";
import {
  chooseShipHeroScope,
  connectShipHero,
  disconnectShipHero,
  getValidAccessToken,
  readShipHeroInventory,
  statusFromRow,
  syncShipHeroInventory,
  type ConnectionRow,
} from "../lib/shiphero-connection";

const VAR = "SHIPHERO_TOKEN_KEY";
const env = { [VAR]: Buffer.alloc(32, 3).toString("base64") };
const key = loadSecretKey(env, VAR);
const b64 = (value: string) => Buffer.from(value).toString("base64");
const ACCOUNT = b64("Account:42");
const CUSTOMER = b64("Account:77");
const WAREHOUSE = b64("Warehouse:11790");
const PASSWORD = "pw-Secreta-123";
const ACCESS = "access-token-0123456789-abcdef";
const NEW_ACCESS = "access-token-renewed-0123456789";
const REFRESH = "refresh-token-0123456789";
const NOW = new Date("2026-11-06T16:00:00Z"); // 10:00 in Costa Rica
const seal = (value: string, column: "refresh" | "access") =>
  sealSecret(value, { ...key, aad: `shiphero:1:${column}` });

const tokens = () =>
  jsonResponse({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 2419200 });
const account = (over: Record<string, unknown> = {}) =>
  jsonResponse({
    data: {
      account: {
        data: {
          id: ACCOUNT,
          legacy_id: 42,
          email: "ana@mireva.cr",
          is_3pl: false,
          warehouses: [{ id: WAREHOUSE, legacy_id: 11790, identifier: "Costa Rica", active: true }],
          ...over,
        },
      },
    },
  });
const stockPage = (accountId = ACCOUNT) =>
  jsonResponse({
    data: {
      warehouse_products: {
        complexity: 101,
        data: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                id: "wp1", sku: "SKU1", account_id: accountId, warehouse_id: WAREHOUSE,
                warehouse_identifier: "Costa Rica", on_hand: 5, available: 4, allocated: 1,
                backorder: 0, product: { name: "Uno" },
              },
            },
          ],
        },
      },
    },
    extensions: { throttling: { user_quota: { credits_remaining: 3800 } } },
  });
const poError = () => jsonResponse({ errors: [{ message: "Unknown argument created_from" }] });

const connectedRow = (over: Partial<ConnectionRow> = {}) =>
  baseRow({
    refresh_token_enc: seal(REFRESH, "refresh"),
    access_token_enc: seal(ACCESS, "access"),
    access_expires_at: new Date(NOW.getTime() + 20 * 86_400_000).toISOString(),
    warehouse_id: WAREHOUSE,
    warehouse_name: "Costa Rica",
    choices: { warehouses: [{ id: WAREHOUSE, name: "Costa Rica", active: true }], customers: [] },
    ...over,
  });

const everyArgument = () => JSON.stringify(fakeDb.state.calls);

beforeEach(() => {
  fakeDb.reset();
});
afterEach(() => vi.restoreAllMocks());

describe("connectShipHero", () => {
  it("fails before any ShipHero call when the key is missing", async () => {
    const fetcher = vi.fn();
    await expect(
      connectShipHero(1, { mode: "password", username: "ana@mireva.cr", password: PASSWORD }, "7:Ana", { env: {}, fetcher }),
    ).rejects.toThrow("Pendiente: configurar SHIPHERO_TOKEN_KEY.");
    expect(fetcher).not.toHaveBeenCalled();
    expect(fakeDb.state.calls).toEqual([]);
  });

  it("stores only sealed tokens (never the password) and auto-picks the single warehouse", async () => {
    fakeDb.state.row = baseRow({ token_generation: 4, state: "disconnected", refresh_token_enc: null });
    const fetcher = vi.fn(shipheroFetcher({ token: tokens, graphql: () => account() }));
    const status = await connectShipHero(
      1,
      { mode: "password", username: "ana@mireva.cr", password: PASSWORD },
      "7:Ana",
      { env, fetcher, now: () => NOW },
    );
    const upsert = fakeDb.state.calls.find((call) => call.op === "upsert")!.args[0] as Record<string, unknown>;
    expect(String(upsert.refresh_token_enc)).toMatch(/^v1\./);
    expect(String(upsert.access_token_enc)).toMatch(/^v1\./);
    expect(everyArgument()).not.toContain(REFRESH);
    expect(everyArgument()).not.toContain(ACCESS);
    expect(everyArgument()).not.toContain(PASSWORD);
    expect(openSecret(String(upsert.refresh_token_enc), { env, varName: VAR, aad: "shiphero:1:refresh" })).toBe(REFRESH);
    expect(upsert).toMatchObject({
      auth_method: "password",
      connected_by: "7:Ana",
      token_generation: 5,
      state: "connected",
      warehouse_id: WAREHOUSE,
      is_3pl: false,
      customer_account_id: null,
    });
    // Only the /auth/token call carries the password.
    const withPassword = fetcher.mock.calls.filter((call) => String(call[1]?.body).includes(PASSWORD));
    expect(withPassword).toHaveLength(1);
    expect(String(withPassword[0][0])).toMatch(/\/auth\/token$/);
    expect(status).toMatchObject({ state: "connected", accountKind: "cuenta", warehouse: { id: WAREHOUSE, name: "Costa Rica" } });
    expect(JSON.stringify(status)).not.toContain("v1.");
  });

  it("3PL user: one customer is chosen, several ask (never guessed by name)", async () => {
    const customers = (list: Array<{ id: string; username: string }>) =>
      jsonResponse({ data: { account: { data: { customers: { pageInfo: { hasNextPage: false }, edges: list.map((node) => ({ node })) } } } } });
    const one = vi.fn(
      shipheroFetcher({
        token: tokens,
        graphql: (body) => (body.query.includes("customers") ? customers([{ id: CUSTOMER, username: "Mireva" }]) : account({ is_3pl: true })),
      }),
    );
    const auto = await connectShipHero(1, { mode: "password", username: "boxful@x.com", password: PASSWORD }, "7:Ana", { env, fetcher: one });
    expect(auto).toMatchObject({ state: "connected", accountKind: "3pl", customer: { id: CUSTOMER, name: "Mireva" } });

    fakeDb.reset();
    const many = vi.fn(
      shipheroFetcher({
        token: tokens,
        graphql: (body) =>
          body.query.includes("customers")
            ? customers([{ id: CUSTOMER, username: "Mireva Costa Rica" }, { id: "c2", username: "Otra marca" }])
            : account({ is_3pl: true }),
      }),
    );
    const ask = await connectShipHero(1, { mode: "password", username: "boxful@x.com", password: PASSWORD }, "7:Ana", { env, fetcher: many });
    expect(ask.state).toBe("needs_scope");
    expect(ask.customer).toBeNull();
    expect(ask.choices.customers.map((c) => c.name)).toEqual(["Mireva Costa Rica", "Otra marca"]);

    await expect(chooseShipHeroScope(1, { customerAccountId: "not-listed" }, "7:Ana", env)).rejects.toThrow("ya no está disponible");
    const chosen = await chooseShipHeroScope(1, { customerAccountId: CUSTOMER }, "7:Ana", env);
    expect(chosen).toMatchObject({ state: "connected", customer: { id: CUSTOMER } });
    // The other brands of the 3PL are not kept once the customer is chosen.
    expect(chosen.choices.customers).toEqual([{ id: CUSTOMER, name: "Mireva Costa Rica" }]);
    expect(JSON.stringify(fakeDb.state.row!.choices)).not.toContain("Otra marca");
    // Locked: another customer needs a new connection (with credentials).
    await expect(chooseShipHeroScope(1, { customerAccountId: "c2" }, "7:Ana", env)).rejects.toThrow(
      "Para cambiar de cliente, vuelve a conectar ShipHero.",
    );
    expect(fakeDb.state.row!.customer_account_id).toBe(CUSTOMER);
  });

  it("3PL choices go only to editors, never with e-mails, and are dropped on disconnect", async () => {
    const customers = jsonResponse({
      data: { account: { data: { customers: { pageInfo: { hasNextPage: false }, edges: [
        { node: { id: CUSTOMER, username: "Mireva Costa Rica", email: "ops@mireva.cr" } },
        { node: { id: "c2", email: "dueña@otra-marca.com" } },
      ] } } } },
    });
    const fetcher = vi.fn(
      shipheroFetcher({ token: tokens, graphql: (body) => (body.query.includes("customers") ? customers : account({ is_3pl: true })) }),
    );
    const editor = await connectShipHero(1, { mode: "password", username: "boxful@x.com", password: PASSWORD }, "7:Ana", { env, fetcher });
    expect(editor.choices.customers).toEqual([
      { id: CUSTOMER, name: "Mireva Costa Rica" },
      { id: "c2", name: "c2" },
    ]);
    expect(everyArgument()).not.toContain("otra-marca.com");
    const viewer = statusFromRow(fakeDb.state.row, env);
    expect(viewer.state).toBe("needs_scope");
    expect(viewer.choices).toEqual({ warehouses: [], customers: [], customersTruncated: false });
    expect(statusFromRow(fakeDb.state.row, env, { canEdit: true }).choices.customers).toHaveLength(2);

    const off = await disconnectShipHero(1, "7:Ana", env);
    expect(off.choices.customers).toEqual([]);
    expect(fakeDb.state.row!.choices).toEqual({ warehouses: [], customers: [], customersTruncated: false });
  });

  it("connect and disconnect leave a running sync's lease alone", async () => {
    const fetcher = vi.fn(shipheroFetcher({ token: tokens, graphql: () => account() }));
    await connectShipHero(1, { mode: "password", username: "ana@mireva.cr", password: PASSWORD }, "7:Ana", { env, fetcher });
    const upsert = fakeDb.state.calls.find((call) => call.op === "upsert")!.args[0] as Record<string, unknown>;
    expect(upsert).not.toHaveProperty("lease_token");
    expect(upsert).not.toHaveProperty("lease_until");
    expect(upsert.last_sync_at).toBeNull();
    await disconnectShipHero(1, "7:Ana", env);
    const update = fakeDb.state.calls.filter((call) => call.op === "update").at(-1)!.args[0] as Record<string, unknown>;
    expect(update).not.toHaveProperty("lease_token");
    expect(update).not.toHaveProperty("lease_until");
  });

  it("a warehouse change bumps the generation and clears the sync wait", async () => {
    const OTHER = b64("Warehouse:555");
    fakeDb.state.row = connectedRow({
      token_generation: 3,
      last_sync_at: NOW.toISOString(),
      choices: { warehouses: [{ id: WAREHOUSE, name: "Costa Rica", active: true }, { id: OTHER, name: "GT", active: true }], customers: [] },
    });
    const status = await chooseShipHeroScope(1, { warehouseId: OTHER }, "7:Ana", env);
    expect(status).toMatchObject({ state: "connected", warehouse: { id: OTHER }, syncInMs: 0 });
    expect(fakeDb.state.row).toMatchObject({ token_generation: 4, last_sync_at: null });
    // Same choice again: nothing to invalidate.
    await chooseShipHeroScope(1, { warehouseId: OTHER }, "7:Ana", env);
    expect(fakeDb.state.row!.token_generation).toBe(4);
  });

  it("accepts a developer refresh token and keeps it when ShipHero does not rotate it", async () => {
    const fetcher = vi.fn(
      shipheroFetcher({
        refresh: () => jsonResponse({ access_token: ACCESS, expires_in: 2419200 }),
        graphql: () => account(),
      }),
    );
    const status = await connectShipHero(1, { mode: "token", refreshToken: REFRESH }, "7:Ana", { env, fetcher });
    expect(status.authMethod).toBe("refresh_token");
    const upsert = fakeDb.state.calls.find((call) => call.op === "upsert")!.args[0] as Record<string, unknown>;
    expect(openSecret(String(upsert.refresh_token_enc), { env, varName: VAR, aad: "shiphero:1:refresh" })).toBe(REFRESH);
  });
});

describe("getValidAccessToken", () => {
  it("an early refresh that fails keeps the cached token, which still works", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const failure of [
      () => jsonResponse({ message: "Unauthorized" }, 401),
      () => jsonResponse({}, 503),
      () => jsonResponse({}, 429),
    ]) {
      fakeDb.reset();
      const conn = connectedRow({ access_expires_at: new Date(NOW.getTime() + 86_400_000).toISOString() });
      fakeDb.state.row = { ...conn };
      const fetcher = vi.fn(shipheroFetcher({ refresh: failure }));
      const result = await getValidAccessToken(conn, { env, fetcher, now: () => NOW, sleep: async () => {} });
      expect(result.token).toBe(ACCESS);
      expect(fakeDb.state.row).toMatchObject({ state: "connected", access_token_enc: conn.access_token_enc });
    }
    // Forced (GraphQL said the token expired): no fallback.
    const conn = connectedRow({ access_expires_at: new Date(NOW.getTime() + 86_400_000).toISOString() });
    fakeDb.state.row = { ...conn };
    const fetcher = vi.fn(shipheroFetcher({ refresh: () => jsonResponse({ message: "Unauthorized" }, 401) }));
    await expect(getValidAccessToken(conn, { env, fetcher, now: () => NOW, force: true })).rejects.toMatchObject({ code: "reconnect" });
    expect(fakeDb.state.row!.state).toBe("reconnect");
  });

  it("uses a cached token with more than 3 days left without calling ShipHero", async () => {
    const fetcher = vi.fn();
    const conn = connectedRow();
    fakeDb.state.row = conn;
    const result = await getValidAccessToken(conn, { env, fetcher, now: () => NOW });
    expect(result.token).toBe(ACCESS);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refreshes near expiry and persists only if the generation is unchanged", async () => {
    const conn = connectedRow({ access_expires_at: new Date(NOW.getTime() + 86_400_000).toISOString() });
    fakeDb.state.row = { ...conn };
    const fetcher = vi.fn(shipheroFetcher({ refresh: () => jsonResponse({ access_token: NEW_ACCESS, expires_in: 2419200 }) }));
    const result = await getValidAccessToken(conn, { env, fetcher, now: () => NOW });
    expect(result.token).toBe(NEW_ACCESS);
    const update = fakeDb.state.calls.find((call) => call.op === "update")!;
    expect(String((update.args[0] as Record<string, unknown>).access_token_enc)).toMatch(/^v1\./);
    expect(fakeDb.state.row!.access_expires_at).toBe(new Date(NOW.getTime() + 28 * 86_400_000).toISOString());
    expect(everyArgument()).not.toContain(NEW_ACCESS);
  });

  it("a refresh 401 marks reconnect but keeps the refresh token for the next run", async () => {
    const conn = connectedRow({ access_token_enc: null });
    fakeDb.state.row = { ...conn };
    const fetcher = vi.fn(shipheroFetcher({ refresh: () => jsonResponse({ message: "Unauthorized" }, 401) }));
    await expect(getValidAccessToken(conn, { env, fetcher })).rejects.toMatchObject({ code: "reconnect" });
    expect(fakeDb.state.row).toMatchObject({
      state: "reconnect",
      access_token_enc: null,
      refresh_token_enc: conn.refresh_token_enc,
      last_error: SHIPHERO_MESSAGES.reconnect,
    });
  });
});

describe("syncShipHeroInventory", () => {
  const deadline = () => Date.now() + 50_000;

  it("does nothing without a connection", async () => {
    const fetcher = vi.fn();
    expect(await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher })).toEqual({ ok: true, skipped: "sin_conexion" });
    fakeDb.state.row = connectedRow({ state: "disconnected", refresh_token_enc: null });
    expect((await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher })).skipped).toBe("sin_conexion");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says the key is pending (and writes it as last_error) when it is missing", async () => {
    fakeDb.state.row = connectedRow();
    const result = await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env: {}, fetcher: vi.fn() });
    expect(result).toEqual({ ok: false, skipped: "sin_clave", error: "Pendiente: configurar SHIPHERO_TOKEN_KEY." });
    expect(fakeDb.state.row!.last_error).toBe("Pendiente: configurar SHIPHERO_TOKEN_KEY.");
  });

  it("skips while another run holds the lease, without calling ShipHero", async () => {
    fakeDb.state.row = connectedRow();
    fakeDb.state.rpc.set("marketing_shiphero_lease", () => ({ data: null, error: null }));
    const fetcher = vi.fn();
    expect(await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher })).toEqual({ ok: true, skipped: "ocupado" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refreshes once on an expired token, saves today's CR snapshot and releases the lease", async () => {
    fakeDb.state.row = connectedRow();
    let stockCalls = 0;
    const fetcher = vi.fn(
      shipheroFetcher({
        refresh: () => jsonResponse({ access_token: NEW_ACCESS, expires_in: 2419200 }),
        graphql: (body) => {
          if (body.query.includes("purchase_orders")) return poError();
          stockCalls++;
          return stockCalls === 1 ? jsonResponse({ message: "Token is expired" }, 401) : stockPage();
        },
      }),
    );
    const result = await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher, now: () => NOW });
    expect(result).toMatchObject({ ok: true, rows: 1, snapshotDate: "2026-11-06", incoming: false, complexity: 101, creditsRemaining: 3800 });
    const save = fakeDb.state.calls.find((call) => call.op === "marketing_replace_shiphero_snapshot")!.args[0] as Record<string, any>;
    expect(save.p_date).toBe("2026-11-06");
    expect(save.p_meta).toMatchObject({ incoming_column: "", backorder_column: "backorder", uploaded_by: "cron", file_name: "ShipHero · Costa Rica" });
    expect(save.p_items).toEqual([
      { sku: "SKU1", name: "Uno", warehouses: ["Costa Rica"], available: 4, on_hand: 5, allocated: 1, backorder: 0, incoming: null },
    ]);
    expect(fakeDb.state.calls.some((call) => call.op === "marketing_shiphero_release")).toBe(true);
    expect(fakeDb.state.row).toMatchObject({ last_sync_rows: 1, last_sync_incoming: false, last_error: null });
    expect(fakeDb.state.calls.some((call) => call.op === "delete")).toBe(false);
    expect(everyArgument()).not.toContain(NEW_ACCESS);
  });

  it("a second expired token gives reconnect, saves nothing and still releases the lease", async () => {
    fakeDb.state.row = connectedRow();
    const fetcher = vi.fn(
      shipheroFetcher({
        refresh: () => jsonResponse({ access_token: NEW_ACCESS, expires_in: 2419200 }),
        graphql: () => jsonResponse({ message: "Token is expired" }, 401),
      }),
    );
    const result = await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher });
    expect(result).toMatchObject({ ok: false, error: SHIPHERO_MESSAGES.reconnect });
    expect(fakeDb.state.row).toMatchObject({ state: "reconnect", last_error: SHIPHERO_MESSAGES.reconnect });
    expect(fakeDb.state.row!.refresh_token_enc).toBeTruthy();
    expect(fakeDb.state.calls.some((call) => call.op === "marketing_replace_shiphero_snapshot")).toBe(false);
    expect(fakeDb.state.calls.some((call) => call.op === "marketing_shiphero_release")).toBe(true);
  });

  it("a scope mismatch writes a fixed message, never provider text", async () => {
    fakeDb.state.row = connectedRow();
    const fetcher = vi.fn(shipheroFetcher({ graphql: () => stockPage(CUSTOMER) }));
    const result = await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher });
    expect(result).toMatchObject({ ok: false, error: SHIPHERO_MESSAGES.scope_mismatch });
    expect(fakeDb.state.row!.last_error).toBe(SHIPHERO_MESSAGES.scope_mismatch);
    expect(fakeDb.state.calls.some((call) => call.op === "marketing_replace_shiphero_snapshot")).toBe(false);
  });

  it("a connect during the refresh wins: the late refresh is dropped", async () => {
    const conn = connectedRow({ access_expires_at: null, access_token_enc: null });
    fakeDb.state.row = { ...conn, token_generation: 9 }; // reconnected meanwhile
    const fetcher = vi.fn(shipheroFetcher({ refresh: () => jsonResponse({ access_token: NEW_ACCESS, expires_in: 2419200 }) }));
    // The sync reads the row itself; simulate the race by bumping the generation after the read.
    fakeDb.state.row = { ...conn };
    const originalRpc = fakeDb.db.rpc;
    vi.spyOn(fakeDb.db, "rpc").mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "marketing_shiphero_lease") fakeDb.state.row!.token_generation = 9;
      return originalRpc(name, args);
    });
    const result = await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher });
    expect(result).toEqual({ ok: true, skipped: "ocupado" });
    expect(fakeDb.state.row!.access_token_enc).toBeNull();
  });
});

describe("disconnect and the saved inventory", () => {
  it("disconnect is an UPDATE that drops the tokens; no delete", async () => {
    fakeDb.state.row = connectedRow({ token_generation: 3 });
    const status = await disconnectShipHero(1, "7:Ana", env);
    expect(status.state).toBe("disconnected");
    expect(fakeDb.state.row).toMatchObject({
      refresh_token_enc: null,
      access_token_enc: null,
      state: "disconnected",
      token_generation: 4,
      disconnected_by: "7:Ana",
    });
    expect(fakeDb.state.calls.some((call) => call.op === "delete")).toBe(false);
  });

  it("serves the saved snapshot as ShipHero inventory, or pending before the first sync", async () => {
    expect(await readShipHeroInventory(1)).toBeNull();
    fakeDb.state.row = connectedRow();
    expect(await readShipHeroInventory(1)).toMatchObject({ status: "pending", message: "ShipHero conectado. Falta la primera sincronización." });
    const scope = `${ACCOUNT}||${WAREHOUSE}`;
    fakeDb.state.snapshots = [
      { id: "s2", snapshot_date: "2026-11-06", source: "shiphero", file_name: "ShipHero · CR", uploaded_at: "2026-11-06T16:13:00Z", uploaded_by: "cron", row_count: 1, error_count: 0, available_column: "available", backorder_column: "backorder", incoming_column: "", scope_key: scope },
      { id: "s1", snapshot_date: "2026-11-05", source: "shiphero", file_name: "ShipHero · CR", uploaded_at: "2026-11-05T16:13:00Z", uploaded_by: "7:Ana", row_count: 1, error_count: 0, available_column: "available", backorder_column: "backorder", incoming_column: "", scope_key: scope },
    ];
    fakeDb.state.items = {
      s2: [{ sku: "SKU1", warehouses: ["CR"], available: 4, on_hand: 5, allocated: 1, backorder: 0, incoming: null }],
      s1: [{ sku: "SKU1", warehouses: ["CR"], available: 1, on_hand: 1, allocated: 0, backorder: 0, incoming: null }],
    };
    const source = await readShipHeroInventory(1);
    expect(source).toMatchObject({
      status: "ready",
      message: "Inventario de ShipHero del 6 nov, 10:13.",
      data: {
        origin: "shiphero",
        snapshotDate: "2026-11-06",
        uploadedBy: "ShipHero (automático)",
        previous: { snapshotDate: "2026-11-05" },
        columns: { backorder: true, incoming: false },
        stock: [{ sku: "SKU1", available: 4, backorder: 0 }],
      },
    });
    const selects = fakeDb.state.calls.filter((call) => call.table === "marketing_inventory_snapshots");
    expect(selects.length).toBeGreaterThan(0);
  });

  const snapshot = (id: string, date: string, scopeKey: string) => ({
    id, snapshot_date: date, source: "shiphero", file_name: "ShipHero · CR", uploaded_at: `${date}T16:13:00Z`,
    uploaded_by: "cron", row_count: 1, error_count: 0, available_column: "available", backorder_column: "backorder",
    incoming_column: "", scope_key: scopeKey,
  });

  it("a disconnected connection gives no ShipHero source, even with old snapshots", async () => {
    fakeDb.state.row = connectedRow({ state: "disconnected", refresh_token_enc: null });
    fakeDb.state.snapshots = [snapshot("s1", "2026-11-06", `${ACCOUNT}||${WAREHOUSE}`)];
    fakeDb.state.items = { s1: [{ sku: "SKU1", warehouses: ["CR"], available: 4 }] };
    expect(await readShipHeroInventory(1)).toBeNull();
  });

  it("never serves another scope's snapshot, nor a snapshot while a choice is missing", async () => {
    const OTHER = b64("Warehouse:555");
    fakeDb.state.row = connectedRow({ warehouse_id: OTHER, warehouse_name: "GT" });
    fakeDb.state.snapshots = [snapshot("s1", "2026-11-06", `${ACCOUNT}||${WAREHOUSE}`)];
    fakeDb.state.items = { s1: [{ sku: "SKU1", warehouses: ["CR"], available: 4 }] };
    expect(await readShipHeroInventory(1)).toMatchObject({
      status: "pending",
      connection: "connected",
      message: "ShipHero conectado. Falta la primera sincronización.",
    });
    fakeDb.state.row = connectedRow({ state: "needs_scope", warehouse_id: null });
    expect(await readShipHeroInventory(1)).toMatchObject({ status: "pending", connection: "needs_scope", message: "ShipHero conectado. Falta elegir qué inventario leer." });
    // Only the snapshots of the current scope: "previous" never mixes warehouses.
    fakeDb.state.row = connectedRow({ state: "reconnect" });
    fakeDb.state.snapshots = [snapshot("s2", "2026-11-06", `${ACCOUNT}||${WAREHOUSE}`), snapshot("s1", "2026-11-05", `${ACCOUNT}||${OTHER}`)];
    fakeDb.state.items = { s2: [{ sku: "SKU1", warehouses: ["CR"], available: 4 }] };
    const source = await readShipHeroInventory(1);
    expect(source).toMatchObject({ status: "ready", connection: "reconnect", data: { snapshotDate: "2026-11-06", previous: null } });
    expect(source!.message).toContain("ShipHero pide volver a conectar.");
  });
});

describe("sync guards", () => {
  const deadline = () => Date.now() + 40_000;
  const poPage = (lines: Array<Record<string, unknown>>) =>
    jsonResponse({ data: { purchase_orders: { data: { pageInfo: { hasNextPage: false }, edges: lines.length ? [{ node: {
      id: "po1", po_date: "2026-11-01", fulfillment_status: "pending", warehouse_id: WAREHOUSE,
      line_items: { pageInfo: { hasNextPage: false }, edges: lines.map((node) => ({ node })) },
    } }] : [] } } } });

  it("a scope change during the read saves nothing and marks nothing as synced", async () => {
    fakeDb.state.row = connectedRow();
    const fetcher = vi.fn(
      shipheroFetcher({
        graphql: (body) => {
          if (body.query.includes("purchase_orders")) {
            // An editor picks another warehouse while the sync is reading.
            fakeDb.state.row!.token_generation += 1;
            return poPage([]);
          }
          return stockPage();
        },
      }),
    );
    const result = await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher, now: () => NOW });
    expect(result).toMatchObject({ ok: true, skipped: "cambio" });
    const save = fakeDb.state.calls.find((call) => call.op === "marketing_replace_shiphero_snapshot")!.args[0] as Record<string, unknown>;
    expect(save).toMatchObject({ p_generation: 1, p_scope: `${ACCOUNT}||${WAREHOUSE}` });
    expect(fakeDb.state.row).toMatchObject({ last_sync_ok_at: null, last_sync_at: null });
    expect(fakeDb.state.calls.some((call) => call.op === "marketing_shiphero_release")).toBe(true);
  });

  it("a disconnect during the read saves nothing", async () => {
    fakeDb.state.row = connectedRow();
    const fetcher = vi.fn(
      shipheroFetcher({
        graphql: (body) => {
          if (body.query.includes("purchase_orders")) {
            Object.assign(fakeDb.state.row!, { state: "disconnected", refresh_token_enc: null, token_generation: 2 });
            return poPage([]);
          }
          return stockPage();
        },
      }),
    );
    expect(await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher, now: () => NOW })).toMatchObject({ skipped: "cambio" });
  });

  it("with a complete PO read, a SKU without an open PO line has no 'en camino' (null, not 0)", async () => {
    fakeDb.state.row = connectedRow();
    const fetcher = vi.fn(shipheroFetcher({ graphql: (body) => (body.query.includes("purchase_orders") ? poPage([]) : stockPage()) }));
    const result = await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher, now: () => NOW });
    expect(result).toMatchObject({ ok: true, incoming: true });
    const save = fakeDb.state.calls.find((call) => call.op === "marketing_replace_shiphero_snapshot")!.args[0] as Record<string, any>;
    expect(save.p_meta.incoming_column).toBe("incoming");
    expect(save.p_items[0].incoming).toBeNull();
  });

  it("starts the catalog with the reads and counts SKUs without a product", async () => {
    fakeDb.state.row = connectedRow();
    const order: string[] = [];
    const fetcher = vi.fn(
      shipheroFetcher({
        graphql: (body) => {
          order.push("shiphero");
          return body.query.includes("purchase_orders") ? poPage([]) : stockPage();
        },
      }),
    );
    const catalog = vi.fn(async () => {
      order.push("catalog");
      return [{ key: "sku:otro", sku: "OTRO", name: "Otro" }];
    });
    await syncShipHeroInventory(1, { by: "cron", deadline: deadline(), env, fetcher, now: () => NOW, catalog });
    expect(order[0]).toBe("catalog");
    const save = fakeDb.state.calls.find((call) => call.op === "marketing_replace_shiphero_snapshot")!.args[0] as Record<string, any>;
    expect(save.p_meta.unmatched_count).toBe(1);
  });
});
