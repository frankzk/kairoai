// "Pasar a COST CAP": la ruta entera (permiso, validación, lectura de Meta,
// reserva en el registro de cambios y la ÚNICA escritura permitida) contra un
// Graph y una base simulados. El Graph simulado rechaza cualquier petición que
// no sea una lectura por los bordes de la cuenta o un POST a /ads o
// /adcreatives, y comprueba que el token nunca viaje en la URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cumple, exigenciaDe } from "../lib/permisos";
import { MOVE_TEXT } from "../lib/marketing-cost-cap-move";
import { parseDoneMark } from "../lib/marketing-decisions";
import type { MarketingFamily } from "../lib/marketing-product-families";
import type { CampaignProduct } from "../lib/marketing-settings-types";

const TOKEN = "private-meta-token";
const PROVIDER_TEXT = "Invalid parameter: creative 700 belongs to Page 100200";

type DbRow = Record<string, unknown> & { id: number };
const mocks = vi.hoisted(() => ({
  identity: null as null | {
    id: number;
    nombre: string;
    permisos: string[];
    tiendas: string[];
  },
  families: [] as unknown[],
  familyDataError: undefined as string | undefined,
  mappings: [] as unknown[],
  catalogReads: 0,
  db: {
    rows: [] as Array<Record<string, unknown> & { id: number }>,
    seq: 0,
    /** Devuelve true para simular que esa operación falla. */
    fail: null as null | ((table: string, op: string) => boolean),
  },
}));

vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (params: URLSearchParams) =>
    params.get("store") === "mireva-cr" ? { id: 71, code: "mireva-cr" } : null,
}));
vi.mock("@/lib/tiktok-diario", () => ({ anunciantesTiktok: async () => [] }));
vi.mock("@/lib/marketing-data", () => ({
  getMarketingData: async () => {
    mocks.catalogReads++;
    return {
      productFamilies: mocks.families,
      familyDataError: mocks.familyDataError,
    };
  },
}));
vi.mock("@/lib/marketing-product-groups-db", () => ({
  readMarketingVariantMappings: async () => mocks.mappings,
  readMarketingProductCatalog: async () => [],
}));
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (table: string) => {
      const state = {
        op: "select",
        value: undefined as Record<string, unknown> | undefined,
        filters: [] as Array<(row: DbRow) => boolean>,
        single: false,
      };
      const run = () => {
        if (mocks.db.fail?.(table, state.op))
          return { data: null, error: { message: "db down" } };
        if (table !== "marketing_campaign_changes")
          return { data: [], error: null };
        const match = (row: DbRow) => state.filters.every((f) => f(row));
        if (state.op === "insert") {
          const row = { id: ++mocks.db.seq, ...state.value } as DbRow;
          mocks.db.rows.push(row);
          return { data: state.single ? row : [row], error: null };
        }
        const found = mocks.db.rows.filter(match).sort((a, b) => a.id - b.id);
        if (state.op === "update")
          found.forEach((row) => Object.assign(row, state.value));
        if (state.op === "delete")
          mocks.db.rows = mocks.db.rows.filter((row) => !match(row));
        return {
          data: state.single ? (found[0] ?? null) : found,
          error: state.single && !found[0] ? { message: "no rows" } : null,
        };
      };
      const query = {
        select: () => query,
        insert: (value: Record<string, unknown>) => {
          state.op = "insert";
          state.value = value;
          return query;
        },
        update: (value: Record<string, unknown>) => {
          state.op = "update";
          state.value = value;
          return query;
        },
        delete: () => {
          state.op = "delete";
          return query;
        },
        eq: (key: string, value: unknown) => {
          state.filters.push((row) => String(row[key]) === String(value));
          return query;
        },
        like: (key: string, pattern: string) => {
          const needle = pattern.replace(/^%|%$/g, "");
          state.filters.push((row) => String(row[key]).includes(needle));
          return query;
        },
        gte: (key: string, value: string) => {
          state.filters.push((row) => String(row[key]) >= value);
          return query;
        },
        order: () => query,
        limit: () => query,
        range: () => query,
        single: () => {
          state.single = true;
          return query;
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(run()).then(resolve, reject),
      };
      return query;
    },
  }),
}));

import * as route from "../app/api/marketing/cost-cap-move/route";
import { clearMoveCaches } from "../lib/marketing-cost-cap-move-server";

/* ------------------------------------------------------ Graph simulado */

type Json = Record<string, unknown>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const metaError = (code: number, status = 400, extra: Json = {}) =>
  json(
    {
      error: {
        message: `${PROVIDER_TEXT} (token ${TOKEN})`,
        type: "OAuthException",
        code,
        fbtrace_id: "AbCdEf",
        ...extra,
      },
    },
    status,
  );

