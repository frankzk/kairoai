import { describe, expect, it } from "vitest";
import {
  buildInventoryDecision,
  inventoryStaleDate,
  isAdActive,
  noPreviousSnapshotText,
  staleInventoryText,
  variantAttributes,
  variantLabel,
  variantListText,
} from "../lib/marketing-inventory-decide";
import type { CampaignActionRow, Window } from "../lib/marketing-actions";
import type { MarketingStock } from "../lib/marketing-source-types";
import type { ProductPlan } from "../lib/marketing-settings-types";
import type { MarketingFamily } from "../lib/marketing-product-families";

const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/ | /g, " "));

const stock = (
  sku: string,
  available: number,
  extra: Partial<MarketingStock> = {},
): MarketingStock => ({
  sku,
  warehouseId: "csv",
  onHand: available,
  available,
  allocated: 0,
  ...extra,
});
const w = (spendNative = 0): Window => ({
  spendNative,
  spendUsd: spendNative,
  pixel: 0,
  real: 0,
  utm: 0,
  partial: false,
  cpaReal: null,
  cpaPixel: null,
});
const ad = (
  patch: Partial<CampaignActionRow> & Pick<CampaignActionRow, "key" | "name">,
): CampaignActionRow =>
  ({
    platform: "meta",
    accountId: "4",
    accountLabel: "CR4",
    campaignId: patch.key,
    type: "CBO",
    status: "activa",
    currency: "USD",
    today: w(),
    yesterday: w(),
    days3: w(),
    days7: w(),
    product: null,
    ...patch,
  }) as CampaignActionRow;
const plan = (product_key: string, incoming_units: number): ProductPlan => ({
  product_key,
  product_name: "",
  sku: "",
  priority: false,
  supplier: "",
  lead_days: null,
  cover_days: null,
  incoming_units,
});

describe("variantAttributes", () => {
  it("reads color and size from the SKU", () => {
    expect(variantAttributes("FAT.BURN.NEGRO.S")).toEqual({
      base: "fat.burn",
      color: "Negro",
      size: "S",
    });
    expect(variantAttributes("BIVIDI.UNICA")).toEqual({
      base: "bividi",
      color: null,
      size: "Talla única",
    });
    expect(variantAttributes("FAT-BURN-BEIGE-L/XL")).toMatchObject({
      base: "fat.burn",
      size: "L/XL",
    });
    expect(variantAttributes("BIVIDI.BLACK.TALLA_UNICA")).toEqual({
      base: "bividi",
      color: "Negro",
      size: "Talla única",
    });
  });
  it("finds nothing in plain presentation SKUs", () => {
    expect(variantAttributes("85999875")).toEqual({
      base: "85999875",
      color: null,
      size: null,
    });
    expect(variantAttributes("GOMITAS/SHILAJIT").color).toBeNull();
    // The first token names the product, even when it looks like a size.
    expect(variantAttributes("S.CREATINA.240G")).toMatchObject({ size: null });
  });
  it("falls back to the variant text of the name", () => {
    expect(
      variantAttributes(
        "FATBURN1",
        "Fat Burn Shorts - Color: Negro · Talla: Talla única",
      ),
    ).toMatchObject({ color: "Negro", size: "Talla única" });
    expect(
      variantAttributes("FATBURN2", "Fat Burn Shorts - Beige / M"),
    ).toMatchObject({ color: "Beige", size: "M" });
    // Words outside the variant part do not count.
    expect(
      variantAttributes("X1", "Shilajit Puro Black Edition"),
    ).toMatchObject({
      color: null,
      size: null,
    });
  });
});

