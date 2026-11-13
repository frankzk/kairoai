import { describe, expect, it } from "vitest";
import {
  buildBrokenItems,
  buildProductHighlights,
  dailyRealSeries,
  periodProjection,
  unavailableMetaNames,
  type BrokenInput,
  type HighlightCampaign,
} from "../lib/marketing-resumen";
import {
  DETAIL_VIEWS,
  marketingLoadPlan,
  marketingTab,
  viewFromParam,
} from "../lib/marketing-loading";
import type { MarketingSummary } from "../lib/marketing";
import type { MarketingProduct } from "../lib/marketing";
import type { MarketingGroupMetric } from "../lib/marketing-product-families";
import type {
  MarketingSources,
  MarketingStock,
} from "../lib/marketing-source-types";
import type { CampaignProduct } from "../lib/marketing-settings-types";
import type { InventoryAlert } from "../lib/marketing-inventory-decide";
import type { PixelHealthAlert } from "../lib/marketing-pixel";

const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/ | /g, " "));
const TODAY = "2026-11-13";

/* ----------------------------------------------------------- productos */

const product = (
  key: string,
  sku: string,
  realOrders: number,
  recentUnits: number,
): MarketingProduct =>
  ({
    key,
    sku,
    name: key,
    orders: realOrders + 2,
    realOrders,
    units: realOrders,
    delivered: 0,
    failed: 0,
    open: 0,
    deliveryRate: null,
    todayOrders: 0,
    yesterdayOrders: 0,
    sevenDayOrders: 0,
    todayReal: 0,
    yesterdayReal: 0,
    sevenDayReal: 0,
    recentUnits,
  }) as unknown as MarketingProduct;
const group = (
  key: string,
  name: string,
  realOrders: number,
  members: string[],
): MarketingGroupMetric =>
  ({
    ...product(key, "", realOrders, 0),
    name,
    familyKey: key,
    memberKeys: members,
    scope: "all",
  }) as MarketingGroupMetric;
const mapping = (patch: Partial<CampaignProduct>): CampaignProduct => ({
  platform: "meta",
  account_id: "1",
  campaign_id: "c",
  product_key: "",
  product_name: "",
  sku: "",
  ...patch,
});
const stock = (sku: string, available: number): MarketingStock => ({
  sku,
  warehouseId: "w",
  onHand: available,
  available,
  allocated: 0,
});
// Variants: 70 units in 7 days = 10 per day.
const variants = [
  product("sku:gom-a", "GOM-A", 60, 70),
  product("sku:gom-b", "GOM-B", 40, 70),
  product("sku:faja", "FAJA", 50, 70),
  product("sku:crema", "CREMA", 30, 70),
  product("sku:te", "TE", 12, 70),
  product("sku:mas", "MAS", 8, 70),
  product("sku:x", "X", 1, 70),
];
const summary: Pick<
  MarketingSummary,
  "products" | "groupedProducts" | "productFamilies"
> = {
  products: variants,
  productFamilies: [
    {
      key: "family:gom",
      name: "Gomitas",
      source: "shopify",
      review: false,
      members: [
        { key: "sku:gom-a", sku: "GOM-A", name: "Gomitas A" },
        { key: "sku:gom-b", sku: "GOM-B", name: "Gomitas B" },
      ],
    },
  ],
  groupedProducts: [
    group("family:gom", "Gomitas", 100, ["sku:gom-a", "sku:gom-b"]),
    group("sku:faja", "Faja", 50, ["sku:faja"]),
    group("sku:crema", "Crema", 30, ["sku:crema"]),
    group("sku:te", "Té", 12, ["sku:te"]),
    group("sku:mas", "Masajeador", 8, ["sku:mas"]),
    group("sku:x", "Otro", 1, ["sku:x"]),
  ],
};
const campaigns: HighlightCampaign[] = [
  // Gomitas: family assignment, USD 700 → CPA 7 (empujar with 200 units = 10 días).
  {
    spend: 700,
    currency: "USD",
    mapping: mapping({
      product_key: "family:gom",
      family_key: "family:gom",
      variant_scope: "all",
    }),
  },
  // Faja: CPA 10 (frenar).
  { spend: 500, currency: "USD", mapping: mapping({ product_key: "sku:faja" }) },
  // Crema: CPA 6, but stock for 2 days (frenar).
  { spend: 180, currency: "USD", mapping: mapping({ product_key: "sku:crema" }) },
  // Té: CPA 5, stock for 5 days (neutral: yellow).
  { spend: 60, currency: "USD", mapping: mapping({ product_key: "sku:te" }) },
  // Masajeador has no campaign.
];
const stocks = [
  stock("GOM-A", 100),
  stock("GOM-B", 100),
  stock("FAJA", 300),
  stock("CREMA", 20),
  stock("TE", 50),
  stock("MAS", 500),
];