interface Post {
  account: string;
  edge: string;
  params: Record<string, string>;
}
function world() {
  const campaign = (id: string, name: string, extra: Json = {}) => ({
    id,
    name,
    effective_status: "ACTIVE",
    bid_strategy: /COST CAP/.test(name)
      ? "COST_CAP"
      : "LOWEST_COST_WITHOUT_CAP",
    ...extra,
  });
  const adset = (
    id: string,
    campaign_id: string,
    name: string,
    extra: Json = {},
  ) => ({
    id,
    name,
    campaign_id,
    effective_status: "ACTIVE",
    bid_amount: "600",
    bid_strategy: "COST_CAP",
    daily_budget: "5000",
    optimization_goal: "OFFSITE_CONVERSIONS",
    ...extra,
  });
  return {
    accounts: {
      "111": { name: "Arqui Nexo DC003", account_status: 1 },
      "222": { name: "Arqui Nexo DC003 CR4", account_status: 1 },
      // Desactivada: tiene una COST CAP del producto, pero nunca se ofrece.
      "333": { name: "Mireva CR2", account_status: 2 },
    } as Record<string, { name: string; account_status: number } | null>,
    campaigns: {
      "111": [
        campaign("10", "CBO BATANA OIL | CR"),
        campaign("12", "CBO LURE HER PERFUME | CR"),
        campaign("20", "COST CAP BATANA OIL | CR"),
        campaign("21", "COST CAP Lure Her Perfume 1210 | CR"),
      ],
      "222": [campaign("31", "CBO GOMITAS | CR4")],
      "333": [campaign("40", "COST CAP BATANA OIL | CR2")],
    } as Record<string, Json[]>,
    adsets: {
      "111": [
        adset("50", "10", "CBO abierto", {
          bid_amount: undefined,
          bid_strategy: undefined,
        }),
        adset("60", "20", "Abierto 18-65"),
        adset("65", "21", "Lure abierto"),
      ],
      "222": [],
      "333": [adset("80", "40", "CR2 abierto")],
    } as Record<string, Json[]>,
    ads: {
      "111": [
        {
          id: "900",
          name: "VIDEO 03 | Testimonio Ana",
          status: "ACTIVE",
          effective_status: "ACTIVE",
          adset_id: "50",
          campaign_id: "10",
          creative: {
            id: "700",
            effective_object_story_id: "100200_300400",
            url_tags: "utm_source=facebook&utm_campaign={{campaign.id}}",
          },
        },
      ],
      "222": [],
      "333": [],
    } as Record<string, Json[]>,
    insights: {
      "111": [{ campaign_id: "20", adset_id: "60", spend: "40.5" }],
    } as Record<string, Json[]>,
    /** creativo → cuenta y publicación (un creativo no sirve en otra cuenta). */
    creatives: { "700": { account: "111", post: "100200_300400" } } as Record<
      string,
      { account: string; post: string }
    >,
    next: 9000,
    /** Meta ya creó el anuncio pero todavía no lo lista. */
    lag: false,
    onPost: null as null | ((post: Post) => Response | undefined),
    gets: [] as Array<{
      account: string;
      edge: string;
      params: URLSearchParams;
    }>,
    posts: [] as Post[],
  };
}
let graph = world();

const inValues = (params: URLSearchParams) => {
  const raw = params.get("filtering");
  if (!raw) return null;
  const [filter] = JSON.parse(raw) as Array<{
    field: string;
    operator: string;
    value: string[];
  }>;
  expect(filter.operator).toBe("IN");
  return filter;
};

/** Para simular que Meta rechaza una lectura concreta. */
let onGet:
  | null
  | ((call: {
      account: string;
      edge: string;
      params: URLSearchParams;
    }) => Response | undefined) = null;
const graphFetch = async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = new URL(String(input));
  expect(url.origin).toBe("https://graph.facebook.com");
  // El token solo va en la cabecera; nunca la consulta multi-id.
  expect(String(input)).not.toContain(TOKEN);
  expect(url.searchParams.has("ids")).toBe(false);
  expect(url.searchParams.has("access_token")).toBe(false);
  expect((init?.headers as Record<string, string>).Authorization).toBe(
    `Bearer ${TOKEN}`,
  );
  expect(init?.redirect).toBe("error");
  const match = /^\/v24\.0\/act_(\d+)(?:\/(\w+))?$/.exec(url.pathname);
  expect(match, url.pathname).not.toBeNull();
  const account = match![1],
    edge = match![2] ?? "";
  const method = init?.method ?? "GET";
  if (method === "POST") {
    // Lo ÚNICO que Kairo puede escribir: un anuncio o un creativo.
    expect(["ads", "adcreatives"]).toContain(edge);
    expect(String(init?.body)).not.toContain(TOKEN);
    const params = Object.fromEntries(new URLSearchParams(String(init?.body)));
    const post = { account, edge, params };
    graph.posts.push(post);
    const custom = graph.onPost?.(post);
    if (custom) return custom;
    if (edge === "adcreatives") {
      const id = String(++graph.next);
      graph.creatives[id] = { account, post: params.object_story_id };
      return json({ id });
    }
    const creativeId = (JSON.parse(params.creative) as { creative_id: string })
      .creative_id;
    const creative = graph.creatives[creativeId];
    if (!creative || creative.account !== account) return metaError(100);
    const set = graph.adsets[account].find((s) => s.id === params.adset_id);
    if (!set) return metaError(100);
    const id = String(++graph.next);
    if (!graph.lag)
      graph.ads[account].push({
        id,
        name: params.name,
        status: params.status,
        effective_status: params.status,
        adset_id: params.adset_id,
        campaign_id: set.campaign_id,
        creative: { id: creativeId, effective_object_story_id: creative.post },
      });
    return json({ id });
  }
  expect(method).toBe("GET");
  expect(init?.body).toBeUndefined();
  graph.gets.push({ account, edge, params: url.searchParams });
  const refused = onGet?.({ account, edge, params: url.searchParams });
  if (refused) return refused;
  const info = graph.accounts[account];
  if (!edge)
    return info
      ? json({ id: `act_${account}`, currency: "USD", ...info })
      : metaError(200, 403);
  const filter = inValues(url.searchParams);
  const statuses = url.searchParams.get("effective_status");
  const rows = (
    graph[edge as "campaigns" | "adsets" | "ads" | "insights"]?.[account] ?? []
  ).filter((row) => {
    if (
      statuses &&
      !(JSON.parse(statuses) as string[]).includes(String(row.effective_status))
    )
      return false;
    if (!filter) return true;
    const value =
      filter.field === "id" ||
      (filter.field === "campaign.id" && edge === "campaigns")
        ? row.id
        : filter.field === "campaign.id"
          ? row.campaign_id
          : undefined;
    return filter.value.includes(String(value));
  });
  return json({ data: rows });
};
const fetcher = vi.fn(graphFetch);

