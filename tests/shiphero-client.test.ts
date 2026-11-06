import { describe, expect, it, vi } from "vitest";
import {
  SHIPHERO_MESSAGES,
  ShipHeroError,
  aggregateShipHeroStock,
  discoverAccount,
  graphql,
  login,
  readIncoming,
  readWarehouseProducts,
  refreshAccess,
  sameShipHeroId,
  shipheroLegacyId,
  type ShipHeroScope,
  type ShipHeroStockRow,
} from "../lib/shiphero-client";

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
const b64 = (value: string) => Buffer.from(value).toString("base64");
const ACCOUNT = b64("Account:42");
const CUSTOMER = b64("Account:77");
const WAREHOUSE = b64("Warehouse:11790");
const OTHER_WAREHOUSE = b64("Warehouse:555");
const NOW = new Date("2026-11-06T16:00:00Z");
const PASSWORD = "pw-Secreta-123";
const ACCESS = "access-token-0123456789-abcdef";
const REFRESH = "refresh-token-0123456789";

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ShipHeroError);
    return (error as ShipHeroError).code;
  }
  throw new Error("expected a ShipHeroError");
};

const node = (over: Record<string, unknown> = {}) => ({
  id: "wp1",
  sku: "SKU1",
  account_id: ACCOUNT,
  warehouse_id: WAREHOUSE,
  warehouse_identifier: "Primary",
  on_hand: 3,
  available: 0,
  allocated: 3,
  backorder: 2,
  product: { name: "Producto 1" },
  ...over,
});
const page = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) =>
  response({
    data: {
      warehouse_products: {
        complexity: 101,
        data: { pageInfo: { hasNextPage, endCursor }, edges: nodes.map((n) => ({ node: n })) },
      },
    },
    extensions: { throttling: { user_quota: { credits_remaining: 3900 } } },
  });
const brand: ShipHeroScope = {
  is3pl: false,
  accountId: ACCOUNT,
  accountLegacyId: 42,
  customerAccountId: null,
  warehouseId: null,
};