describe("productos del Resumen", () => {
  const rows = plain(
    buildProductHighlights({
      summary,
      campaigns,
      stock: stocks,
      fx: null,
      settingsReady: true,
      aligned: true,
    }),
  );
  it("ranks the top 5 by real orders, grouped by product", () => {
    expect(rows.map((r) => [r.name, r.realOrders])).toEqual([
      ["Gomitas", 100],
      ["Faja", 50],
      ["Crema", 30],
      ["Té", 12],
      ["Masajeador", 8],
    ]);
  });
  it("tags Empujar, Frenar or neutral with icon text and a reason", () => {
    expect(rows.map((r) => [r.name, r.tag, r.reason])).toEqual([
      [
        "Gomitas",
        "empujar",
        "CPA real USD 7,00 dentro de la meta · stock para 10 días",
      ],
      ["Faja", "frenar", "CPA real USD 10,00 sobre la meta de USD 8,50"],
      ["Crema", "frenar", "Stock para 2,0 días"],
      ["Té", "neutral", "CPA real USD 5,00 · stock para 5,0 días"],
      ["Masajeador", "neutral", "Sin campaña asignada · stock para 50 días"],
    ]);
    expect(rows[0]).toMatchObject({
      spendUsd: 700,
      cpaReal: 7,
      approximate: false,
      coverage: { tone: "ok", days: 10 },
    });
    expect(rows[4]).toMatchObject({ cpaReal: null, cpaNote: "Sin campaña asignada" });
  });
  it("marks ≈ with unassigned spend or misaligned calendars, and Infinity without orders", () => {
    const loose = buildProductHighlights({
      summary,
      campaigns: [...campaigns, { spend: 50, currency: "USD", mapping: null }],
      stock: stocks,
      fx: null,
      settingsReady: true,
      aligned: true,
    });
    expect(loose[0].approximate).toBe(true);
    expect(
      buildProductHighlights({
        summary,
        campaigns,
        stock: stocks,
        fx: null,
        settingsReady: true,
        aligned: false,
      })[0].approximate,
    ).toBe(true);
    const none = plain(
      buildProductHighlights({
        summary: {
          ...summary,
          groupedProducts: [
            { ...group("sku:faja", "Faja", 0, ["sku:faja"]), orders: 3 },
          ],
        },
        campaigns,
        stock: stocks,
        fx: null,
        settingsReady: true,
        aligned: true,
      }),
    );
    expect(none[0]).toMatchObject({ cpaReal: null, tag: "frenar" });
    expect(none[0].reason).toBe(
      "USD 500,00 sin pedidos reales sobre la meta de USD 8,50",
    );
  });
  it("never invents a CPA or stock: no settings, no stock, no conversion", () => {
    const blind = plain(
      buildProductHighlights({
        summary,
        campaigns,
        stock: null,
        fx: null,
        settingsReady: false,
        aligned: true,
      }),
    );
    expect(blind[0]).toMatchObject({
      cpaReal: null,
      cpaNote: "Asignaciones no disponibles",
      tag: "neutral",
      coverage: { tone: "unknown" },
    });
    const crc = buildProductHighlights({
      summary,
      campaigns: [{ ...campaigns[0], currency: "CRC" }],
      stock: stocks,
      fx: null,
      settingsReady: true,
      aligned: true,
    });
    expect(crc[0]).toMatchObject({
      cpaReal: null,
      cpaNote: "Conversión de moneda pendiente",
    });
  });
  it("falls back to variants when there are no product groups", () => {
    const flat = buildProductHighlights({
      summary: { products: variants, productFamilies: summary.productFamilies },
      campaigns,
      stock: stocks,
      fx: null,
      settingsReady: true,
      aligned: true,
      limit: 2,
    });
    expect(flat.map((r) => r.key)).toEqual(["sku:gom-a", "sku:faja"]);
    // A variant of a family-wide assignment shares the family's spend.
    expect(flat[0].spendUsd).toBe(700);
  });
});

/* ------------------------------------------------------- qué está roto */