/* ------------------------------------------------------------ Helpers */

const families: MarketingFamily[] = [
  {
    key: "family:batana",
    name: "Batana Oil",
    source: "shopify",
    review: false,
    members: [{ key: "sku:bat-1", sku: "BAT-1", name: "Batana Oil" }],
  },
  {
    key: "family:lure",
    name: "Lure Her Perfume",
    source: "shopify",
    review: false,
    members: [{ key: "sku:lure-1", sku: "LURE-1", name: "Lure Her Perfume" }],
  },
];
const stored = (account_id: string, campaign_id: string): CampaignProduct => ({
  platform: "meta",
  account_id,
  campaign_id,
  product_key: "family:batana",
  product_name: "Batana Oil",
  sku: "",
  family_key: "family:batana",
  variant_scope: "all",
  variant_keys: [],
});

const URL_BASE = "https://kairo.test/api/marketing/cost-cap-move";
const get = (query = "account=111&ad=900", store = "mireva-cr") =>
  route.GET(new NextRequest(`${URL_BASE}?store=${store}&${query}`));
const post = (body: unknown, store = "mireva-cr") =>
  route.POST(
    new NextRequest(`${URL_BASE}?store=${store}`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const MOVE = {
  store: "mireva-cr",
  account: "111",
  ad: "900",
  targetAccount: "111",
  adset: "60",
};
const adPosts = () => graph.posts.filter((p) => p.edge === "ads");
const creativePosts = () => graph.posts.filter((p) => p.edge === "adcreatives");
/** Agrega la COST CAP del producto en la otra cuenta activa (CR4). */
function addCr4() {
  graph.campaigns["222"].push({
    id: "30",
    name: "COST CAP BATANA OIL | CR4",
    effective_status: "ACTIVE",
    bid_strategy: "COST_CAP",
  });
  graph.adsets["222"].push({
    id: "70",
    name: "CR4 abierto",
    campaign_id: "30",
    effective_status: "ACTIVE",
    bid_amount: "550",
    daily_budget: "8000",
  });
  mocks.mappings = [stored("222", "30")];
}
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("META_CR_AD_ACCOUNT_IDS", "111,222,333");
  vi.stubEnv("META_CR_GRAPH_VERSION", "v24.0");
  vi.stubEnv("META_CR_ACCESS_TOKEN", TOKEN);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockClear();
  onGet = null;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  graph = world();
  mocks.identity = {
    id: 7,
    nombre: "Ana",
    permisos: ["marketing"],
    tiendas: ["mireva-cr"],
  };
  mocks.families = families;
  mocks.familyDataError = undefined;
  mocks.mappings = [];
  mocks.catalogReads = 0;
  mocks.db.rows = [];
  mocks.db.seq = 0;
  mocks.db.fail = null;
  clearMoveCaches();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  warn.mockRestore();
});

/* -------------------------------------------------------------- Pruebas */

describe("permisos y validación", () => {
  it("expone solo GET y POST, con el permiso de Marketing", () => {
    expect(
      Object.keys(route)
        .filter((key) => /^[A-Z]+$/.test(key))
        .sort(),
    ).toEqual(["GET", "POST"]);
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(60);
    for (const method of ["GET", "POST"]) {
      const needs = exigenciaDe("/api/marketing/cost-cap-move", method);
      expect(cumple(needs, ["marketing"])).toBe(true);
      expect(cumple(needs, ["finanzas"])).toBe(false);
      expect(cumple(needs, ["pedidos", "leads"])).toBe(false);
      expect(cumple(needs, [])).toBe(false);
    }
  });

  it("sin Marketing, sin la tienda o en otra tienda: 403 sin tocar Meta ni la base", async () => {
    const cases = [
      null,
      { id: 7, nombre: "Ana", permisos: ["finanzas"], tiendas: ["mireva-cr"] },
      { id: 7, nombre: "Ana", permisos: ["marketing"], tiendas: ["mireva-hn"] },
    ];
    for (const identity of cases) {
      mocks.identity = identity;
      expect((await get()).status).toBe(403);
      expect((await post(MOVE)).status).toBe(403);
    }
    mocks.identity = {
      id: 7,
      nombre: "Ana",
      permisos: ["marketing"],
      tiendas: ["mireva-cr"],
    };
    expect((await get(undefined, "mireva-hn")).status).toBe(403);
    expect((await post(MOVE, "mireva-hn")).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.db.rows).toEqual([]);
  });

  it("escribir exige poder editar Marketing: solo lectura ve la vista previa pero no crea", async () => {
    mocks.identity = {
      id: 9,
      nombre: "Lectura",
      permisos: ["marketing", "solo_lectura"],
      tiendas: ["mireva-cr"],
    };
    expect((await get()).status).toBe(200);
    const denied = await post(MOVE);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "No tienes permiso para modificar Marketing.",
    });
    expect(graph.posts).toEqual([]);
    expect(mocks.db.rows).toEqual([]);
  });

  it("solo ids numéricos, de una cuenta configurada y de esta tienda", async () => {
    for (const query of [
      "account=111",
      "ad=900",
      "account=1x&ad=900",
      'account=111&ad=9"]}',
    ])
      expect((await get(encodeURI(query))).status, query).toBe(400);
    expect((await get("account=999&ad=900")).status).toBe(400);
    for (const body of [
      "no-json",
      { ...MOVE, adset: "60,61" },
      { ...MOVE, targetAccount: undefined },
      { ...MOVE, ad: 900 },
      { ...MOVE, store: "mireva-hn" },
    ])
      expect((await post(body)).status).toBe(400);
    expect((await post({ ...MOVE, account: "999" })).status).toBe(400);
    expect(graph.posts).toEqual([]);
    expect(mocks.db.rows).toEqual([]);
  });
});