describe("ShipHero auth", () => {
  it("login posts JSON only to /auth/token, without Authorization, once", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 2419200 }),
    );
    const tokens = await login("ana@mireva.cr", PASSWORD, { fetcher, now: () => NOW });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://public-api.shiphero.com/auth/token");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body)).toEqual({ username: "ana@mireva.cr", password: PASSWORD });
    expect(tokens).toEqual({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: new Date(NOW.getTime() + 28 * 86_400_000).toISOString(),
    });
  });

  it("maps login failures to codes, never to provider text, with no retry", async () => {
    const cases: Array<[Response | Error, string]> = [
      [response({ message: `Unauthorized ${PASSWORD}` }, 401), "bad_credentials"],
      [response({ message: "Public API access is disabled for this user" }, 403), "api_disabled"],
      [response({ locked: true }, 403), "locked"],
      [response({}, 410), "auth_gone"],
      [response({}, 404), "auth_gone"],
      [response({}, 429), "throttled"],
      [response({}, 503), "network"],
      [new TypeError("fetch failed"), "network"],
      [Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout"],
      [response({ access_token: "short" }), "unexpected"],
      [response({ access_token: ACCESS }), "unexpected"],
    ];
    for (const [result, expected] of cases) {
      const fetcher =
        result instanceof Error ? vi.fn().mockRejectedValue(result) : vi.fn().mockResolvedValue(result);
      try {
        await login("ana@mireva.cr", PASSWORD, { fetcher });
        throw new Error("should fail");
      } catch (error) {
        expect((error as ShipHeroError).code).toBe(expected);
        expect((error as Error).message).not.toContain(PASSWORD);
        expect((error as Error).message).not.toContain("Unauthorized");
      }
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("refresh posts to /auth/refresh and keeps the old refresh token unless rotated", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ access_token: ACCESS, expires_in: 2419200 }))
      .mockResolvedValueOnce(response({ access_token: ACCESS, refresh_token: "rotated-refresh-token", expires_in: 5 }));
    const first = await refreshAccess(REFRESH, { fetcher, now: () => NOW });
    expect(fetcher.mock.calls[0][0]).toBe("https://public-api.shiphero.com/auth/refresh");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ refresh_token: REFRESH });
    expect(first.refreshToken).toBeNull();
    const second = await refreshAccess(REFRESH, { fetcher, now: () => NOW });
    expect(second.refreshToken).toBe("rotated-refresh-token");
    // A strange expires_in is not trusted: 7 days.
    expect(second.expiresAt).toBe(new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
    expect(await code(refreshAccess(REFRESH, { fetcher: vi.fn().mockResolvedValue(response({}, 401)) }))).toBe("reconnect");
  });

  it("refresh retries once on a network error only", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(response({ access_token: ACCESS, expires_in: 2419200 }));
    await refreshAccess(REFRESH, { fetcher, sleep });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("ShipHero GraphQL", () => {
  const throttle = (extra: Record<string, unknown> = {}) =>
    response({
      errors: [{ code: 30, message: "There are not enough credits", time_remaining: "3 seconds", ...extra }],
      data: null,
    });

  it("waits time_remaining + 1 s on a credits throttle and retries the same request", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(throttle())
      .mockResolvedValueOnce(response({ data: { account: { complexity: 1, data: {} } } }));
    const result = await graphql(ACCESS, "query { account { complexity } }", {}, { fetcher, sleep });
    expect(sleep).toHaveBeenCalledWith(4000);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(result.complexity).toBe(1);
  });

  it("gives throttled after three throttles and too_complex without waiting", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn(async () => throttle());
    expect(await code(graphql(ACCESS, "q", {}, { fetcher, sleep }))).toBe("throttled");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const sleep2 = vi.fn();
    expect(
      await code(
        graphql(ACCESS, "q", {}, {
          fetcher: vi.fn().mockResolvedValue(throttle({ required_credits: 9000, max_available: 4004 })),
          sleep: sleep2,
        }),
      ),
    ).toBe("too_complex");
    expect(sleep2).not.toHaveBeenCalled();
  });

  it("does not wait past the deadline", async () => {
    const sleep = vi.fn();
    const fetcher = vi.fn(async () => throttle());
    const deadline = Date.now() + 7_000;
    expect(await code(graphql(ACCESS, "q", {}, { fetcher, sleep, deadline }))).toBe("throttled");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("bounds each request by the deadline and skips one with too little time", async () => {
    const seen: number[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetcher = vi.fn(async () => response({ data: {} }));
    await graphql(ACCESS, "q", {}, { fetcher, deadline: Date.now() + 8_000 });
    for (const call of timeout.mock.calls) seen.push(call[0]);
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeLessThanOrEqual(8_000);
    expect(seen[0]).toBeGreaterThan(6_000);
    // checkDeadline lets it start (> 5 s left), send() still caps the wait; < 3 s: not sent.
    const fixed = new Date();
    const none = vi.fn();
    expect(
      await code(graphql(ACCESS, "q", {}, { fetcher: none, now: () => fixed, deadline: fixed.getTime() + 2_000 })),
    ).toBe("timeout");
    expect(none).not.toHaveBeenCalled();
    timeout.mockRestore();
  });

  it("maps expired tokens, disabled API access, busy servers and other errors", async () => {
    expect(await code(graphql(ACCESS, "q", {}, { fetcher: vi.fn().mockResolvedValue(response({ message: "Token is expired" }, 401)) }))).toBe("token_expired");
    expect(await code(graphql(ACCESS, "q", {}, { fetcher: vi.fn().mockResolvedValue(response({ message: "Public API access is disabled for this user" }, 403)) }))).toBe("api_disabled");
    expect(await code(graphql(ACCESS, "q", {}, { fetcher: vi.fn().mockResolvedValue(response({ errors: [{ message: "Cannot query field foo" }] })) }))).toBe("unexpected");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({}, 503, { "Retry-After": "2" }))
      .mockResolvedValueOnce(response({ data: {} }));
    await graphql(ACCESS, "q", {}, { fetcher, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});

describe("ShipHero account discovery", () => {
  it("reads a brand/customer account without asking for customers", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({ data: { account: { data: { id: ACCOUNT, legacy_id: 42, email: "ana@mireva.cr", is_3pl: false, warehouses: [{ id: WAREHOUSE, legacy_id: 11790, identifier: "Costa Rica", active: true }] } } } }),
    );
    const account = await discoverAccount(ACCESS, { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(account).toMatchObject({ id: ACCOUNT, is3pl: false, email: "ana@mireva.cr", customers: [], warehouses: [{ id: WAREHOUSE, name: "Costa Rica", active: true }] });
  });

  it("lists 3PL customers page by page and accepts warehouses as a connection", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ errors: [{ message: "Field warehouses must have selection of edges" }] }))
      .mockResolvedValueOnce(response({ data: { account: { data: { id: ACCOUNT, is_3pl: true, username: "boxful", warehouses: { edges: [{ node: { id: WAREHOUSE, identifier: "CR", active: true } }, { node: { id: OTHER_WAREHOUSE, identifier: "GT", active: false } }] } } } } }))
      .mockResolvedValueOnce(response({ data: { account: { data: { customers: { pageInfo: { hasNextPage: true, endCursor: "c1" }, edges: [{ node: { id: CUSTOMER, username: "Mireva" } }] } } } } }))
      .mockResolvedValueOnce(response({ data: { account: { data: { customers: { pageInfo: { hasNextPage: false }, edges: [{ node: { id: "other", email: "x@y.z" } }] } } } } }));
    const account = await discoverAccount(ACCESS, { fetcher });
    expect(account.is3pl).toBe(true);
    expect(account.warehouses.map((w) => [w.name, w.active])).toEqual([["CR", true], ["GT", false]]);
    expect(account.customers).toEqual([
      { id: CUSTOMER, legacyId: null, name: "Mireva" },
      // Never the e-mail of another brand: the id stands in for a missing username.
      { id: "other", legacyId: null, name: "other" },
    ]);
    expect(JSON.parse(fetcher.mock.calls[2][1].body).query).not.toContain("email");
    expect(JSON.parse(fetcher.mock.calls[3][1].body).variables).toEqual({ after: "c1" });
    expect(account.customersTruncated).toBe(false);
  });
});

describe("ShipHero inventory", () => {
  it("omits customer_account_id for a customer/brand token and keeps genuine zeros", async () => {
    const fetcher = vi.fn().mockResolvedValue(page([node({ backorder: null })]));
    const rows = await readWarehouseProducts(ACCESS, brand, { fetcher });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.query).not.toContain("customer_account_id");
    expect(body.query).not.toContain("warehouse_id:");
    expect(body.query).not.toContain("mutation");
    expect(body.variables).toEqual({ after: null });
    expect(rows).toEqual([
      { id: "wp1", sku: "SKU1", name: "Producto 1", warehouseId: WAREHOUSE, warehouseName: "Primary", onHand: 3, available: 0, allocated: 3, backorder: null },
    ]);
  });

  it("passes customer_account_id for a 3PL token and refuses to read without a customer", async () => {
    const none = vi.fn();
    expect(await code(readWarehouseProducts(ACCESS, { ...brand, is3pl: true }, { fetcher: none }))).toBe("needs_scope");
    expect(none).not.toHaveBeenCalled();
    const fetcher = vi.fn().mockResolvedValue(page([node({ account_id: CUSTOMER })]));
    const rows = await readWarehouseProducts(ACCESS, { ...brand, is3pl: true, customerAccountId: CUSTOMER, warehouseId: WAREHOUSE }, { fetcher });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.query).toContain("customer_account_id: $customer");
    expect(body.query).toContain("warehouse_id: $warehouse");
    expect(body.variables).toEqual({ after: null, customer: CUSTOMER, warehouse: WAREHOUSE });
    expect(rows[0].backorder).toBe(2);
  });

  it("fails closed on rows of another account or warehouse", async () => {
    expect(await code(readWarehouseProducts(ACCESS, brand, { fetcher: vi.fn().mockResolvedValue(page([node({ account_id: CUSTOMER })])) }))).toBe("scope_mismatch");
    expect(await code(readWarehouseProducts(ACCESS, { ...brand, warehouseId: WAREHOUSE }, { fetcher: vi.fn().mockResolvedValue(page([node({ warehouse_id: OTHER_WAREHOUSE })])) }))).toBe("scope_mismatch");
    // 3PL: the rows must be the chosen customer's, not the 3PL's own.
    expect(await code(readWarehouseProducts(ACCESS, { ...brand, is3pl: true, customerAccountId: CUSTOMER }, { fetcher: vi.fn().mockResolvedValue(page([node()])) }))).toBe("scope_mismatch");
  });

  it("asks to choose when the rows span two warehouses and none was chosen", async () => {
    const fetcher = vi.fn().mockResolvedValue(page([node(), node({ id: "wp2", warehouse_id: OTHER_WAREHOUSE, warehouse_identifier: "GT" })]));
    try {
      await readWarehouseProducts(ACCESS, brand, { fetcher });
      throw new Error("should fail");
    } catch (error) {
      expect((error as ShipHeroError).code).toBe("needs_scope");
      expect((error as ShipHeroError).warehouses).toEqual([
        { id: WAREHOUSE, name: "Primary" },
        { id: OTHER_WAREHOUSE, name: "GT" },
      ]);
    }
  });

  it("rejects duplicates, missing ids and bad numbers", async () => {
    expect(await code(readWarehouseProducts(ACCESS, brand, { fetcher: vi.fn().mockResolvedValue(page([node(), node()])) }))).toBe("unexpected");
    expect(await code(readWarehouseProducts(ACCESS, brand, { fetcher: vi.fn().mockResolvedValue(page([node({ sku: "" })])) }))).toBe("unexpected");
    expect(await code(readWarehouseProducts(ACCESS, brand, { fetcher: vi.fn().mockResolvedValue(page([node({ available: null })])) }))).toBe("unexpected");
  });

  it("pages with an advancing cursor, caps at 25 pages and never returns partial rows on timeout", async () => {
    let n = 0;
    const endless = vi.fn(async () => page([node({ id: `wp${n}`, sku: `S${n}` })], true, `c${++n}`));
    expect(await code(readWarehouseProducts(ACCESS, brand, { fetcher: endless }))).toBe("too_complex");
    expect(endless).toHaveBeenCalledTimes(25);
    const stuck = vi.fn().mockResolvedValue(page([], true, null));
    expect(await code(readWarehouseProducts(ACCESS, brand, { fetcher: stuck }))).toBe("unexpected");
    let clock = Date.now();
    const slow = vi.fn(async () => {
      clock += 30_000;
      return page([node({ id: `x${clock}`, sku: `X${clock}` })], true, `c${clock}`);
    });
    expect(
      await code(readWarehouseProducts(ACCESS, brand, { fetcher: slow, now: () => new Date(clock), deadline: Date.now() + 50_000 })),
    ).toBe("timeout");
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("renews an expired token once and retries the same page", async () => {
    const renew = vi.fn().mockResolvedValue("new-access-token-0123456789");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ message: "Token is expired" }, 401))
      .mockResolvedValueOnce(page([node()]));
    const auth = { token: ACCESS, renew };
    await readWarehouseProducts(auth, brand, { fetcher });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer new-access-token-0123456789");
    const twice = vi.fn(async () => response({ message: "Token is expired" }, 401));
    expect(await code(readWarehouseProducts({ token: ACCESS, renew }, brand, { fetcher: twice }))).toBe("reconnect");
  });
});

