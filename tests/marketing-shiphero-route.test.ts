import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  identity: {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  } as { id: number; nombre: string; permisos: string[]; tiendas: string[] },
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/marketing-catalog-loader", () => ({
  marketingCatalogLoader: () => async () => [{ key: "sku:sku1", sku: "SKU1", name: "Uno" }],
}));
vi.mock("@/lib/db", async () => {
  const { fakeDb } = await import("./helpers/shiphero-fake-db");
  return { getDB: () => fakeDb.db };
});

import { baseRow, fakeDb, jsonResponse, shipheroFetcher } from "./helpers/shiphero-fake-db";
import { sealSecret, loadSecretKey } from "../lib/secret-box";
import * as route from "../app/api/marketing/shiphero/route";
import { POST as SYNC } from "../app/api/marketing/shiphero/sync/route";

const { GET, POST, PATCH } = route;
const KEY = Buffer.alloc(32, 5).toString("base64");
const b64 = (value: string) => Buffer.from(value).toString("base64");
const ACCOUNT = b64("Account:42");
const WAREHOUSE = b64("Warehouse:11790");
const OTHER = b64("Warehouse:555");
const PASSWORD = "pw-Secreta-123";
const ACCESS = "access-token-0123456789-abcdef";
const REFRESH = "refresh-token-0123456789";