describe("variantLabel", () => {
  const family = {
    name: "Fat Burn Shorts",
    members: [
      { key: "sku:a", sku: "A", name: "Negro / S" },
      { key: "sku:b", sku: "B", name: "Fat Burn Shorts" },
    ],
  };
  it("prefers the Shopify variant title, then color/size, then the name rest", () => {
    expect(variantLabel({ key: "sku:a", sku: "A", name: "Fat Burn Shorts" }, family)).toBe(
      "Negro / S",
    );
    expect(
      variantLabel({ key: "sku:fat.burn.beige.m", sku: "FAT.BURN.BEIGE.M", name: "Fat Burn" }, family),
    ).toBe("Beige / M");
    expect(
      variantLabel({ key: "sku:x", sku: "X1", name: "Fat Burn Shorts - Edición 2" }, family),
    ).toBe("Edición 2");
    expect(variantLabel({ key: "sku:b", sku: "B", name: "Fat Burn Shorts" }, family)).toBe("B");
  });
  it("caps the list and tells repeated labels apart", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      key: `sku:v${i}`,
      sku: `V${i}`,
      name: `Producto - Variante ${i}`,
    }));
    expect(variantListText(rows, { name: "Producto", members: [] })).toBe(
      "Variante 0, Variante 1, Variante 2, Variante 3, Variante 4, Variante 5 y 3 más",
    );
    expect(
      variantListText(
        [
          { key: "sku:p", sku: "P1", name: "Producto - Negro" },
          { key: "sku:q", sku: "P2", name: "Producto - Negro" },
        ],
        null,
      ),
    ).toBe("Negro (P1), Negro (P2)");
  });
});

describe("isAdActive", () => {
  it("uses Meta status and TikTok recent spend", () => {
    expect(isAdActive(ad({ key: "a", name: "A" }))).toBe(true);
    expect(isAdActive(ad({ key: "a", name: "A", status: "pausada" }))).toBe(
      false,
    );
    expect(
      isAdActive(
        ad({
          key: "t",
          name: "T",
          platform: "tiktok",
          status: null,
          days3: w(40),
        }),
      ),
    ).toBe(true);
    expect(
      isAdActive(ad({ key: "t", name: "T", platform: "tiktok", status: null })),
    ).toBe(false);
  });
});