const ready = <T>(data: T) => ({
  status: "ready" as const,
  checkedAt: "",
  message: "",
  data,
});
const okSources = (): MarketingSources => ({
  meta: ready({ accounts: [] }),
  tiktok: ready({ accounts: [] }),
  shiphero: ready({ stock: [] }),
});
const quiet = (patch: Partial<BrokenInput> = {}): BrokenInput => ({
  accountProblems: [],
  sources: okSources(),
  metaUnavailable: [],
  pixelHealth: [],
  cancellations: { rate: 0.12, days: 7, annulled: 120, base: 1000 },
  inventoryAlerts: [],
  today: TODAY,
  ...patch,
});
const pixelAlert = (date: string): PixelHealthAlert => ({
  platform: "meta",
  accountLabel: "CR4",
  date,
  code: "sin_conversiones",
  pixel: 0,
  real: 14,
  usualFactor: null,
  title: "",
  detail: "",
});
const inventoryAlert = (code: InventoryAlert["code"]): InventoryAlert => ({
  code,
  tone: "risk",
  key: `${code}:1`,
  title: "Gomitas agotado con anuncios activos",
  detail: "CR4 · CBO GOMITAS",
});

describe("qué está roto", () => {
  it("is empty when everything is fine (Todo en orden)", () => {
    expect(buildBrokenItems(quiet())).toEqual([]);
  });
  it("lists accounts, sources, partial Meta, pixel, cancellations and stock, risk first", () => {
    const sources = okSources();
    sources.tiktok = { ...sources.tiktok, status: "error", data: null };
    sources.shiphero = { ...sources.shiphero, connection: "reconnect" };
    const items = plain(
      buildBrokenItems(
        quiet({
          accountProblems: [
            {
              platform: "meta",
              accountId: "2",
              label: "CR2",
              title: "Restringida",
              tone: "risk",
            },
            {
              platform: "meta",
              accountId: "3",
              label: "CR3",
              title: "Activa",
              tone: "good",
            },
          ],
          sources,
          metaUnavailable: ["CR5"],
          pixelHealth: [pixelAlert("2026-11-12"), pixelAlert("2026-11-05")],
          cancellations: { rate: 0.24, days: 7, annulled: 240, base: 1000 },
          inventoryAlerts: [
            inventoryAlert("anuncio_sin_stock"),
            inventoryAlert("reposicion"),
            { ...inventoryAlert("inventario_viejo"), tone: "wait" },
          ],
        }),
      ),
    );
    expect(items.map((i) => [i.tone, i.title, i.target.view, i.link])).toEqual([
      ["risk", "CR2: Restringida", "analysis", "Ver estado de las cuentas"],
      ["risk", "No se pudo consultar TikTok Ads", "sources", "Ver fuentes"],
      [
        "risk",
        "Meta parcial: no se pudo leer la cuenta CR5",
        "sources",
        "Ver fuentes",
      ],
      [
        "risk",
        "Píxel de CR4 sin compras el 12 nov",
        "report",
        "Ver píxel contra pedidos",
      ],
      [
        "risk",
        "Cancelaciones en 24%: sobre el límite de 20%",
        "analysis",
        "Ver cancelaciones",
      ],
      [
        "risk",
        "Gomitas agotado con anuncios activos",
        "report",
        "Ver la campaña en Detalle",
      ],
      ["wait", "ShipHero pide reconectar", "sources", "Ver conexión"],
      [
        "wait",
        "Gomitas agotado con anuncios activos",
        "sources",
        "Actualizar inventario",
      ],
    ]);
    expect(items[4].detail).toBe(
      "240 anulados de 1 000 pedidos en 7 días cerrados.",
    );
    expect(items[0].target.anchor).toBe("analisis-cuentas");
  });
  it("uses the cancellation limit strictly and skips unknown rates", () => {
    expect(
      buildBrokenItems(
        quiet({ cancellations: { rate: 0.2, days: 7, annulled: 2, base: 10 } }),
      ),
    ).toEqual([]);
    expect(buildBrokenItems(quiet({ cancellations: null }))).toEqual([]);
  });
  it("says when a source is not connected", () => {
    const sources = okSources();
    sources.meta = { ...sources.meta, status: "pending", data: null };
    sources.shiphero = {
      ...sources.shiphero,
      status: "pending",
      data: null,
    };
    expect(
      plain(buildBrokenItems(quiet({ sources }))).map((i) => i.title),
    ).toEqual(["Meta Ads sin conectar", "Inventario sin conectar"]);
  });
  it("names unavailable Meta accounts by their label", () => {
    const sources = okSources();
    sources.meta.data!.unavailable = [
      { accountId: "5", reason: "x" },
      { accountId: "6", reason: "x" },
    ];
    expect(
      unavailableMetaNames(sources, [
        { platform: "meta", account_id: "5", label: "CR5" },
      ]),
    ).toEqual(["CR5", "6"]);
  });
});