describe("ShipHero ids and aggregation", () => {
  it("compares base64 ids with legacy digits, by type", () => {
    expect(shipheroLegacyId(WAREHOUSE)).toBe(11790);
    expect(shipheroLegacyId("11790")).toBe(11790);
    expect(shipheroLegacyId("not-an-id")).toBeNull();
    expect(sameShipHeroId(WAREHOUSE, "11790")).toBe(true);
    expect(sameShipHeroId(WAREHOUSE, WAREHOUSE)).toBe(true);
    expect(sameShipHeroId(b64("Account:11790"), WAREHOUSE)).toBe(false);
    expect(sameShipHeroId(WAREHOUSE, OTHER_WAREHOUSE)).toBe(false);
    expect(sameShipHeroId("", "")).toBe(false);
  });

  it("sums a SKU across warehouses and fills incoming only from a complete map (null without a PO line)", () => {
    const row = (over: Partial<ShipHeroStockRow>): ShipHeroStockRow => ({
      id: "a", sku: "SKU1", name: "Uno", warehouseId: WAREHOUSE, warehouseName: "CR",
      onHand: 5, available: 4, allocated: 1, backorder: null, ...over,
    });
    const rows = [row({}), row({ id: "b", sku: "sku1 ", warehouseId: OTHER_WAREHOUSE, warehouseName: "GT", backorder: 2 }), row({ id: "c", sku: "SKU2" })];
    const withIncoming = aggregateShipHeroStock(rows, new Map([["sku1", 7]]));
    expect(withIncoming).toEqual([
      { sku: "SKU1", name: "Uno", warehouseId: "varias", warehouses: ["CR", "GT"], onHand: 10, available: 8, allocated: 2, backorder: 2, incoming: 7 },
      // No open PO line: no data (null), so the manual plan still applies.
      { sku: "SKU2", name: "Uno", warehouseId: WAREHOUSE, warehouses: ["CR"], onHand: 5, available: 4, allocated: 1, backorder: null, incoming: null },
    ]);
    expect(aggregateShipHeroStock(rows, null).every((item) => item.incoming === null)).toBe(true);
  });
});