describe("buildInventoryDecision", () => {
  const products = [
    {
      key: "sku:creatina.240",
      sku: "CREATINA.240",
      name: "Creatina 240g",
      recentUnits: 70,
    },
    {
      key: "sku:85999875",
      sku: "85999875",
      name: "Shilajit Cápsulas",
      recentUnits: 14,
    },
    {
      key: "sku:gomitas/shilajit",
      sku: "GOMITAS/SHILAJIT",
      name: "Shilajit Gomitas",
      recentUnits: 21,
    },
    { key: "sku:her.loss", sku: "HER.LOSS", name: "Her Loss", recentUnits: 35 },
    { key: "sku:turk", sku: "TURK", name: "Turkesterone", recentUnits: 7 },
  ];
  const families: MarketingFamily[] = [];

  it("alerts an active ad without stock, with its campaigns and accounts", () => {
    const out = plain(
      buildInventoryDecision({
        products,
        stock: [
          stock("CREATINA.240", 0, { backorder: 42 }),
          stock("85999875", 50),
        ],
        previous: null,
        columns: { backorder: true, incoming: false },
        plans: [],
        actionRows: [
          ad({
            key: "meta:4:1",
            name: "CBO CREATINA",
            product: {
              key: "sku:creatina.240",
              name: "Creatina",
              automatic: true,
              reason: "",
            },
          }),
          ad({
            key: "meta:2:2",
            name: "CC CREATINA",
            accountLabel: "CR2",
            product: {
              key: "sku:creatina.240",
              name: "Creatina",
              automatic: true,
              reason: "",
            },
          }),
        ],
        families,
      }),
    );
    expect(out.alerts[0]).toEqual({
      code: "anuncio_sin_stock",
      tone: "risk",
      key: "anuncio:sku:creatina.240",
      title: "Anuncio activo sin stock: Creatina 240g",
      detail:
        "CBO CREATINA, CC CREATINA (CR4, CR2). Disponible 0 · 42 pedidos esperando.",
    });
    // Covered by the ad alert: no second "esperando" alert for the same SKU.
    expect(out.alerts.filter((a) => a.code === "esperando_stock")).toEqual([]);
    expect(out.rows[0]).toMatchObject({
      key: "sku:creatina.240",
      backorder: 42,
      available: 0,
    });
  });

  it("alerts orders waiting from the Backorder column", () => {
    const out = plain(
      buildInventoryDecision({
        products,
        stock: [stock("85999875", 3, { backorder: 85, incoming: 200 })],
        previous: null,
        columns: { backorder: true, incoming: true },
        plans: [],
        actionRows: [],
        families,
      }),
    );
    expect(out.alerts).toEqual([
      {
        code: "esperando_stock",
        tone: "risk",
        key: "esperando:sku:85999875",
        title: "Shilajit Cápsulas: 85 pedidos esperando stock",
        detail: "Disponible 3 · 200 en camino.",
      },
    ]);
    expect(out.rows[0]).toMatchObject({ incoming: 200, incomingSource: "csv" });
    expect(out.notes).not.toContain(
      "Sin pedidos esperando: el archivo product_table no trae la columna Backorder.",
    );
  });

  it("without the column, uses the iComfly proxy as a wait alert", () => {
    const out = plain(
      buildInventoryDecision({
        products,
        stock: [stock("HER.LOSS", 10)],
        previous: null,
        columns: { backorder: false, incoming: false },
        plans: [],
        actionRows: [],
        families,
        waiting: {
          "sku:her.loss": { confirmedNoGuide: 5, agotado: 1, oldestDays: 3 },
        },
      }),
    );
    expect(out.alerts).toEqual([
      {
        code: "esperando_stock",
        tone: "wait",
        key: "esperando:sku:her.loss",
        title: "Her Loss: 6 pedidos confirmados sin guía",
        detail:
          "En iComfly hace más de 24 h (1 en Producto Agotado); el más viejo tiene 3 días. Puede ser stock, almacén o retraso.",
      },
    ]);
    expect(out.rows.find((r) => r.key === "sku:her.loss")).toMatchObject({
      backorder: null,
      waitingProxy: 6,
    });
    expect(out.notes).toContain(
      "Sin pedidos esperando: el archivo product_table no trae la columna Backorder.",
    );
    expect(out.notes).toContain(
      "Sin unidades en camino: el archivo product_table no trae esa columna.",
    );
  });

  it("groups restocks largest first", () => {
    const out = plain(
      buildInventoryDecision({
        products,
        stock: [
          stock("HER.LOSS", 310),
          stock("TURK", 100),
          stock("85999875", 10),
        ],
        previous: [
          stock("HER.LOSS", 10),
          stock("TURK", 7),
          stock("85999875", 12),
        ],
        columns: null,
        plans: [],
        actionRows: [],
        families,
      }),
    );
    expect(out.restocks).toEqual([
      { sku: "her.loss", name: "Her Loss", delta: 300 },
      { sku: "turk", name: "Turkesterone", delta: 93 },
    ]);
    expect(out.alerts.at(-1)).toEqual({
      code: "reposicion",
      tone: "good",
      key: "reposicion",
      title: "Entró reposición",
      detail: "Her Loss +300 · Turkesterone +93.",
    });
    expect(out.rows.find((r) => r.sku === "85999875")?.restocked).toBe(0);
  });

  it("uses the product plan for units on the way when the CSV lacks the column", () => {
    const out = buildInventoryDecision({
      products,
      stock: [stock("TURK", 5)],
      previous: null,
      columns: { backorder: false, incoming: false },
      plans: [plan("sku:turk", 120)],
      actionRows: [],
      families,
    });
    expect(out.rows.find((r) => r.key === "sku:turk")).toMatchObject({
      incoming: 120,
      incomingSource: "plan",
      restocked: null,
    });
    expect(out.notes).toContain(
      "Sin unidades en camino en el archivo: «a mano» sale del plan de cada producto.",
    );
  });

  it("a ShipHero SKU with no open PO line (null) keeps the plan; a real PO number wins", () => {
    const out = buildInventoryDecision({
      products,
      stock: [stock("TURK", 5, { incoming: null }), stock("85999875", 5, { incoming: 40 })],
      previous: null,
      columns: { backorder: true, incoming: true },
      source: "shiphero",
      plans: [plan("sku:turk", 120), plan("sku:85999875", 10)],
      actionRows: [],
      families,
    });
    expect(out.rows.find((r) => r.key === "sku:turk")).toMatchObject({ incoming: 120, incomingSource: "plan" });
    expect(out.rows.find((r) => r.sku === "85999875")).toMatchObject({ incoming: 40, incomingSource: "csv" });
  });

  it("keeps each presentation apart and lists stock-only SKUs", () => {
    const out = buildInventoryDecision({
      products,
      stock: [
        stock("85999875", 40),
        stock("GOMITAS/SHILAJIT", 30),
        stock("SHILAJIT.100%.PURO.", 20),
      ],
      previous: null,
      columns: null,
      plans: [],
      actionRows: [],
      families,
    });
    const shilajit = out.rows.filter((r) => /shilajit|8599/i.test(r.sku));
    expect(shilajit.map((r) => r.sku).sort()).toEqual([
      "85999875",
      "GOMITAS/SHILAJIT",
      "SHILAJIT.100%.PURO.",
    ]);
    expect(out.rows.find((r) => r.sku === "85999875")?.coverage.days).toBe(20);
    expect(out.uncataloged).toBe(1);
    expect(
      out.rows.find((r) => r.sku === "SHILAJIT.100%.PURO.")?.cataloged,
    ).toBe(false);
    expect(out.sizeColor).toEqual([]);
  });

  it("builds the size × color matrix with per-variant demand", () => {
    const fat = [
      {
        key: "sku:fat.burn.beige.s",
        sku: "FAT.BURN.BEIGE.S",
        name: "Fat Burn Shorts - Beige / S",
        recentUnits: 0,
      },
      {
        key: "sku:fat.burn.negro.s",
        sku: "FAT.BURN.NEGRO.S",
        name: "Fat Burn Shorts - Negro / S",
        recentUnits: 140,
      },
    ];
    const out = buildInventoryDecision({
      products: fat,
      stock: [
        stock("FAT.BURN.BEIGE.S", 178),
        stock("FAT.BURN.NEGRO.S", 0),
        stock("FAT.BURN.NEGRO.XL", 3),
        stock("FAT.BURN.BEIGE.XL", 1),
      ],
      previous: null,
      columns: null,
      plans: [],
      actionRows: [],
      families,
      variantUnits7d: {
        "sku:fat.burn.negro.s": 63,
        "sku:fat.burn.beige.s": 14,
      },
    });
    expect(out.variantDemand).toBe(true);
    expect(out.sizeColor).toHaveLength(1);
    const group = out.sizeColor[0];
    expect(group).toMatchObject({
      base: "fat.burn",
      name: "Fat Burn Shorts",
      colors: ["Beige", "Negro"],
      sizes: ["S", "XL"],
      total: 182,
    });
    expect(group.cells.find((c) => c.sku === "FAT.BURN.BEIGE.S")).toMatchObject(
      {
        color: "Beige",
        size: "S",
        available: 178,
        dailyUnits: 2,
      },
    );
    // Per-variant demand replaces the per-SKU one of the summary.
    expect(out.rows.find((r) => r.sku === "FAT.BURN.NEGRO.S")?.dailyUnits).toBe(
      9,
    );
    expect(out.notes).not.toContain(
      "Venta por talla y color no disponible: iComfly no separa la variante en estos pedidos.",
    );
  });

  it("expands a family campaign to its members", () => {
    const fam: MarketingFamily[] = [
      {
        key: "family:fat",
        name: "Fat Burn",
        source: "shopify",
        review: false,
        members: [
          {
            key: "sku:fat.burn.negro.s",
            sku: "FAT.BURN.NEGRO.S",
            name: "Negro",
          },
          {
            key: "sku:fat.burn.beige.s",
            sku: "FAT.BURN.BEIGE.S",
            name: "Beige",
          },
        ],
      },
    ];
    const out = buildInventoryDecision({
      products: [
        {
          key: "sku:fat.burn.negro.s",
          sku: "FAT.BURN.NEGRO.S",
          name: "Fat Burn Negro S",
          recentUnits: 70,
        },
        {
          key: "sku:fat.burn.beige.s",
          sku: "FAT.BURN.BEIGE.S",
          name: "Fat Burn Beige S",
          recentUnits: 7,
        },
      ],
      stock: [stock("FAT.BURN.NEGRO.S", 0), stock("FAT.BURN.BEIGE.S", 178)],
      previous: null,
      columns: null,
      plans: [],
      actionRows: [
        ad({
          key: "meta:4:9",
          name: "CBO FAT BURN",
          product: {
            key: "family:fat",
            name: "Fat Burn",
            automatic: true,
            reason: "",
          },
        }),
      ],
      families: fam,
      staleDate: "2026-11-01",
    });
    expect(
      out.rows.find((r) => r.sku === "FAT.BURN.BEIGE.S")?.activeAds,
    ).toHaveLength(1);
    expect(out.rows.find((r) => r.sku === "FAT.BURN.NEGRO.S")?.familyKey).toBe(
      "family:fat",
    );
    // Old file: no stock alert, like the stock rules of modules 1–3.
    expect(out.alerts.map((a) => plain(a))).toEqual([
      {
        code: "inventario_viejo",
        tone: "wait",
        key: "inventario_viejo",
        title: "Inventario del 1 nov",
        detail:
          "Las alertas de stock quedan sin evaluar. Sube el archivo de hoy.",
      },
    ]);
    const fresh = buildInventoryDecision({
      products: [
        {
          key: "sku:fat.burn.negro.s",
          sku: "FAT.BURN.NEGRO.S",
          name: "Fat Burn Negro S",
          recentUnits: 70,
        },
      ],
      stock: [stock("FAT.BURN.NEGRO.S", 0)],
      previous: null,
      columns: null,
      plans: [],
      actionRows: [
        ad({
          key: "meta:4:9",
          name: "CBO FAT BURN",
          product: {
            key: "family:fat",
            name: "Fat Burn",
            automatic: true,
            reason: "",
          },
        }),
      ],
      families: fam,
    });
    expect(fresh.alerts.map((a) => plain(a).detail)).toEqual([
      "CBO FAT BURN (CR4). Disponible 0.",
    ]);
  });

  describe("products with variants (familia talla/color)", () => {
    const fatFamily: MarketingFamily[] = [
      {
        key: "family:shopify:1",
        name: "Fat Burn Shorts",
        source: "shopify",
        review: false,
        members: [
          ["NEGRO.S", "Negro / S"],
          ["NEGRO.M", "Negro / M"],
          ["NEGRO.L", "Negro / L"],
          ["BEIGE.S", "Beige / S"],
          ["BEIGE.M", "Beige / M"],
          ["BEIGE.L", "Beige / L"],
          ["ROSA.S", "Rosa / S"],
          ["ROSA.M", "Rosa / M"],
          ["ROSA.L", "Rosa / L"],
        ].map(([v, name]) => ({
          key: `sku:fat.${v.toLowerCase()}`,
          sku: `FAT.${v}`,
          name,
        })),
      },
    ];
    // The iComfly catalog names the product, not the variant.
    const fatProducts = fatFamily[0].members.map((m) => ({
      key: m.key,
      sku: m.sku,
      name: "Fat Burn Shorts",
      recentUnits: 7,
    }));
    const familyAd = ad({
      key: "meta:4:9",
      name: "CBO FAT BURN",
      product: {
        key: "family:shopify:1",
        name: "Fat Burn Shorts",
        automatic: true,
        reason: "",
      },
    });
    const run = (
      available: Record<string, number>,
      extra: Partial<Parameters<typeof buildInventoryDecision>[0]> = {},
    ) =>
      plain(
        buildInventoryDecision({
          products: fatProducts,
          stock: fatFamily[0].members.map((m) =>
            stock(m.sku, available[m.sku] ?? 0),
          ),
          previous: null,
          columns: null,
          plans: [],
          actionRows: [familyAd],
          families: fatFamily,
          ...extra,
        }),
      );

    it("a family with stock in some variants is not «sin stock»: one grouped variant alert", () => {
      const out = run({ "FAT.BEIGE.S": 120, "FAT.BEIGE.M": 80 });
      expect(out.alerts.filter((a) => a.code === "anuncio_sin_stock")).toEqual(
        [],
      );
      expect(out.alerts).toEqual([
        {
          code: "variantes_agotadas",
          tone: "wait",
          key: "variantes:family:shopify:1",
          title: "Fat Burn Shorts: tallas/colores agotados",
          detail:
            "Sin stock: Negro / S, Negro / M, Negro / L, Beige / L, Rosa / S, Rosa / M y 1 más. 7 de 9 variantes sin stock · disponible total 200 (22 días). Anuncio activo: CBO FAT BURN (CR4).",
        },
      ]);
      expect(JSON.stringify(out.alerts)).not.toMatch(/sin stock: Fat/i);
      // The rows stay per SKU.
      expect(out.rows).toHaveLength(9);
    });

    it("a family fully at 0 says «sin stock» once, at family level", () => {
      const out = run({});
      expect(out.alerts).toEqual([
        {
          code: "anuncio_sin_stock",
          tone: "risk",
          key: "anuncio:family:shopify:1",
          title: "Anuncio activo sin stock: Fat Burn Shorts",
          detail: "CBO FAT BURN (CR4). Disponible 0 entre 9 variantes.",
        },
      ]);
    });

    it("judges red coverage on the family total, not on one variant", () => {
      // 9 a day for the family: 20 units are 2,2 days (red) even if spread out.
      const red = run({ "FAT.BEIGE.S": 20 });
      expect(red.alerts.map((a) => [a.code, a.title, a.detail])).toEqual([
        [
          "anuncio_sin_stock",
          "Anuncio activo con poco stock: Fat Burn Shorts",
          "CBO FAT BURN (CR4). Disponible 20 entre 9 variantes · 2,2 días.",
        ],
      ]);
      // Every variant in stock: nothing to say.
      const full = run(
        Object.fromEntries(fatFamily[0].members.map((m) => [m.sku, 50])),
      );
      expect(full.alerts).toEqual([]);
    });

    it("groups the orders waiting of a family and does not say it has no stock", () => {
      const out = run(
        { "FAT.BEIGE.S": 300 },
        {
          stock: fatFamily[0].members.map((m) =>
            stock(m.sku, m.sku === "FAT.BEIGE.S" ? 300 : m.sku === "FAT.NEGRO.S" ? 0 : 40, {
              backorder: m.sku === "FAT.NEGRO.S" ? 12 : m.sku === "FAT.ROSA.M" ? 3 : 0,
            }),
          ),
          columns: { backorder: true, incoming: false },
          actionRows: [],
        },
      );
      expect(out.alerts).toEqual([
        {
          code: "esperando_stock",
          tone: "risk",
          key: "esperando:family:shopify:1",
          title: "Fat Burn Shorts: 15 pedidos esperando stock",
          detail:
            "En Negro / S (12), Rosa / M (3) · disponible total del producto 580.",
        },
      ]);
    });

    it("a campaign of one variant keeps the per-SKU alert, named with its variant", () => {
      const out = run(
        { "FAT.BEIGE.S": 120 },
        {
          actionRows: [
            ad({
              key: "meta:4:10",
              name: "ABO NEGRO S",
              product: {
                key: "sku:fat.negro.s",
                name: "Fat Burn Shorts",
                automatic: true,
                reason: "",
              },
            }),
          ],
        },
      );
      expect(out.alerts.map((a) => [a.code, a.title])).toEqual([
        ["anuncio_sin_stock", "Anuncio activo sin stock: Fat Burn Shorts (Negro / S)"],
      ]);
    });

    it("single-SKU products keep the per-SKU alert", () => {
      const out = plain(
        buildInventoryDecision({
          products,
          stock: [stock("TURK", 0)],
          previous: null,
          columns: null,
          plans: [],
          actionRows: [
            ad({
              key: "meta:4:t",
              name: "CBO TURK",
              product: { key: "sku:turk", name: "Turk", automatic: true, reason: "" },
            }),
          ],
          families: [
            {
              key: "family:name:turk",
              name: "Turkesterone",
              source: "name",
              review: false,
              members: [{ key: "sku:turk", sku: "TURK", name: "Turkesterone" }],
            },
          ],
        }),
      );
      expect(out.alerts).toEqual([
        {
          code: "anuncio_sin_stock",
          tone: "risk",
          key: "anuncio:sku:turk",
          title: "Anuncio activo sin stock: Turkesterone",
          detail: "CBO TURK (CR4). Disponible 0.",
        },
      ]);
    });
  });

  it("sorts an active ad without stock first, even without recent sales", () => {
    const out = buildInventoryDecision({
      products: [
        { key: "sku:turk", sku: "TURK", name: "Turkesterone", recentUnits: 70 },
        { key: "sku:new", sku: "NEW", name: "Lanzamiento", recentUnits: 0 },
        { key: "sku:idle", sku: "IDLE", name: "Sin anuncio", recentUnits: 0 },
      ],
      stock: [stock("TURK", 40), stock("NEW", 0), stock("IDLE", 0)],
      previous: null,
      columns: null,
      plans: [],
      actionRows: ["turk", "new"].map((key) =>
        ad({
          key: `meta:4:${key}`,
          name: key.toUpperCase(),
          product: {
            key: `sku:${key}`,
            name: key,
            automatic: true,
            reason: "",
          },
        }),
      ),
      families: [],
    });
    expect(out.rows[0].key).toBe("sku:new");
  });

  it("restock alert: only SKUs of the previous file with a real increase", () => {
    const out = buildInventoryDecision({
      products: [
        { key: "sku:her.loss", sku: "HER.LOSS", name: "Her Loss", recentUnits: 35 },
        { key: "sku:turk", sku: "TURK", name: "Turkesterone", recentUnits: 7 },
      ],
      stock: [stock("HER.LOSS", 300), stock("TURK", 41), stock("CREMA.X", 1079)],
      previous: [stock("HER.LOSS", 0), stock("TURK", 40)],
      columns: null,
      plans: [],
      actionRows: [],
      families: [],
    });
    expect(out.restocks).toEqual([
      { sku: "her.loss", name: "Her Loss", delta: 300 },
    ]);
    expect(out.alerts.find((a) => a.code === "reposicion")?.detail).toBe(
      "Her Loss +300.",
    );
    // The row still shows the raw change.
    expect(out.rows.find((r) => r.sku === "TURK")?.restocked).toBe(1);
  });

  it("says ShipHero, not the product_table, when columns are missing there", () => {
    const out = buildInventoryDecision({
      products: [],
      stock: [stock("TURK", 5)],
      previous: null,
      plans: [],
      actionRows: [],
      families: [],
      source: "shiphero",
    });
    expect(out.notes).toContain(
      "Sin pedidos esperando: el inventario de ShipHero no trae ese dato.",
    );
    expect(out.notes.join(" ")).not.toContain("product_table");
  });
});