/* --------------------------------------------------------------- serie */

describe("pedidos reales por día y proyección", () => {
  it("subtracts annulled orders and marks today as in progress", () => {
    const daily = [
      { date: "2026-11-12", generated: 210, annulled: 20 },
      { date: TODAY, generated: 90, annulled: 2 },
    ] as unknown as MarketingSummary["daily"];
    expect(dailyRealSeries(daily, TODAY)).toEqual([
      { date: "2026-11-12", real: 190, created: 210, inProgress: false },
      { date: TODAY, real: 88, created: 90, inProgress: true },
    ]);
  });
  it("projects the period close by swapping today's so far for today's projection", () => {
    expect(
      periodProjection({ periodReal: 2300, todayReal: 100, todayProjected: 190 }),
    ).toBe(2390);
    expect(
      periodProjection({ periodReal: 2300, todayReal: 100, todayProjected: null }),
    ).toBeNull();
    // Never below what is already real.
    expect(
      periodProjection({ periodReal: 500, todayReal: 100, todayProjected: 80 }),
    ).toBe(500);
  });
});

/* -------------------------------------------------- navegación y carga */

describe("navegación Resumen / Acciones / Detalle", () => {
  it("maps every old ?view= to the same content and defaults to Resumen", () => {
    expect(viewFromParam(null)).toBe("resumen");
    expect(viewFromParam("")).toBe("resumen");
    expect(viewFromParam("algo")).toBe("resumen");
    expect(viewFromParam("report")).toBe("report");
    expect(viewFromParam("detalle")).toBe("report");
    expect(viewFromParam("acciones")).toBe("acciones");
    for (const view of [
      "summary",
      "details",
      "trends",
      "sources",
      "matrix",
      "structure",
      "subtraction",
      "analysis",
    ])
      expect(viewFromParam(view)).toBe(view);
  });
  it("puts every pre-redesign view under Detalle, the full report first", () => {
    expect(DETAIL_VIEWS[0]).toEqual(["report", "Reporte completo"]);
    expect(DETAIL_VIEWS.map(([v]) => v).sort()).toEqual(
      [
        "report",
        "summary",
        "matrix",
        "structure",
        "subtraction",
        "analysis",
        "trends",
        "details",
        "sources",
      ].sort(),
    );
    for (const [view] of DETAIL_VIEWS) expect(marketingTab(view)).toBe("detalle");
    expect(marketingTab("resumen")).toBe("resumen");
    expect(marketingTab("acciones")).toBe("acciones");
  });
});

describe("Resumen loading", () => {
  it("loads only what Resumen needs: light sources, no ad catalogue, no period control", () => {
    expect(marketingLoadPlan("resumen")).toEqual({
      summary: true,
      settings: true,
      sourceScope: "basic",
      reportScope: null,
      recent: "includesToday",
      control: true,
      periodControl: false,
      actions: true,
      changes: true,
      inventory: false,
      accounts: true,
      ordersInsights: false,
      cancellations: true,
      costCapAds: true,
      productsInsights: false,
    });
  });
  it("Acciones keeps the action tables without account status or cancellations", () => {
    expect(marketingLoadPlan("acciones")).toMatchObject({
      summary: true,
      settings: true,
      sourceScope: "basic",
      reportScope: null,
      recent: "never",
      control: true,
      actions: true,
      changes: true,
      accounts: false,
      cancellations: false,
      costCapAds: true,
      inventory: false,
      periodControl: false,
    });
  });
  it("the full report keeps its old plan", () => {
    expect(marketingLoadPlan("report")).toMatchObject({
      sourceScope: "report",
      recent: "always",
      periodControl: true,
      inventory: true,
      cancellations: false,
      costCapAds: false,
    });
    for (const view of [
      "summary",
      "details",
      "trends",
      "sources",
      "matrix",
      "structure",
      "subtraction",
      "analysis",
    ] as const)
      expect(marketingLoadPlan(view)).toMatchObject({
        cancellations: false,
        costCapAds: false,
      });
  });
});
