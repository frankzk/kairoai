import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  identity: {
    id: 7,
    nombre: "Marketing CR",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  },
  calls: [] as Array<{
    table: string;
    operation: string;
    value?: unknown;
    filters: Array<[string, unknown]>;
  }>,
  dbError: false,
  catalog: vi.fn(),
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/marketing-data", () => ({ getMarketingData: mocks.catalog }));
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (table: string) => {
      const call = {
        table,
        operation: "",
        value: undefined as unknown,
        filters: [] as Array<[string, unknown]>,
      };
      mocks.calls.push(call);
      const query = {
        select: () => {
          call.operation = "select";
          return query;
        },
        eq: (key: string, value: unknown) => {
          call.filters.push([key, value]);
          return query;
        },
        order: () => query,
        range: () => query,
        upsert: (value: unknown) => {
          call.operation = "upsert";
          call.value = value;
          return query;
        },
        delete: () => {
          call.operation = "delete";
          return query;
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({
            data: [],
            error: mocks.dbError
              ? { message: "private database detail" }
              : null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
import { GET, PATCH } from "../app/api/marketing/settings/route";
const request = (payload?: unknown, store = "mireva-cr") =>
  new NextRequest(
    `https://kairo.test/api/marketing/settings?store=${store}`,
    payload === undefined
      ? {}
      : { method: "PATCH", body: JSON.stringify(payload) },
  );
const mapping = {
  kind: "mapping",
  platform: "meta",
  account_id: "123",
  campaign_id: "456",
  product_key: "sku:a",
};
const plan = {
  kind: "plan",
  product_key: "sku:a",
  priority: true,
  supplier: "Proveedor",
  lead_days: 5,
  cover_days: 14,
  incoming_units: 20,
};
beforeEach(() => {
  vi.stubEnv("META_CR_AD_ACCOUNT_IDS", "123");
  mocks.calls.length = 0;
  mocks.dbError = false;
  mocks.identity = {
    id: 7,
    nombre: "Marketing CR",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  mocks.catalog.mockResolvedValue({
    catalog: [{ key: "sku:a", name: "Producto de Costa Rica", sku: "A" }],
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("persistent marketing settings", () => {
  it("requires independent Marketing and Costa Rica for reads and writes", async () => {
    for (const permissions of [[], ["finanzas"], ["usuarios"]]) {
      mocks.identity.permisos = permissions;
      expect((await GET(request())).status).toBe(403);
      expect((await PATCH(request(mapping))).status).toBe(403);
    }
    mocks.identity.permisos = ["marketing"];
    mocks.identity.tiendas = ["mireva-hn"];
    expect((await GET(request())).status).toBe(403);
    expect(mocks.calls).toEqual([]);
  });
  it("keeps all settings scoped to store 1 and marks responses private", async () => {
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ mappings: [], plans: [] });
    expect(mocks.calls).toHaveLength(2);
    mocks.calls.forEach((call) =>
      expect(call.filters).toContainEqual(["store_id", 1]),
    );
    expect((await GET(request(undefined, "mireva-hn"))).status).toBe(403);
  });
  it("saves a mapping using the server catalog and audit identity, ignoring forged product labels", async () => {
    expect(
      (
        await PATCH(
          request({
            ...mapping,
            product_name: "Forged",
            sku: "FORGED",
            store_id: 2,
            updated_by: "Forged",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.calls[0]).toMatchObject({
      table: "marketing_campaign_products",
      operation: "upsert",
      value: {
        store_id: 1,
        platform: "meta",
        account_id: "123",
        campaign_id: "456",
        product_key: "sku:a",
        product_name: "Producto de Costa Rica",
        sku: "A",
        updated_by: "7:Marketing CR",
      },
    });
  });
  it("rejects unconfigured accounts, invalid campaign IDs and foreign products without writes", async () => {
    for (const patch of [
      { account_id: "999" },
      { platform: "unknown" },
      { campaign_id: "../456" },
      { product_key: "sku:foreign" },
    ])
      expect((await PATCH(request({ ...mapping, ...patch }))).status).toBe(400);
    expect(mocks.calls).toEqual([]);
  });
  it("removes only the selected mapping and preserves store and account boundaries", async () => {
    expect(
      (await PATCH(request({ ...mapping, product_key: null }))).status,
    ).toBe(200);
    expect(mocks.calls[0]).toMatchObject({
      operation: "delete",
      filters: [
        ["store_id", 1],
        ["platform", "meta"],
        ["account_id", "123"],
        ["campaign_id", "456"],
      ],
    });
  });
  it("persists priority and explicit replenishment inputs without creating a supplier purchase", async () => {
    expect((await PATCH(request(plan))).status).toBe(200);
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0]).toMatchObject({
      table: "marketing_product_plans",
      operation: "upsert",
      value: {
        store_id: 1,
        priority: true,
        lead_days: 5,
        cover_days: 14,
        incoming_units: 20,
      },
    });
  });
  it.each([
    { lead_days: -1 },
    { cover_days: 0 },
    { incoming_units: 2.5 },
    { incoming_units: -1 },
    { priority: "true" },
    { supplier: "x".repeat(121) },
  ])("rejects invalid replenishment values %j", async (patch) => {
    expect((await PATCH(request({ ...plan, ...patch }))).status).toBe(400);
    expect(mocks.calls).toEqual([]);
  });
  it("does not write in read-only mode and does not mask database outages as empty settings", async () => {
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    expect((await PATCH(request(plan))).status).toBe(403);
    mocks.identity.permisos = ["marketing"];
    mocks.dbError = true;
    const result = await GET(request());
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain(
      "private database detail",
    );
    expect((await PATCH(request(mapping))).status).toBe(503);
  });
});