describe("origin-aware inventory texts", () => {
  it("keeps the CSV wording and points ShipHero to Fuentes", () => {
    expect(staleInventoryText("csv", "2 nov")).toBe(
      "El inventario es del 2 nov. Sube el archivo de hoy.",
    );
    expect(staleInventoryText("shiphero", "2 nov")).toBe(
      "El inventario de ShipHero es del 2 nov. Revisa la conexión en Fuentes.",
    );
    expect(noPreviousSnapshotText("csv")).toBe(
      "Sin registro de reposición (falta el archivo de un día anterior).",
    );
    expect(noPreviousSnapshotText("shiphero")).toBe(
      "Sin registro de reposición (falta la foto de ShipHero de un día anterior).",
    );
  });

  it("a stale ShipHero snapshot does not ask to upload a file", () => {
    const out = buildInventoryDecision({
      products: [{ key: "sku:a", sku: "A", name: "A", recentUnits: 7 }],
      stock: [{ sku: "A", warehouseId: "w", onHand: 1, available: 1, allocated: 0, backorder: 0 }],
      previous: null,
      columns: { backorder: true, incoming: false },
      source: "shiphero",
      plans: [],
      actionRows: [],
      families: [],
      staleDate: "2026-11-01",
    });
    const stale = out.alerts.find((a) => a.code === "inventario_viejo");
    expect(stale?.detail).toBe(
      "Las alertas de stock quedan sin evaluar. Revisa la conexión de ShipHero en Fuentes.",
    );
    expect(out.notes.join(" ")).not.toContain("archivo");
  });
});

