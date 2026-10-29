import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  actor: {
    id: 7,
    nombre: "Marketing CR",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  },
  writes: [] as Array<{
    table: string;
    action: string;
    data?: unknown;
    filters: Array<[string, unknown]>;
  }>,
  settings: vi.fn(),
  catalog: vi.fn(),
  failed: false,
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.actor }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/marketing-charlie-settings", () => ({
  readCharlieSettings: mocks.settings,
}));
vi.mock("@/lib/marketing-data", () => ({ getMarketingData: mocks.catalog }));
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (table: string) => {
      const record = {
        table,
        action: "",
        data: undefined as unknown,
        filters: [] as Array<[string, unknown]>,
      };
      const query = {
        upsert: (data: unknown) => {
          record.action = "upsert";
          record.data = data;
          mocks.writes.push(record);
          return query;
        },
        delete: () => {
          record.action = "delete";
          mocks.writes.push(record);
          return query;
        },
        eq: (key: string, value: unknown) => {
          record.filters.push([key, value]);
          return query;
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({
            error: mocks.failed ? { message: "private database error" } : null,
          }).then(resolve, reject),
      };
      return query;
    },
  }),
}));
import { GET, PATCH } from "../app/api/marketing/charlie-settings/route";
const request = (body?: unknown, store = "mireva-cr") =>
  new NextRequest(
    `https://kairo.test/api/marketing/charlie-settings?store=${store}`,
    body === undefined ? {} : { method: "PATCH", body: JSON.stringify(body) },
  );
const config = {
  kind: "config",
  crc_per_usd: null,
  rate_date: null,
  hero_product_keys: [],
};
const role = {
  kind: "role",
  account_id: "123",
  adset_id: "456",
  role: "control",
};
beforeEach(() => {
  vi.stubEnv("META_CR_AD_ACCOUNT_IDS", "123");
  vi.stubEnv("META_CR_ACCESS_TOKEN", "private-fixture");
  vi.stubEnv("META_CR_GRAPH_VERSION", "v26.0");
  mocks.actor = {
    id: 7,
    nombre: "Marketing CR",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  mocks.writes.length = 0;
  mocks.failed = false;
  mocks.settings.mockResolvedValue({ config });
  mocks.catalog.mockResolvedValue({ catalog: [{ key: "sku:a" }] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Charlie configuration and role boundaries", () => {
  it("requires Marketing and Costa Rica for reads and writes", async () => {
    mocks.actor.permisos = ["finanzas"];
    expect((await GET(request())).status).toBe(403);
    expect((await PATCH(request(config))).status).toBe(403);
    mocks.actor.permisos = ["marketing"];
    mocks.actor.tiendas = ["mireva-hn"];
    expect((await PATCH(request(role))).status).toBe(403);
    expect(mocks.writes).toEqual([]);
  });
  it("returns private settings and does not turn a configuration outage into defaults", async () => {
    expect((await GET(request())).headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    mocks.settings.mockRejectedValue(new Error("private-fixture"));
    const result = await GET(request());
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain(
      "private-fixture",
    );
  });
  it("saves the official-rate mode or a manual planning reference with audit identity", async () => {
    expect((await PATCH(request(config))).status).toBe(200);
    expect(mocks.writes[0]).toMatchObject({
      table: "marketing_charlie_config",
      data: {
        store_id: 1,
        crc_per_usd: null,
        rate_date: null,
        updated_by: "7:Marketing CR",
      },
    });
    expect(
      (
        await PATCH(
          request({ ...config, crc_per_usd: 454.82, rate_date: "2026-10-29" }),
        )
      ).status,
    ).toBe(200);
  });
  it.each([
    { crc_per_usd: 0, rate_date: "2026-10-29" },
    { crc_per_usd: 500, rate_date: null },
    { crc_per_usd: "500", rate_date: "2026-10-29" },
    { crc_per_usd: 500, rate_date: "2099-01-01" },
    { hero_product_keys: ["sku:foreign"] },
  ])("rejects invalid or foreign configuration %j", async (patch) => {
    expect((await PATCH(request({ ...config, ...patch }))).status).toBe(400);
    expect(mocks.writes).toEqual([]);
  });
  it("verifies adset ownership with a GET and stores only an internal correction", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "456", account_id: "123" })),
      );
    vi.stubGlobal("fetch", fetcher);
    expect((await PATCH(request(role))).status).toBe(200);
    expect(mocks.writes[0]).toMatchObject({
      table: "marketing_adset_roles",
      data: {
        store_id: 1,
        account_id: "123",
        adset_id: "456",
        role: "control",
      },
    });
    expect(String(fetcher.mock.calls[0][0])).not.toContain("private-fixture");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer private-fixture" },
      redirect: "error",
    });
    expect(fetcher.mock.calls[0][1].method).toBeUndefined();
  });
  it("rejects a foreign Meta adset and never writes or pauses it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "456", account_id: "999" })),
        ),
    );
    expect((await PATCH(request(role))).status).toBe(400);
    expect(mocks.writes).toEqual([]);
  });
  it("removes only the selected override when returning to automatic detection", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "456", account_id: "123" })),
        ),
    );
    expect((await PATCH(request({ ...role, role: "auto" }))).status).toBe(200);
    expect(mocks.writes[0]).toMatchObject({
      action: "delete",
      filters: [
        ["store_id", 1],
        ["account_id", "123"],
        ["adset_id", "456"],
      ],
    });
  });
  it("blocks writes in read-only mode and hides database errors", async () => {
    mocks.actor.permisos = ["marketing", "solo_lectura"];
    expect((await PATCH(request(config))).status).toBe(403);
    mocks.actor.permisos = ["marketing"];
    mocks.failed = true;
    const response = await PATCH(request(config));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private database error",
    );
  });
});
