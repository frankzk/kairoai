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
  missingTables: [] as string[],
  catalog: vi.fn(),
  inputs: vi.fn(),
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 1, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/marketing-data", () => ({
  getMarketingData: mocks.catalog,
  getMarketingInputs: mocks.inputs,
}));
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
            error: mocks.missingTables.includes(table)
              ? { code: "42P01", message: "private database detail" }
              : mocks.dbError
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
  mocks.missingTables = [];
  mocks.identity = {
    id: 7,
    nombre: "Marketing CR",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  mocks.catalog.mockResolvedValue({
    catalog: [{ key: "sku:a", name: "Producto de Costa Rica", sku: "A" }],
  });
  mocks.inputs.mockResolvedValue({
    orders: [],
    summary: {
      productFamilies: [
        {
          key: "family:shopify:42",
          name: "Producto padre",
          source: "shopify",
          review: false,
          members: [
            { key: "sku:a", name: "Negro", sku: "A" },
            { key: "sku:b", name: "Beige", sku: "B" },
          ],
        },
        {
          key: "family:review:7",
          name: "En revisión",
          source: "nombre",
          review: true,
          members: [{ key: "sku:c", name: "C", sku: "C" }],
        },
      ],
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("persistent marketing settings", () => {
  it("learns a normalized alias only with an explicit manual save and can clear it", async () => {
    const payload = {
      ...mapping,
      family_key: "family:shopify:42",
      variant_scope: "all",
      learn_alias: true,
      campaign_name: "FAT BURN_CB",
      campaign_alias: "forged",
    };
    expect((await PATCH(request(payload))).status).toBe(200);
    expect(mocks.calls[0].value).toMatchObject({
      campaign_alias: "fat burn",
      store_id: 1,
      family_key: "family:shopify:42",
    });
    expect(
      (await PATCH(request({ ...payload, learn_alias: false }))).status,
    ).toBe(200);
    expect(mocks.calls[1].value).toMatchObject({ campaign_alias: null });
  });
  it.each([
    { campaign_name: "CBO Ventas | CR" },
    { campaign_name: 12 },
    { learn_alias: "true" },
    { campaign_name: "x".repeat(1001) },
  ])("rejects unlearnable alias inputs %j without writing", async (patch) => {
    const result = await PATCH(
      request({
        ...mapping,
        family_key: "family:shopify:42",
        variant_scope: "all",
        learn_alias: true,
        campaign_name: "FAT BURN_CB",
        ...patch,
      }),
    );
    expect(result.status).toBe(400);
    expect(mocks.calls).toEqual([]);
  });
  it("validates selected variants against the server family and returns a unique-order metric", async () => {
    const result = await PATCH(
      request({
        ...mapping,
        family_key: "family:shopify:42",
        variant_scope: "selected",
        variant_keys: ["sku:b", "sku:a"],
        product_name: "Forged",
      }),
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({
      saved: true,
      productMetric: {
        name: "Producto padre",
        scope: "selected",
        memberKeys: ["sku:a", "sku:b"],
        orders: 0,
      },
    });
    expect(mocks.calls[0].value).toMatchObject({
      product_name: "Producto padre",
      family_key: "family:shopify:42",
      variant_scope: "selected",
      variant_keys: ["sku:a", "sku:b"],
      store_id: 1,
    });
    expect(
      (mocks.calls[0].value as { product_key: string }).product_key,
    ).toMatch(/^selection:/);
  });
  it("supports all variants and a persistent override disabling automatic matching", async () => {
    expect(
      (
        await PATCH(
          request({
            ...mapping,
            family_key: "family:shopify:42",
            variant_scope: "all",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.calls[0].value).toMatchObject({
      product_key: "family:shopify:42",
      variant_scope: "all",
      variant_keys: [],
    });
    expect(
      (
        await PATCH(
          request({ ...mapping, product_key: null, disable_auto: true }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.calls[1].value).toMatchObject({
      product_key: "unassigned",
      variant_scope: "none",
      family_key: null,
      variant_keys: [],
    });
  });
  it.each([
    { family_key: "family:foreign", variant_scope: "all" },
    {
      family_key: "family:shopify:42",
      variant_scope: "selected",
      variant_keys: [],
    },
    {
      family_key: "family:shopify:42",
      variant_scope: "selected",
      variant_keys: ["sku:foreign"],
    },
    { family_key: "family:shopify:42", variant_scope: "unknown" },
  ])(
    "rejects invalid parent/variant mapping %j without writes",
    async (patch) => {
      expect((await PATCH(request({ ...mapping, ...patch }))).status).toBe(400);
      expect(mocks.calls).toEqual([]);
    },
  );
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
    expect(await result.json()).toEqual({
      mappings: [],
      plans: [],
      keywords: [],
      accountLabels: [],
    });
    expect(mocks.calls.map((call) => call.table)).toEqual([
      "marketing_campaign_products",
      "marketing_product_plans",
      "marketing_campaign_keywords",
      "marketing_ad_account_labels",
    ]);
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
  it("normalizes campaign keywords, validates the family on the server and deletes with null", async () => {
    const saved = await PATCH(
      request({
        kind: "keyword",
        keyword: "NEOCELL ",
        family_key: "family:shopify:42",
      }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ saved: true, keyword: "neocell" });
    expect(mocks.calls).toEqual([
      expect.objectContaining({
        table: "marketing_campaign_keywords",
        operation: "upsert",
        value: expect.objectContaining({
          store_id: 1,
          keyword: "neocell",
          family_key: "family:shopify:42",
          product_name: "Producto padre",
          updated_by: "7:Marketing CR",
        }),
      }),
    ]);
    mocks.calls.length = 0;
    expect(
      (
        await PATCH(
          request({
            kind: "keyword",
            keyword: "Colágeno",
            family_key: "family:shopify:99",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PATCH(
          request({
            kind: "keyword",
            keyword: "ab",
            family_key: "family:shopify:42",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.calls).toEqual([]);
    expect(
      (
        await PATCH(
          request({
            kind: "keyword",
            keyword: "Shilajit  Cápsulas",
            family_key: null,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.calls[0]).toMatchObject({
      table: "marketing_campaign_keywords",
      operation: "delete",
      filters: [
        ["store_id", 1],
        ["keyword", "shilajit capsulas"],
      ],
    });
  });
  it("rejects keywords that can never match and families under review", async () => {
    const noise = await PATCH(
      request({
        kind: "keyword",
        keyword: "selerb cap",
        family_key: "family:shopify:42",
      }),
    );
    expect(noise.status).toBe(400);
    expect((await noise.json()).error).toBe(
      "Quita «CAP»: no cuenta al leer el nombre de la campaña.",
    );
    const review = await PATCH(
      request({
        kind: "keyword",
        keyword: "selerb",
        family_key: "family:review:7",
      }),
    );
    expect(review.status).toBe(400);
    expect((await review.json()).error).toContain("en revisión");
    expect(mocks.calls).toEqual([]);
  });
  it("saves and clears account labels only for configured accounts", async () => {
    expect(
      (
        await PATCH(
          request({
            kind: "account_label",
            platform: "meta",
            account_id: "123",
            label: " Madre ",
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.calls[0]).toMatchObject({
      table: "marketing_ad_account_labels",
      operation: "upsert",
      value: {
        store_id: 1,
        platform: "meta",
        account_id: "123",
        label: "Madre",
      },
    });
    mocks.calls.length = 0;
    expect(
      (
        await PATCH(
          request({
            kind: "account_label",
            platform: "meta",
            account_id: "999",
            label: "CR2",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await PATCH(
          request({
            kind: "account_label",
            platform: "meta",
            account_id: "123",
            label: "x".repeat(21),
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.calls).toEqual([]);
    expect(
      (
        await PATCH(
          request({
            kind: "account_label",
            platform: "meta",
            account_id: "123",
            label: null,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.calls[0]).toMatchObject({ operation: "delete" });
    mocks.identity.permisos = ["marketing", "solo_lectura"];
    expect(
      (
        await PATCH(
          request({
            kind: "account_label",
            platform: "meta",
            account_id: "123",
            label: "CR2",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("keeps settings usable when the keyword tables are not migrated yet", async () => {
    mocks.missingTables = ["marketing_campaign_keywords"];
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      keywords: [],
      keywordsError: expect.stringContaining("Pendiente"),
    });
    const saved = await PATCH(
      request({
        kind: "keyword",
        keyword: "neocell",
        family_key: "family:shopify:42",
      }),
    );
    expect(saved.status).toBe(503);
    expect((await saved.json()).error).toContain("Pendiente");
  });
});