const request = (
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  store = "mireva-cr",
  path = "/api/marketing/shiphero",
) =>
  new NextRequest(`https://kairo.test${path}?store=${store}`, {
    method,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
const connectBody = { mode: "password", username: "ana@mireva.cr", password: PASSWORD };

const accountResponse = (warehouses: unknown[]) =>
  jsonResponse({ data: { account: { data: { id: ACCOUNT, legacy_id: 42, email: "ana@mireva.cr", is_3pl: false, warehouses } } } });
const stockResponse = () =>
  jsonResponse({
    data: {
      warehouse_products: {
        complexity: 50,
        data: {
          pageInfo: { hasNextPage: false },
          edges: [{ node: { id: "wp1", sku: "SKU1", account_id: ACCOUNT, warehouse_id: WAREHOUSE, warehouse_identifier: "CR", on_hand: 2, available: 2, allocated: 0, backorder: 0, product: { name: "Uno" } } }],
        },
      },
    },
  });

let fetcher: ReturnType<typeof vi.fn>;
let consoleOutput: string[];

beforeEach(() => {
  mocks.identity = { id: 7, nombre: "Ana", permisos: ["marketing"], tiendas: ["mireva-cr"] };
  fakeDb.reset();
  vi.stubEnv("SHIPHERO_TOKEN_KEY", KEY);
  fetcher = vi.fn(
    shipheroFetcher({
      token: () => jsonResponse({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 2419200 }),
      graphql: (body) =>
        body.query.includes("KairoAccount")
          ? accountResponse([{ id: WAREHOUSE, identifier: "CR", active: true }])
          : body.query.includes("purchase_orders")
            ? jsonResponse({ data: { purchase_orders: { data: { pageInfo: { hasNextPage: false }, edges: [] } } } })
            : stockResponse(),
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  consoleOutput = [];
  for (const level of ["log", "warn", "error", "info"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The password may only appear in the body of the single /auth/token call. */
function expectNoPasswordLeak(responseJson: unknown) {
  expect(JSON.stringify(responseJson)).not.toContain(PASSWORD);
  expect(JSON.stringify(fakeDb.state.calls)).not.toContain(PASSWORD);
  expect(consoleOutput.join("\n")).not.toContain(PASSWORD);
  const carrying = fetcher.mock.calls.filter((call) => JSON.stringify(call).includes(PASSWORD));
  expect(carrying.length).toBeLessThanOrEqual(1);
  for (const call of carrying) expect(String(call[0])).toBe("https://public-api.shiphero.com/auth/token");
  for (const call of fetcher.mock.calls) expect(String(call[0])).not.toContain(PASSWORD);
}

describe("GET /api/marketing/shiphero", () => {
  it("works for viewers and read-only users, without tokens in the JSON", async () => {
    fakeDb.state.row = baseRow({
      refresh_token_enc: sealSecret(REFRESH, { ...loadSecretKey({ SHIPHERO_TOKEN_KEY: KEY }, "SHIPHERO_TOKEN_KEY"), aad: "shiphero:1:refresh" }),
    });
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    const res = await GET(request("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", canEdit: false, connection: { state: "connected", key: { configured: true } } });
    expect(JSON.stringify(body)).not.toContain("v1.");
    expect(JSON.stringify(body)).not.toContain(REFRESH);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("the 3PL choices (other brands) only go to editors", async () => {
    fakeDb.state.row = baseRow({
      state: "needs_scope",
      is_3pl: true,
      refresh_token_enc: sealSecret(REFRESH, { ...loadSecretKey({ SHIPHERO_TOKEN_KEY: KEY }, "SHIPHERO_TOKEN_KEY"), aad: "shiphero:1:refresh" }),
      choices: { warehouses: [], customers: [{ id: "c1", name: "Mireva" }, { id: "c2", name: "Otra marca" }] },
    });
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    const viewer = await (await GET(request("GET"))).json();
    expect(viewer.connection.choices.customers).toEqual([]);
    expect(JSON.stringify(viewer)).not.toContain("Otra marca");
    mocks.identity.permisos = ["marketing"];
    const editor = await (await GET(request("GET"))).json();
    expect(editor.connection.choices.customers).toHaveLength(2);
  });

  it("says the key is pending, and the migration is pending", async () => {
    vi.stubEnv("SHIPHERO_TOKEN_KEY", "");
    let body = await (await GET(request("GET"))).json();
    expect(body.connection.key).toEqual({ configured: false, message: "Pendiente: configurar SHIPHERO_TOKEN_KEY." });
    fakeDb.state.missingTable = true;
    body = await (await GET(request("GET"))).json();
    expect(body).toMatchObject({ status: "pending_migration", message: "Pendiente: aplicar migración de ShipHero." });
    expect(JSON.stringify(body)).not.toContain("private detail");
  });

  it("refuses without Marketing or Costa Rica", async () => {
    expect((await GET(request("GET", undefined, "mireva-hn"))).status).toBe(403);
    mocks.identity.tiendas = [];
    expect((await GET(request("GET"))).status).toBe(403);
  });
});

describe("POST /api/marketing/shiphero (connect)", () => {
  it("only editors connect; read-only and other stores get 403 with no call", async () => {
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    expect((await POST(request("POST", connectBody))).status).toBe(403);
    mocks.identity.permisos = ["marketing"];
    mocks.identity.tiendas = [];
    expect((await POST(request("POST", connectBody))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    expect(fakeDb.state.calls).toEqual([]);
  });

  it("without the key: 503 and ShipHero is never called", async () => {
    vi.stubEnv("SHIPHERO_TOKEN_KEY", "");
    const res = await POST(request("POST", connectBody));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Pendiente: configurar SHIPHERO_TOKEN_KEY.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects big or bad bodies without echoing them", async () => {
    const big = await POST(request("POST", JSON.stringify({ ...connectBody, pad: "x".repeat(5000) })));
    expect(big.status).toBe(413);
    expect(JSON.stringify(await big.json())).not.toContain(PASSWORD);
    const bad = await POST(request("POST", { mode: "password", username: "a", password: PASSWORD }));
    expect(bad.status).toBe(400);
    const badJson = await bad.json();
    expect(badJson.error).toBe("Escribe el correo y la contraseña de ShipHero.");
    expectNoPasswordLeak(badJson);
    expect((await POST(request("POST", { mode: "token", refreshToken: "x" }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("too many attempts: 429 and no ShipHero call", async () => {
    fakeDb.state.rpc.set("marketing_shiphero_connect_attempt", () => ({ data: false, error: null }));
    const res = await POST(request("POST", connectBody));
    expect(res.status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("wrong password: 422 (never 401) with a fixed message", async () => {
    fetcher.mockImplementation(shipheroFetcher({ token: () => jsonResponse({ message: `Unauthorized ${PASSWORD}` }, 401) }));
    const res = await POST(request("POST", connectBody));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Usuario o contraseña incorrectos, o el usuario no tiene acceso a la API de ShipHero.");
    expectNoPasswordLeak(body);
    expect(consoleOutput).toEqual(["shiphero connect failed bad_credentials"]);
    expect(fakeDb.state.calls.some((call) => call.op === "upsert")).toBe(false);
  });

  it("connects, syncs inline and never leaks the password", async () => {
    const res = await POST(request("POST", connectBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      connection: { state: "connected", userEmail: "ana@mireva.cr", lastSyncRows: 1 },
      sync: { ok: true, rows: 1, incoming: true },
    });
    expectNoPasswordLeak(body);
    expect(JSON.stringify(body)).not.toContain(REFRESH);
    expect(JSON.stringify(body)).not.toContain(ACCESS);
    expect(fakeDb.state.calls.some((call) => call.op === "marketing_replace_shiphero_snapshot")).toBe(true);
  });

  it("two warehouses: needs a choice and does not sync yet", async () => {
    fetcher.mockImplementation(
      shipheroFetcher({
        token: () => jsonResponse({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 2419200 }),
        graphql: () => accountResponse([{ id: WAREHOUSE, identifier: "CR", active: true }, { id: OTHER, identifier: "GT", active: true }]),
      }),
    );
    const body = await (await POST(request("POST", connectBody))).json();
    expect(body).toMatchObject({ status: "ok", connection: { state: "needs_scope", warehouse: null }, sync: null });
  });
});

describe("PATCH /api/marketing/shiphero", () => {
  beforeEach(() => {
    fakeDb.state.row = baseRow({
      state: "needs_scope",
      refresh_token_enc: sealSecret(REFRESH, { ...loadSecretKey({ SHIPHERO_TOKEN_KEY: KEY }, "SHIPHERO_TOKEN_KEY"), aad: "shiphero:1:refresh" }),
      choices: { warehouses: [{ id: WAREHOUSE, name: "CR", active: true }, { id: OTHER, name: "GT", active: true }], customers: [] },
    });
  });

  it("only accepts a warehouse among the choices", async () => {
    const bad = await PATCH(request("PATCH", { action: "scope", warehouseId: "nope" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Esa opción ya no está disponible. Vuelve a conectar.");
    const ok = await PATCH(request("PATCH", { action: "scope", warehouseId: WAREHOUSE }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).connection).toMatchObject({ state: "connected", warehouse: { id: WAREHOUSE, name: "CR" } });
  });

  it("disconnect is an UPDATE; there is no DELETE handler", async () => {
    const res = await PATCH(request("PATCH", { action: "disconnect" }));
    expect(res.status).toBe(200);
    expect((await res.json()).connection.state).toBe("disconnected");
    expect(fakeDb.state.row).toMatchObject({ refresh_token_enc: null, access_token_enc: null });
    expect(fakeDb.state.calls.some((call) => call.op === "delete")).toBe(false);
    expect((route as Record<string, unknown>).DELETE).toBeUndefined();
  });

  it("a chosen 3PL customer is locked: changing it needs a new connection", async () => {
    Object.assign(fakeDb.state.row!, {
      is_3pl: true,
      customer_account_id: "c1",
      customer_name: "Mireva",
      choices: { warehouses: [{ id: WAREHOUSE, name: "CR", active: true }], customers: [{ id: "c1", name: "Mireva" }, { id: "c2", name: "Otra marca" }] },
    });
    const res = await PATCH(request("PATCH", { action: "scope", customerAccountId: "c2" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Para cambiar de cliente, vuelve a conectar ShipHero.");
    expect(fakeDb.state.row!.customer_account_id).toBe("c1");
  });

  it("read-only users cannot change it", async () => {
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    expect((await PATCH(request("PATCH", { action: "disconnect" }))).status).toBe(403);
    expect(fakeDb.state.row!.state).toBe("needs_scope");
  });
});

describe("POST /api/marketing/shiphero/sync", () => {
  const sync = () => SYNC(request("POST", undefined, "mireva-cr", "/api/marketing/shiphero/sync"));
  beforeEach(() => {
    const key = loadSecretKey({ SHIPHERO_TOKEN_KEY: KEY }, "SHIPHERO_TOKEN_KEY");
    fakeDb.state.row = baseRow({
      refresh_token_enc: sealSecret(REFRESH, { ...key, aad: "shiphero:1:refresh" }),
      access_token_enc: sealSecret(ACCESS, { ...key, aad: "shiphero:1:access" }),
      access_expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      warehouse_id: WAREHOUSE,
      warehouse_name: "CR",
    });
  });

  it("editors only", async () => {
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    expect((await sync()).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("waits 10 minutes between runs", async () => {
    fakeDb.state.row!.last_sync_at = new Date(Date.now() - 3 * 60_000).toISOString();
    const res = await sync();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("Ya se sincronizó hace poco. Prueba en 7 min.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("syncs and reports the rows", async () => {
    const res = await sync();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", result: { ok: true, rows: 1 } });
  });

  it("a sync that finds two warehouses, then a choice: the next sync runs at once (no 429)", async () => {
    fakeDb.state.row!.warehouse_id = null;
    fakeDb.state.row!.warehouse_name = null;
    const twoWarehouses = jsonResponse({
      data: { warehouse_products: { data: { pageInfo: { hasNextPage: false }, edges: [
        { node: { id: "wp1", sku: "SKU1", account_id: ACCOUNT, warehouse_id: WAREHOUSE, warehouse_identifier: "CR", on_hand: 2, available: 2, allocated: 0, backorder: 0, product: { name: "Uno" } } },
        { node: { id: "wp2", sku: "SKU1", account_id: ACCOUNT, warehouse_id: OTHER, warehouse_identifier: "GT", on_hand: 9, available: 9, allocated: 0, backorder: 0, product: { name: "Uno" } } },
      ] } } },
    });
    fetcher.mockImplementation(
      shipheroFetcher({
        graphql: (body) =>
          body.query.includes("purchase_orders")
            ? jsonResponse({ data: { purchase_orders: { data: { pageInfo: { hasNextPage: false }, edges: [] } } } })
            : body.variables.warehouse === WAREHOUSE
              ? stockResponse()
              : twoWarehouses,
      }),
    );
    const first = await (await sync()).json();
    expect(first).toMatchObject({ status: "ok", result: { skipped: "falta_elegir" } });
    expect(fakeDb.state.row!.state).toBe("needs_scope");
    const chosen = await PATCH(request("PATCH", { action: "scope", warehouseId: WAREHOUSE }));
    expect((await chosen.json()).connection).toMatchObject({ state: "connected", syncInMs: 0 });
    const second = await sync();
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ result: { ok: true, rows: 1 } });
  });

  it("choosing «Todos los almacenes» then syncing: 200, no warehouse filter, the stock summed", async () => {
    fakeDb.state.row!.last_sync_at = new Date(Date.now() - 60_000).toISOString();
    fakeDb.state.row!.choices = {
      warehouses: [{ id: WAREHOUSE, name: "CR", active: true }, { id: OTHER, name: "GT", active: true }],
      customers: [],
    };
    const stockBodies: Array<Record<string, unknown>> = [];
    fetcher.mockImplementation(
      shipheroFetcher({
        graphql: (body) => {
          if (body.query.includes("purchase_orders"))
            return jsonResponse({ data: { purchase_orders: { data: { pageInfo: { hasNextPage: false }, edges: [] } } } });
          stockBodies.push(body.variables);
          return jsonResponse({
            data: { warehouse_products: { data: { pageInfo: { hasNextPage: false }, edges: [
              { node: { id: "wp1", sku: "SKU1", account_id: ACCOUNT, warehouse_id: WAREHOUSE, warehouse_identifier: "CR", on_hand: 2, available: 2, allocated: 0, backorder: 0, product: { name: "Uno" } } },
              { node: { id: "wp2", sku: "SKU1", account_id: ACCOUNT, warehouse_id: OTHER, warehouse_identifier: "GT", on_hand: 9, available: 9, allocated: 0, backorder: 0, product: { name: "Uno" } } },
            ] } } },
          });
        },
      }),
    );
    const chosen = await PATCH(request("PATCH", { action: "scope", warehouseId: "*" }));
    expect(chosen.status).toBe(200);
    expect((await chosen.json()).connection).toMatchObject({
      state: "connected",
      warehouse: { id: "*", name: "Todos los almacenes", count: 2 },
      syncInMs: 0,
    });
    const res = await sync();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", result: { ok: true, rows: 1 } });
    expect(stockBodies).toEqual([{ after: null }]);
    const save = fakeDb.state.calls.find((call) => call.op === "marketing_replace_shiphero_snapshot")!.args[0] as Record<string, any>;
    expect(save.p_scope).toBe(`${ACCOUNT}||*`);
    expect(save.p_items[0]).toMatchObject({ sku: "SKU1", available: 11, on_hand: 11, warehouses: ["CR", "GT"] });
    const status = await (await GET(request("GET"))).json();
    expect(status.connection).toMatchObject({ warehouse: { id: "*", name: "Todos los almacenes", count: 2 }, lastSyncRows: 1 });
  });

  it("«Todos los almacenes» with a single warehouse is a 400", async () => {
    fakeDb.state.row!.choices = { warehouses: [{ id: WAREHOUSE, name: "CR", active: true }], customers: [] };
    const res = await PATCH(request("PATCH", { action: "scope", warehouseId: "*" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("«Todos los almacenes» solo está disponible con dos o más almacenes activos.");
    expect(fakeDb.state.row!.warehouse_id).toBe(WAREHOUSE);
  });

  it("a failure is 502 with the Spanish message", async () => {
    fetcher.mockImplementation(shipheroFetcher({ graphql: () => jsonResponse({ message: "Public API access is disabled for this user" }, 403) }));
    const res = await sync();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Tu usuario de ShipHero no tiene «API Access». Pide a Boxful que lo active.");
  });
});