describe("inventoryStaleDate", () => {
  // Costa Rica = UTC-6. ShipHero runs 06:13, 10:13, 14:13 and 18:13 CR.
  const cr = (date: string, time: string) => new Date(`${date}T${time}:00-06:00`);
  const ship = (date: string, time: string) => ({
    origin: "shiphero" as const,
    snapshotDate: date,
    uploadedAt: cr(date, time).toISOString(),
  });

  it("CSV: stale only when older than yesterday (as before)", () => {
    const now = cr("2026-11-06", "16:00");
    expect(inventoryStaleDate({ origin: "csv", snapshotDate: "2026-11-05" }, now)).toBeNull();
    expect(inventoryStaleDate({ origin: "csv", snapshotDate: "2026-11-04" }, now)).toBe("2026-11-04");
  });

  it("ShipHero: one missed run is fine, two in a row are flagged the same day", () => {
    // Last good run yesterday 18:13; today's 06:13 missed: fine at 07:30.
    expect(inventoryStaleDate(ship("2026-11-05", "18:13"), cr("2026-11-06", "07:30"))).toBeNull();
    // Overnight is never flagged.
    expect(inventoryStaleDate(ship("2026-11-05", "18:13"), cr("2026-11-06", "05:00"))).toBeNull();
    // 06:13 and 10:13 missed: flagged at 11:00, with yesterday's date.
    expect(inventoryStaleDate(ship("2026-11-05", "18:13"), cr("2026-11-06", "11:00"))).toBe("2026-11-05");
    // Today's 06:13 snapshot, 10:13 and 14:13 missed: flagged at 16:00.
    expect(inventoryStaleDate(ship("2026-11-06", "06:14"), cr("2026-11-06", "16:00"))).toBe("2026-11-06");
    expect(inventoryStaleDate(ship("2026-11-06", "10:14"), cr("2026-11-06", "16:00"))).toBeNull();
  });

  it("a live read (no snapshot date) is never stale", () => {
    expect(inventoryStaleDate({ origin: "shiphero" }, new Date())).toBeNull();
  });
});