describe("GET: vista previa leída en vivo", () => {
  it("un destino y un conjunto: todo lo necesario para confirmar, sin el token", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.blocked).toBeNull();
    expect(body.source).toEqual({
      accountId: "111",
      accountName: "Arqui Nexo DC003",
      adId: "900",
      name: "VIDEO 03 | Testimonio Ana",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      campaignId: "10",
      campaignName: "CBO BATANA OIL | CR",
      creativeId: "700",
      postId: "100200_300400",
      product: "Batana Oil",
    });
    expect(body.destinations).toEqual([
      {
        accountId: "111",
        accountName: "Arqui Nexo DC003",
        currency: "USD",
        sameAccount: true,
        campaignId: "20",
        campaignName: "COST CAP BATANA OIL | CR",
        spend: 40.5,
        adsets: [
          {
            id: "60",
            name: "Abierto 18-65",
            campaignId: "20",
            effectiveStatus: "ACTIVE",
            bidAmount: 6,
            bidStrategy: "COST_CAP",
            dailyBudget: 50,
            optimizationGoal: "OFFSITE_CONVERSIONS",
            spend: 40.5,
          },
        ],
        suggestedAdsetId: "60",
        duplicate: null,
        blocked: null,
      },
    ]);
    expect(body.suggested).toEqual({
      accountId: "111",
      campaignId: "20",
      adsetId: "60",
    });
    expect(body.newAdName).toBe("VIDEO 03 | Testimonio Ana");
    // La cuenta desactivada se nombra como omitida, nunca como destino.
    expect(body.skippedAccounts).toEqual([
      {
        accountId: "333",
        name: "Mireva CR2",
        reason: "Cuenta desactivada en Meta.",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    // Solo lecturas, y a la cuenta desactivada solo se le pregunta su estado.
    expect(graph.posts).toEqual([]);
    expect(
      graph.gets.filter((g) => g.account === "333").map((g) => g.edge),
    ).toEqual([""]);
    expect(
      graph.gets
        .filter((g) => !g.edge)
        .every(
          (g) => g.params.get("fields") === "id,name,account_status,currency",
        ),
    ).toBe(true);
    const sourceRead = graph.gets.find(
      (g) => g.edge === "ads" && g.params.get("filtering")?.includes('"id"'),
    )!;
    expect(sourceRead.account).toBe("111");
    expect(JSON.parse(sourceRead.params.get("filtering")!)).toEqual([
      { field: "id", operator: "IN", value: ["900"] },
    ]);
    expect(sourceRead.params.get("fields")).toContain(
      "creative{id,effective_object_story_id",
    );
    const sets = graph.gets.find((g) => g.edge === "adsets")!;
    expect(JSON.parse(sets.params.get("filtering")!)).toEqual([
      { field: "campaign.id", operator: "IN", value: ["20"] },
    ]);
    expect(sets.params.get("fields")).toBe(
      "id,name,campaign_id,effective_status,bid_amount,bid_strategy,daily_budget,optimization_goal",
    );
    const spend = graph.gets.find((g) => g.edge === "insights")!;
    expect(spend.params.get("level")).toBe("adset");
    expect(JSON.parse(spend.params.get("time_range")!)).toEqual({
      since: body.window.from,
      until: body.window.to,
    });
  });

  it("el producto no tiene COST CAP activa: lo dice y no ofrece nada (la de la cuenta desactivada no cuenta)", async () => {
    graph.campaigns["111"] = graph.campaigns["111"].filter(
      (c) => c.id !== "20",
    );
    const body = await (await get()).json();
    expect(body.blocked).toBe(MOVE_TEXT.noDestination);
    expect(body.destinations).toEqual([]);
    expect(body.suggested).toBeNull();
    expect(body.source.product).toBe("Batana Oil");
    // Pausada tampoco sirve.
    graph = world();
    graph.campaigns["111"].find((c) => c.id === "20")!.effective_status =
      "PAUSED";
    expect((await (await get()).json()).blocked).toBe(MOVE_TEXT.noDestination);
  });

  it("varios conjuntos: los lista con puja y presupuesto, y sugiere el de más gasto", async () => {
    graph.adsets["111"].push(
      {
        id: "61",
        name: "Mujeres 25-45",
        campaign_id: "20",
        effective_status: "ACTIVE",
        bid_amount: "700",
        daily_budget: "3000",
      },
      {
        id: "62",
        name: "Pausado",
        campaign_id: "20",
        effective_status: "PAUSED",
      },
    );
    graph.insights["111"].push({
      campaign_id: "20",
      adset_id: "61",
      spend: "120",
    });
    const body = await (await get()).json();
    expect(
      body.destinations[0].adsets.map((s: Json) => [
        s.id,
        s.name,
        s.bidAmount,
        s.dailyBudget,
        s.spend,
      ]),
    ).toEqual([
      ["61", "Mujeres 25-45", 7, 30, 120],
      ["60", "Abierto 18-65", 6, 50, 40.5],
    ]);
    expect(body.suggested.adsetId).toBe("61");
    // Sin lectura de gasto igual se puede elegir.
    graph.insights = {};
    graph.accounts["111"] = { name: "Arqui Nexo DC003", account_status: 1 };
    const blind = await (await get()).json();
    expect(blind.blocked).toBeNull();
    expect(blind.destinations[0].adsets).toHaveLength(2);
  });

  it("varios destinos: una COST CAP por cuenta activa, con el nombre de la cuenta; primero la del anuncio", async () => {
    addCr4();
    const body = await (await get()).json();
    expect(
      body.destinations.map((d: Json) => [
        d.accountId,
        d.accountName,
        d.campaignName,
        d.sameAccount,
      ]),
    ).toEqual([
      ["111", "Arqui Nexo DC003", "COST CAP BATANA OIL | CR", true],
      ["222", "Arqui Nexo DC003 CR4", "COST CAP BATANA OIL | CR4", false],
    ]);
    expect(body.destinations[1].adsets[0]).toMatchObject({
      id: "70",
      bidAmount: 5.5,
      dailyBudget: 80,
    });
    expect(body.suggested).toEqual({
      accountId: "111",
      campaignId: "20",
      adsetId: "60",
    });
    // La cuenta desactivada sigue sin ofrecerse aunque tenga la campaña.
    expect(body.destinations.some((d: Json) => d.accountId === "333")).toBe(
      false,
    );
  });

  it("la publicación ya es un anuncio de esa COST CAP: «Ya está en la COST CAP»", async () => {
    graph.ads["111"].push({
      id: "950",
      name: "VIDEO 03 (copia)",
      status: "PAUSED",
      effective_status: "PAUSED",
      adset_id: "60",
      campaign_id: "20",
      creative: { id: "701", effective_object_story_id: "100200_300400" },
    });
    const body = await (await get()).json();
    expect(body.blocked).toBe("Ya está en la COST CAP.");
    expect(body.destinations[0].duplicate).toEqual({
      adId: "950",
      name: "VIDEO 03 (copia)",
    });
    expect(body.suggested).toBeNull();
  });

  it("bloquea con el motivo: sin anuncio, ya en COST CAP, sin producto, sin publicación", async () => {
    expect((await (await get("account=111&ad=12345")).json()).blocked).toBe(
      MOVE_TEXT.noAd,
    );
    graph.ads["111"][0].campaign_id = "20";
    expect((await (await get()).json()).blocked).toBe(MOVE_TEXT.alreadyCostCap);
    graph = world();
    mocks.families = [];
    clearMoveCaches();
    expect((await (await get()).json()).blocked).toBe(MOVE_TEXT.noProduct);
    mocks.families = families;
    clearMoveCaches();
    graph.ads["111"][0].creative = { id: "700" };
    expect((await (await get()).json()).blocked).toBe(MOVE_TEXT.noPost);
  });

  it("si Meta no deja leer el anuncio, error genérico (sin el texto del proveedor)", async () => {
    onGet = (call) => (call.edge === "ads" ? metaError(190, 400) : undefined);
    const response = await get();
    expect(response.status).toBe(502);
    const text = JSON.stringify(await response.json());
    expect(text).toBe(
      '{"error":"No se pudo leer el anuncio en Meta. Vuelve a intentarlo."}',
    );
    expect(text).not.toContain(TOKEN);
  });

  it("campaña de origen pausada: se lee por el borde de la cuenta (con el filtro `id` si hace falta)", async () => {
    graph.campaigns["111"].find((c) => c.id === "10")!.effective_status =
      "PAUSED";
    const body = await (await get()).json();
    expect(body.source.campaignName).toBe("CBO BATANA OIL | CR");
    expect(body.blocked).toBeNull();
    const filtered = () =>
      graph.gets
        .filter((g) => g.edge === "campaigns" && g.params.has("filtering"))
        .map((g) => JSON.parse(g.params.get("filtering")!)[0].field);
    expect(filtered()).toEqual(["campaign.id"]);
    // Meta rechaza `campaign.id` en el borde de campañas: se repite con `id`.
    graph.gets = [];
    onGet = (call) =>
      call.edge === "campaigns" &&
      call.params.get("filtering")?.includes("campaign.id")
        ? metaError(100)
        : undefined;
    expect((await (await get()).json()).source.campaignId).toBe("10");
    expect(filtered()).toEqual(["campaign.id", "id"]);
  });

  it("una cuenta que no se puede leer no se ofrece y no tumba a las demás", async () => {
    addCr4();
    graph.accounts["222"] = null;
    const body = await (await get()).json();
    expect(body.destinations.map((d: Json) => d.accountId)).toEqual(["111"]);
    expect(body.skippedAccounts.map((a: Json) => a.accountId).sort()).toEqual([
      "222",
      "333",
    ]);
    expect(JSON.stringify(body)).not.toContain("Invalid parameter");
    // Sus campañas ni se piden.
    expect(
      graph.gets.filter((g) => g.account === "222").map((g) => g.edge),
    ).toEqual([""]);
  });

  it("el catálogo se lee una vez; las asignaciones, cada vez", async () => {
    await get();
    await get();
    expect(mocks.catalogReads).toBe(1);
  });
});

describe("POST: crear el anuncio en la COST CAP", () => {
  it("misma cuenta: reutiliza el creativo, activo, y deja el «Hecho» con quién, cuándo y el anuncio nuevo", async () => {
    const before = Date.now();
    const response = await post(MOVE);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      created: true,
      adId: "9001",
      adName: "VIDEO 03 | Testimonio Ana",
      method: "creative",
      destination: {
        accountId: "111",
        accountName: "Arqui Nexo DC003",
        campaignId: "20",
        campaignName: "COST CAP BATANA OIL | CR",
        adsetId: "60",
        adsetName: "Abierto 18-65",
      },
    });
    expect(body.warning).toBeUndefined();
    // La única escritura: un anuncio en el conjunto elegido.
    expect(graph.posts).toEqual([
      {
        account: "111",
        edge: "ads",
        params: {
          name: "VIDEO 03 | Testimonio Ana",
          adset_id: "60",
          creative: '{"creative_id":"700"}',
          status: "ACTIVE",
        },
      },
    ]);
    // Registro de cambios: una sola línea, la del "Hecho", en la campaña de ORIGEN.
    expect(mocks.db.rows).toHaveLength(1);
    const row = mocks.db.rows[0];
    expect(row).toMatchObject({
      store_id: 71,
      platform: "meta",
      account_id: "111",
      campaign_id: "10",
      campaign_name: "CBO BATANA OIL | CR",
      product_key: "family:batana",
      kind: "creativo",
      created_by: "7:Ana",
      detail:
        "Hecho en Acciones (costcap:900): post 100200_300400 · camp 20 · conj 60 · nuevo 9001",
    });
    expect(Date.parse(String(row.changed_at))).toBeGreaterThanOrEqual(before);
    expect(body.change).toMatchObject({
      platform: "meta",
      accountId: "111",
      campaignId: "10",
      kind: "creativo",
      source: "manual",
      by: "Ana",
      detail: row.detail,
    });
    // Acciones lo lee como "Hecho" de ese anuncio, con el anuncio nuevo.
    expect(parseDoneMark(body.change)).toMatchObject({
      action: "costcap",
      adId: "900",
      newAdId: "9001",
      by: "Ana",
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("si Meta rechaza el creativo reutilizado, una sola vez crea el creativo desde la publicación", async () => {
    graph.onPost = (p) =>
      p.edge === "ads" && p.params.creative.includes('"700"')
        ? metaError(100)
        : undefined;
    const response = await post(MOVE);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ created: true, method: "post", adId: "9002" });
    expect(graph.posts.map((p) => [p.account, p.edge])).toEqual([
      ["111", "ads"],
      ["111", "adcreatives"],
      ["111", "ads"],
    ]);
    // El creativo nuevo: la misma publicación y los mismos parámetros de URL.
    expect(graph.posts[1].params).toEqual({
      object_story_id: "100200_300400",
      url_tags: "utm_source=facebook&utm_campaign={{campaign.id}}",
    });
    expect(graph.posts[2].params).toEqual({
      name: "VIDEO 03 | Testimonio Ana",
      adset_id: "60",
      creative: '{"creative_id":"9001"}',
      status: "ACTIVE",
    });
    expect(mocks.db.rows.map((r) => r.detail)).toEqual([
      "Hecho en Acciones (costcap:900): post 100200_300400 · camp 20 · conj 60 · nuevo 9002",
    ]);
    // El detalle técnico va al registro del servidor, sin el token.
    const logged = warn.mock.calls
      .map((call: unknown[]) => call.join(" "))
      .join("\n");
    expect(logged).toContain("POST ads");
    expect(logged).toContain('"code":100');
    expect(logged).not.toContain(TOKEN);
  });

  it("COST CAP en otra cuenta: creativo nuevo desde la publicación en la cuenta destino, sin intentar el creativo ajeno", async () => {
    addCr4();
    const response = await post({ ...MOVE, targetAccount: "222", adset: "70" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      created: true,
      method: "post",
      destination: {
        accountId: "222",
        accountName: "Arqui Nexo DC003 CR4",
        campaignId: "30",
        adsetId: "70",
      },
    });
    expect(graph.posts.map((p) => [p.account, p.edge])).toEqual([
      ["222", "adcreatives"],
      ["222", "ads"],
    ]);
    expect(graph.posts[0].params.object_story_id).toBe("100200_300400");
    expect(graph.posts[1].params).toMatchObject({
      adset_id: "70",
      creative: `{"creative_id":"${Object.keys(graph.creatives).at(-1)}"}`,
      status: "ACTIVE",
    });
    // Nada se escribió en la cuenta de origen ni con el creativo 700.
    expect(
      graph.posts.some(
        (p) => p.account === "111" || p.params.creative?.includes("700"),
      ),
    ).toBe(false);
    expect(mocks.db.rows).toHaveLength(1);
    expect(mocks.db.rows[0]).toMatchObject({
      account_id: "111",
      campaign_id: "10",
    });
    expect(mocks.db.rows[0].detail).toBe(
      `Hecho en Acciones (costcap:900): post 100200_300400 · camp 30 · conj 70 · nuevo ${body.adId} · cuenta 222`,
    );
  });

  it("si la cuenta destino no puede usar la publicación: motivo claro, sin reintento y sin rastro de «Hecho»", async () => {
    addCr4();
    graph.onPost = (p) =>
      p.edge === "adcreatives" ? metaError(100) : undefined;
    const response = await post({ ...MOVE, targetAccount: "222", adset: "70" });
    expect(response.status).toBe(422);
    const text = JSON.stringify(await response.json());
    expect(text).toBe(
      '{"error":"La cuenta destino no puede usar esta publicación.","kind":"rejected"}',
    );
    expect(graph.posts.map((p) => p.edge)).toEqual(["adcreatives"]);
    expect(mocks.db.rows).toEqual([]);
    // También cuando Meta dice que falta permiso sobre la página.
    graph.onPost = (p) =>
      p.edge === "adcreatives" ? metaError(200, 403) : undefined;
    const denied = await post({ ...MOVE, targetAccount: "222", adset: "70" });
    expect((await denied.json()).error).toBe(
      "La cuenta destino no puede usar esta publicación.",
    );
    expect(adPosts()).toEqual([]);
  });

  it("rechaza un conjunto que no es de una COST CAP activa del mismo producto en una cuenta activa", async () => {
    addCr4();
    const bad = [
      // Conjunto de la campaña CBO de origen.
      { ...MOVE, adset: "50" },
      // COST CAP de OTRO producto en la misma cuenta.
      { ...MOVE, adset: "65" },
      // Conjunto real, pero dicho en otra cuenta.
      { ...MOVE, targetAccount: "222", adset: "60" },
      // COST CAP del producto en la cuenta DESACTIVADA.
      { ...MOVE, targetAccount: "333", adset: "80" },
      // Conjunto que no existe.
      { ...MOVE, adset: "424242" },
    ];
    for (const body of bad) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect((await response.json()).error).toBe(MOVE_TEXT.badTarget);
    }
    // Conjunto pausado de la COST CAP correcta.
    graph.adsets["111"].find((s) => s.id === "60")!.effective_status = "PAUSED";
    const paused = await post(MOVE);
    expect(paused.status).toBe(422);
    // Anuncio que no es de esa cuenta.
    const foreign = await post({ ...MOVE, account: "222" });
    expect(foreign.status).toBe(422);
    expect((await foreign.json()).error).toBe(MOVE_TEXT.noAd);
    expect(graph.posts).toEqual([]);
    expect(mocks.db.rows).toEqual([]);
  });

  it("doble POST: el segundo no crea otro anuncio", async () => {
    const first = await post(MOVE);
    expect(first.status).toBe(200);
    const second = await post(MOVE);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Ya está en la COST CAP.");
    expect(adPosts()).toHaveLength(1);
    expect(mocks.db.rows).toHaveLength(1);
    // Tampoco a otro conjunto de la misma campaña: el duplicado es por campaña.
    graph.adsets["111"].push({
      id: "61",
      name: "Otro",
      campaign_id: "20",
      effective_status: "ACTIVE",
    });
    expect((await post({ ...MOVE, adset: "61" })).status).toBe(409);
    expect(adPosts()).toHaveLength(1);
  });

  it("dos clics a la vez crean un solo anuncio", async () => {
    const [a, b] = await Promise.all([post(MOVE), post(MOVE)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json()).error).toBe(MOVE_TEXT.inProgress);
    expect(adPosts()).toHaveLength(1);
    expect(mocks.db.rows).toHaveLength(1);
  });

  it("dos anuncios con la misma publicación a la vez: la reserva deja pasar solo uno", async () => {
    // Otro anuncio de la misma campaña con la MISMA publicación (otra clave en memoria).
    graph.ads["111"].push({
      ...graph.ads["111"][0],
      id: "901",
      name: "VIDEO 03 (duplicado)",
    });
    const [a, b] = await Promise.all([
      post(MOVE),
      post({ ...MOVE, ad: "901" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(adPosts()).toHaveLength(1);
    // Queda una sola línea: el "Hecho" del que ganó; la otra reserva se borró.
    expect(mocks.db.rows).toHaveLength(1);
    expect(String(mocks.db.rows[0].detail)).toMatch(
      /^Hecho en Acciones \(costcap:90[01]\)/,
    );
  });

  it("otra solicitud (otro servidor) ya reservó o ya lo creó: no escribe aunque Meta aún no lo liste", async () => {
    const recent = new Date(Date.now() - 20_000).toISOString();
    const claim = (detail: string, changed_at = recent) => {
      mocks.db.rows.push({
        id: ++mocks.db.seq,
        store_id: 71,
        platform: "meta",
        account_id: "111",
        campaign_id: "10",
        kind: "creativo",
        detail,
        changed_at,
        created_by: "8:Luis",
      });
    };
    // Reserva en curso de otra solicitud.
    claim(
      "Intento de pasar a COST CAP: post 100200_300400 · camp 20 · conj 60 · anuncio 900",
    );
    const busy = await post(MOVE);
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toBe(MOVE_TEXT.inProgress);
    expect(graph.posts).toEqual([]);
    expect(mocks.db.rows).toHaveLength(1);
    // "Hecho" de hace un momento (Meta todavía no lista el anuncio nuevo).
    mocks.db.rows = [];
    claim(
      "Hecho en Acciones (costcap:900): post 100200_300400 · camp 20 · conj 60 · nuevo 9555",
    );
    const done = await post(MOVE);
    expect(done.status).toBe(409);
    expect((await done.json()).error).toBe("Ya está en la COST CAP.");
    expect(graph.posts).toEqual([]);
    expect(mocks.db.rows).toHaveLength(1);
    // Una reserva vieja (servidor que murió a medias) ya no bloquea.
    mocks.db.rows = [];
    claim(
      "Intento de pasar a COST CAP: post 100200_300400 · camp 20 · conj 60 · anuncio 900",
      new Date(Date.now() - 5 * 60_000).toISOString(),
    );
    expect((await post(MOVE)).status).toBe(200);
    expect(adPosts()).toHaveLength(1);
  });

  it("sin poder anotar la reserva no se escribe nada en Meta", async () => {
    mocks.db.fail = (table, op) =>
      table === "marketing_campaign_changes" && op === "insert";
    const response = await post(MOVE);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/no se creó nada en Meta/);
    expect(graph.posts).toEqual([]);
  });

  it("anuncio creado pero sin poder anotar el «Hecho»: lo dice, y la reserva queda como rastro", async () => {
    mocks.db.fail = (table, op) =>
      table === "marketing_campaign_changes" && op === "update";
    const response = await post(MOVE);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ created: true, adId: "9001", change: null });
    expect(body.warning).toMatch(/no se pudo anotar/);
    expect(mocks.db.rows.map((r) => r.detail)).toEqual([
      "Intento de pasar a COST CAP: post 100200_300400 · camp 20 · conj 60 · anuncio 900",
    ]);
  });

  it("nunca reenvía el texto de Meta ni el token: motivos cortos en español", async () => {
    const cases: Array<[Response, number, string, string]> = [
      [metaError(200, 403), 502, "permission", "permiso de escritura"],
      [metaError(190, 400), 502, "token", "token de Meta"],
      [metaError(17, 400), 429, "limit", "límite de la cuenta"],
    ];
    for (const [answer, status, kind, text] of cases) {
      graph = world();
      mocks.db.rows = [];
      graph.onPost = () => answer.clone();
      const response = await post(MOVE);
      expect(response.status, kind).toBe(status);
      const raw = JSON.stringify(await response.json());
      expect(raw).toContain(text);
      expect(raw).toContain(`"kind":"${kind}"`);
      expect(raw).not.toContain(TOKEN);
      expect(raw).not.toContain("Invalid parameter");
      expect(raw).not.toContain("OAuthException");
      // Permiso, token o límite: no se insiste con otro creativo.
      expect(graph.posts.map((p) => p.edge)).toEqual(["ads"]);
      expect(mocks.db.rows).toEqual([]);
    }
    // Rechazo del creativo y luego del anuncio: "el conjunto no acepta el anuncio".
    graph = world();
    graph.onPost = (p) => (p.edge === "ads" ? metaError(100) : undefined);
    const rejected = await post(MOVE);
    expect(rejected.status).toBe(422);
    const raw = JSON.stringify(await rejected.json());
    expect(raw).toContain("no acepta este anuncio");
    expect(raw).not.toContain(TOKEN);
    expect(graph.posts.map((p) => p.edge)).toEqual([
      "ads",
      "adcreatives",
      "ads",
    ]);
    expect(mocks.db.rows).toEqual([]);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(TOKEN);
  });

  it("fallo dudoso de Meta: comprueba si el anuncio existe antes de dar el error", async () => {
    // Meta respondió 500 pero SÍ creó el anuncio.
    graph.onPost = (p) => {
      if (p.edge !== "ads") return undefined;
      graph.ads["111"].push({
        id: "9777",
        name: p.params.name,
        status: "ACTIVE",
        effective_status: "ACTIVE",
        adset_id: "60",
        campaign_id: "20",
        creative: { id: "700", effective_object_story_id: "100200_300400" },
      });
      return metaError(2, 500, { is_transient: true });
    };
    const created = await post(MOVE);
    expect(created.status).toBe(200);
    expect((await created.json()).adId).toBe("9777");
    expect(adPosts()).toHaveLength(1);
    expect(mocks.db.rows[0].detail).toContain("nuevo 9777");

    // Meta respondió 500 y no hay anuncio: error temporal, sin segundo intento,
    // y la reserva se queda para frenar reintentos inmediatos.
    graph = world();
    mocks.db.rows = [];
    graph.onPost = (p) => (p.edge === "ads" ? metaError(2, 500) : undefined);
    const failed = await post(MOVE);
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toMatch(/Error temporal de Meta/);
    expect(graph.posts.map((p) => p.edge)).toEqual(["ads"]);
    expect(mocks.db.rows.map((r) => String(r.detail).slice(0, 27))).toEqual([
      "Intento de pasar a COST CAP",
    ]);
    graph.onPost = null;
    const retry = await post(MOVE);
    expect(retry.status).toBe(409);
    expect((await retry.json()).error).toBe(MOVE_TEXT.inProgress);
    expect(adPosts()).toHaveLength(1);
  });

  it("no hay ninguna otra escritura: ni presupuestos, ni pujas, ni estados, ni campañas", async () => {
    addCr4();
    await post(MOVE);
    await post({ ...MOVE, targetAccount: "222", adset: "70" });
    for (const p of graph.posts) {
      expect(["ads", "adcreatives"]).toContain(p.edge);
      expect(Object.keys(p.params).sort()).toEqual(
        p.edge === "ads"
          ? ["adset_id", "creative", "name", "status"]
          : ["object_story_id", "url_tags"],
      );
    }
    // Todas las peticiones fueron a un borde de cuenta (el Graph simulado lo exige).
    expect(fetcher.mock.calls.length).toBeGreaterThan(10);
  });
});