describe("ShipHero incoming (open purchase orders)", () => {
  const po = (status: string, lines: unknown[], hasNextPage = false) => ({
    node: { id: `po-${status}`, po_date: "2026-11-20T00:00:00", fulfillment_status: status, warehouse_id: WAREHOUSE, line_items: { pageInfo: { hasNextPage }, edges: lines.map((l) => ({ node: l })) } },
  });
  const pos = (edges: unknown[]) =>
    response({ data: { purchase_orders: { data: { pageInfo: { hasNextPage: false }, edges } } } });

  it("counts quantity − received − rejected of open POs only, floored at 0", async () => {
    const fetcher = vi.fn().mockResolvedValue(pos([
      po("pending", [
        { sku: "SKU1", quantity: 10, quantity_received: 3, quantity_rejected: 1 },
        { sku: "SKU2", quantity: 2, quantity_received: 5, quantity_rejected: 0 },
        { sku: "SKU3", quantity: 4, quantity_received: 0, quantity_rejected: 0, fulfillment_status: "closed" },
      ]),
      po("closed", [{ sku: "SKU1", quantity: 100, quantity_received: 0, quantity_rejected: 0 }]),
      po("Canceled", [{ sku: "SKU1", quantity: 100, quantity_received: 0, quantity_rejected: 0 }]),
    ]));
    const result = await readIncoming(ACCESS, brand, { fetcher, since: "2026-05-10" });
    expect(result.complete).toBe(true);
    expect(Array.from(result.bySku)).toEqual([["sku1", 6]]);
    expect(result.earliestPoDate.get("sku1")).toBe("2026-11-20");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.query).toContain('created_from: "2026-05-10"');
    expect(body.query).not.toContain("customer_account_id");
  });

  it("is incomplete (and never throws) on truncated lines or errors", async () => {
    const truncated = vi.fn().mockResolvedValue(pos([po("pending", [{ sku: "SKU1", quantity: 1, quantity_received: 0, quantity_rejected: 0 }], true)]));
    expect((await readIncoming(ACCESS, brand, { fetcher: truncated, since: "2026-05-10" })).complete).toBe(false);
    const failing = vi.fn().mockResolvedValue(response({ errors: [{ message: "Unknown argument" }] }));
    expect((await readIncoming(ACCESS, brand, { fetcher: failing, since: "2026-05-10" })).complete).toBe(false);
    const injected = vi.fn();
    expect((await readIncoming(ACCESS, brand, { fetcher: injected, since: '2026") { x' })).complete).toBe(false);
    expect(injected).not.toHaveBeenCalled();
  });
});

describe("messages", () => {
  it("has a short Spanish message for every code", () => {
    for (const message of Object.values(SHIPHERO_MESSAGES)) {
      expect(message.length).toBeLessThanOrEqual(300);
      expect(message).toMatch(/[a-záéíóúñ]/i);
    }
  });
});
