import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  identity: {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  } as {
    id: number;
    nombre: string;
    permisos: string[];
    tiendas: string[];
  },
  calls: [] as Array<{
    table: string;
    op: string;
    value?: unknown;
    filters: Array<[string, unknown]>;
  }>,
  rows: [] as Array<Record<string, unknown>>,
  error: null as null | { code?: string; message: string },
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/tiktok-diario", () => ({
  anunciantesTiktok: async () => ["7557137680941973521"],
}));
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (table: string) => {
      const call = {
        table,
        op: "",
        value: undefined as unknown,
        filters: [] as Array<[string, unknown]>,
      };
      mocks.calls.push(call);
      const query = {
        select: () => {
          call.op ||= "select";
          return query;
        },
        insert: (value: unknown) => {
          call.op = "insert";
          call.value = value;
          return query;
        },
        delete: () => {
          call.op = "delete";
          return query;
        },
        single: () => query,
        eq: (key: string, value: unknown) => {
          call.filters.push([key, value]);
          return query;
        },
        gte: (key: string, value: unknown) => {
          call.filters.push([key, value]);
          return query;
        },
        order: () => query,
        range: () => query,
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(
            mocks.error
              ? { data: null, error: mocks.error }
              : call.op === "insert"
                ? { data: { id: 42, ...(call.value as object) }, error: null }
                : { data: mocks.rows, error: null },
          ).then(resolve, reject),
      };
      return query;
    },
  }),
}));
import { DELETE, GET, POST } from "../app/api/marketing/changes/route";

const url = (query = "") =>
  `https://kairo.test/api/marketing/changes?store=mireva-cr${query}`;
const post = (body: unknown) =>
  new NextRequest(url(), { method: "POST", body: JSON.stringify(body) });
const change = {
  platform: "meta",
  account_id: "123",
  campaign_id: "1001",
  campaign_name: "CBO NEOCELL | CR",
  kind: "presupuesto",
  detail: "50 → 60",
};

beforeEach(() => {
  vi.stubEnv("META_CR_AD_ACCOUNT_IDS", "123");
  vi.stubEnv("TIKTOK_CR_ADVERTISER_ID", "");
  mocks.identity = {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  mocks.calls.length = 0;
  mocks.rows = [];
  mocks.error = null;
});

describe("manual change log", () => {
  it("lists recent manual changes scoped to the store with the author name only", async () => {
    mocks.rows = [
      {
        id: 5,
        platform: "tiktok",
        account_id: "7557137680941973521",
        campaign_id: "1859065142442017",
        campaign_name: "HER LOSS",
        product_key: "family:shopify:1",
        kind: "lanzamiento",
        detail: "",
        changed_at: "2026-11-05T14:00:00+00:00",
        created_by: "7:Ana",
      },
    ];
    const result = await GET(new NextRequest(url("&days=7")));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({
      status: "ok",
      changes: [
        {
          platform: "tiktok",
          accountId: "7557137680941973521",
          campaignId: "1859065142442017",
          at: "2026-11-05T14:00:00.000Z",
          kind: "lanzamiento",
          detail: "",
          source: "manual",
          id: "5",
          by: "Ana",
          campaignName: "HER LOSS",
          productKey: "family:shopify:1",
        },
      ],
    });
    expect(mocks.calls[0].filters).toContainEqual(["store_id", 1]);
    expect((await GET(new NextRequest(url("&days=0")))).status).toBe(400);
  });

  it("saves a change with the audit author and defaults the date to now", async () => {
    const before = Date.now();
    const result = await POST(
      post({ ...change, created_by: "forged", store_id: 2 }),
    );
    expect(result.status).toBe(200);
    const saved = mocks.calls[0].value as Record<string, unknown>;
    expect(saved).toMatchObject({
      store_id: 1,
      platform: "meta",
      account_id: "123",
      campaign_id: "1001",
      kind: "presupuesto",
      detail: "50 → 60",
      created_by: "7:Ana",
      product_key: null,
    });
    expect(Date.parse(String(saved.changed_at))).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect((await result.json()).change).toMatchObject({
      id: "42",
      source: "manual",
      by: "Ana",
    });
  });

  it("accepts TikTok advertisers seen from Make", async () => {
    expect(
      (
        await POST(
          post({
            ...change,
            platform: "tiktok",
            account_id: "7557137680941973521",
            kind: "lanzamiento",
          }),
        )
      ).status,
    ).toBe(200);
  });

  it.each([
    [{ changed_at: new Date(Date.now() + 60 * 60_000).toISOString() }],
    [{ changed_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }],
    [{ changed_at: "ayer" }],
    [{ account_id: "999" }],
    [{ campaign_id: "abc" }],
    [{ kind: "otra cosa" }],
    [{ detail: "x".repeat(201) }],
    [{ product_key: "abc" }],
  ])("rejects invalid input %j without writing", async (patch) => {
    expect((await POST(post({ ...change, ...patch }))).status).toBe(400);
    expect(mocks.calls.filter((c) => c.op === "insert")).toEqual([]);
  });

  it("refuses writes for read-only users and other stores", async () => {
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    expect((await POST(post(change))).status).toBe(403);
    expect(
      (await DELETE(new NextRequest(url("&id=5"), { method: "DELETE" })))
        .status,
    ).toBe(403);
    mocks.identity.permisos = ["marketing"];
    mocks.identity.tiendas = ["mireva-hn"];
    expect((await GET(new NextRequest(url()))).status).toBe(403);
    expect(mocks.calls).toEqual([]);
  });

  it("deletes by id inside the store", async () => {
    expect(
      (await DELETE(new NextRequest(url("&id=5"), { method: "DELETE" })))
        .status,
    ).toBe(200);
    expect(mocks.calls[0]).toMatchObject({
      op: "delete",
      filters: [
        ["store_id", 1],
        ["id", "5"],
      ],
    });
    expect(
      (await DELETE(new NextRequest(url("&id=x"), { method: "DELETE" })))
        .status,
    ).toBe(400);
  });

  it("reports a pending migration without database details", async () => {
    mocks.error = { code: "42P01", message: "private detail" };
    const read = await GET(new NextRequest(url()));
    expect(await read.json()).toMatchObject({
      status: "pending_migration",
      changes: [],
    });
    const write = await POST(post(change));
    expect(write.status).toBe(503);
    expect(JSON.stringify(await write.json())).not.toContain("private detail");
  });
});
