import { describe, expect, it } from "vitest";
import {
  buildKeywordIndex,
  campaignTokens,
  keywordCampaignMatch,
  keywordProblem,
} from "../lib/marketing-campaign-keywords";
import { buildProductFamilies } from "../lib/marketing-product-groups-server";
import { effectiveAssignment } from "../lib/marketing-product-families";
import type {
  CampaignKeywordRule,
  CampaignProduct,
} from "../lib/marketing-settings-types";

// Real Mireva Costa Rica catalog titles and SKUs (Shopify, 5 nov 2026).
const native = [
  [
    "10434758705468",
    "ALPHATOUCH LURE HER – FRAGANCIA DE ATRACCIÓN Y CONFIANZA MASCULINA (50 ml)",
    ["LURE.HER"],
  ],
  [
    "10275444064572",
    "Cápsulas de Shilajit 100% Puro del Himalaya 92 Minerales (30 Cápsulas)",
    ["85999875"],
  ],
  [
    "15394771566908",
    "Colágeno Neocell -Suplemento de Colágeno Grass-Fed (567 g)",
    ["NEOCELL"],
  ],
  [
    "10275974611260",
    "Creatine Monohydrate for Women - Creatina Monohidratada 5000mg + Colágeno y BCAA (30 Servicios) – Old School Labs™",
    ["CREATINE.WOMEN"],
  ],
  [
    "10378111910204",
    "Fat‑Burn Shorts - Shorts para Quemar Grasa – Faja Moldeadora de Compresión y Control Abdomen",
    ["FAT.BURN.NEGRO.S", "FAT.BURN.BEIGE.S"],
  ],
  [
    "10390702686524",
    "Gomitas de Shilajit 100% Puro del Himalaya (Pack de 60 Gomitas)",
    ["GOMITAS/SHILAJIT"],
  ],
  [
    "10418796659004",
    "HER LOSS – Colonia con Feromonas para Hombre, Confianza y Atracción (50 ml)",
    ["HER.LOSS"],
  ],
  [
    "10306711191868",
    "Karseell Collagen Hair Mask: Mascarilla de Colágeno para Cabello Seco y Dañado (500ml)",
    ["49435192"],
  ],
  [
    "10368540574012",
    "Magnesium Complex – Fórmula de Absorción Máxima para Huesos, Músculos y Sueño Reparador (60 Cápsulas)",
    ["MAGNESIO.TOPLUX"],
  ],
  [
    "10275977724220",
    "NAD + Resveratrol – Fórmula Avanzada con Nicotinamide Riboside y Resveratrol (60 cápsulas)",
    ["NAD SUPLEMENTO"],
  ],
  [
    "10434754904380",
    "NAD+ Men's Complex – Energía, Rendimiento y Vitalidad Masculina (60 Cápsulas)",
    ["NAD-SELERB"],
  ],
  [
    "10419007488316",
    "Retinol Celimax Crema Antiedad 0.1% + Matrixyl® 3000",
    ["RETINOL.CELI"],
  ],
  [
    "10392103616828",
    "Shilajit 100% Puro 💎 Fuente de Energía Vital del Himalaya",
    ["SHILAJIT.100%.PURO."],
  ],
  [
    "10275977789756",
    "Turkesterone - Cápsulas de Ajuga Turkestanica con Tongkat Ali para Resistencia, Fuerza y Vitalidad Masculina (120 Cápsulas)",
    ["TURKESTERONE"],
  ],
] as const;
const families = buildProductFamilies(
  [],
  native.map(([shopify_id, title, skus]) => ({
    shopify_id,
    title,
    variants: skus.map((sku) => ({ sku, title: sku })),
  })),
);
const family = (start: string) =>
  families.find((f) => f.name.startsWith(start))!;
const index = buildKeywordIndex(families, []);
const match = (name: string, idx = index, list = families) =>
  keywordCampaignMatch(name, list, idx);

describe("asignación por palabras del nombre de campaña", () => {
  it("cleans campaign names into whole tokens", () => {
    expect(Array.from(campaignTokens("CBO HER LOSS 0311 | CR"))).toEqual([
      "her",
      "loss",
    ]);
    expect(
      Array.from(campaignTokens("COST CAP_SELERB NAD---120211234567890123")),
    ).toEqual(["selerb", "nad"]);
  });
  it.each([
    ["CBO NEOCELL | CR", "Colágeno Neocell", "sku"],
    ["CBO HER LOSS 0311 | CR", "HER LOSS", "sku"],
    ["CBO GOMITAS | CR", "Gomitas de Shilajit", "palabra"],
    ["CBO shilajit gomitas | CR", "Gomitas de Shilajit", "sku"],
    ["COST CAP_SELERB NAD---120211234567890123", "NAD+ Men's Complex", "sku"],
    ["CBO NAD + RESVERATROL | CR", "NAD + Resveratrol", "nombre"],
    ["CBO Magnesium Complex | CR", "Magnesium Complex", "nombre"],
    ["CBO RETINOL CELIMAX | CR", "Retinol Celimax", "palabra"],
    ["CBO FAT BURN SHORTS | CR", "Fat‑Burn Shorts", "nombre"],
    ["Turkesterone | Ventas20260301220420", "Turkesterone", "sku"],
  ])("%s → %s (%s)", (name, product, tier) => {
    const result = match(name);
    expect(result).toMatchObject({ kind: "exact", tier });
    expect(result.family?.name.startsWith(product)).toBe(true);
  });
  it("needs a team rule for Shilajit Cápsulas and then assigns it", () => {
    expect(match("CBO Shilajit Capsulas | CR").kind).toBe("none");
    const rules: CampaignKeywordRule[] = [
      {
        keyword: "shilajit capsulas",
        family_key: family("Cápsulas de Shilajit").key,
        product_name: "Cápsulas de Shilajit",
      },
    ];
    const result = match(
      "CBO Shilajit Capsulas | CR",
      buildKeywordIndex(families, rules),
    );
    expect(result).toMatchObject({ kind: "exact", tier: "regla" });
    expect(result.family?.key).toBe(family("Cápsulas de Shilajit").key);
  });
  it("prefers the longer rule and reports ambiguity instead of guessing", () => {
    const rules = (keys: string[]): CampaignKeywordRule[] =>
      keys.map((key, i) => ({
        keyword: i ? "shilajit capsulas" : "shilajit",
        family_key: key,
        product_name: "x",
      }));
    // "shilajit" ⊂ "shilajit capsulas": the longer one wins.
    expect(
      match(
        "CBO Shilajit Capsulas | CR",
        buildKeywordIndex(
          families,
          rules([family("Shilajit 100%").key, family("Cápsulas de").key]),
        ),
      ).family?.key,
    ).toBe(family("Cápsulas de").key);
    // Same keyword for two products.
    const twice = buildKeywordIndex(families, [
      {
        keyword: "shilajit",
        family_key: family("Shilajit 100%").key,
        product_name: "a",
      },
      {
        keyword: "shilajit",
        family_key: family("Gomitas").key,
        product_name: "b",
      },
    ]);
    const result = match("CBO SHILAJIT | CR", twice);
    expect(result.kind).toBe("ambiguous");
    expect(result.candidates).toHaveLength(2);
    // Two products with the same name head.
    const twin = buildProductFamilies(
      [],
      [
        ...native.map(([shopify_id, title, skus]) => ({
          shopify_id,
          title,
          variants: skus.map((sku) => ({ sku, title: sku })),
        })),
        {
          shopify_id: "1",
          title: "Magnesium Complex – Gomitas",
          variants: [{ sku: "MAG.GOM", title: "MAG.GOM" }],
        },
      ],
    );
    expect(
      match("CBO Magnesium Complex | CR", buildKeywordIndex(twin, []), twin)
        .kind,
    ).toBe("ambiguous");
  });
  it("never matches a family that needs review or a rule to an unknown family", () => {
    const reviewed = families.map((f) =>
      f.name.startsWith("Turkesterone") ? { ...f, review: true } : f,
    );
    expect(
      match(
        "Turkesterone | Ventas20260301220420",
        buildKeywordIndex(reviewed, [
          {
            keyword: "turkesterone",
            family_key: family("Turkesterone").key,
            product_name: "t",
          },
        ]),
        reviewed,
      ).kind,
    ).toBe("none");
    expect(
      buildKeywordIndex(families, [
        { keyword: "algo", family_key: "family:shopify:0", product_name: "x" },
      ]).entries.some((e) => e.tier === "regla"),
    ).toBe(false);
  });
  it("comes after stored, learned and exact assignments", () => {
    const neocell = family("Colágeno Neocell");
    const assign = (
      name: string,
      stored?: CampaignProduct,
      learned: CampaignProduct[] = [],
    ) =>
      effectiveAssignment(
        stored,
        families,
        "meta",
        "1",
        "9",
        name,
        true,
        learned,
        index,
      );
    const keyword = assign("CBO GOMITAS | CR");
    expect(keyword).toMatchObject({
      product_key: family("Gomitas").key,
      family_key: family("Gomitas").key,
      variant_scope: "all",
      automatic: true,
      match_reason: "Palabra clave: GOMITAS",
    });
    // Stored manual assignment wins, and a disabled one stays disabled.
    const manual: CampaignProduct = {
      platform: "meta",
      account_id: "1",
      campaign_id: "9",
      product_key: neocell.key,
      product_name: neocell.name,
      sku: "",
      family_key: neocell.key,
      variant_scope: "all",
    };
    expect(assign("CBO GOMITAS | CR", manual)?.product_key).toBe(neocell.key);
    expect(
      assign("CBO GOMITAS | CR", { ...manual, variant_scope: "none" }),
    ).toBeNull();
    // A learned alias wins over the keyword.
    expect(
      assign("CBO GOMITAS | CR", undefined, [
        { ...manual, campaign_id: "8", campaign_alias: "gomitas" },
      ])?.match_reason,
    ).toBe("Alias aprendido: GOMITAS");
    // The exact SKU match keeps its variant selection.
    expect(assign("CBO NEOCELL | CR")).toMatchObject({
      variant_scope: "selected",
      match_reason: "SKU exacto y único",
    });
    // Without an index nothing new is assigned.
    expect(
      effectiveAssignment(
        undefined,
        families,
        "meta",
        "1",
        "9",
        "CBO GOMITAS | CR",
        true,
      ),
    ).toBeNull();
  });
});

describe("palabras del equipo que nunca coincidirían", () => {
  it("names the words dropped from campaign names", () => {
    expect(keywordProblem("selerb nad")).toBeNull();
    expect(keywordProblem("SELERB cap")).toBe(
      "Quita «CAP»: no cuenta al leer el nombre de la campaña.",
    );
    expect(keywordProblem("prueba 12345 neocell")).toBe(
      "Quita «PRUEBA», «12345»: no cuentan al leer el nombre de la campaña.",
    );
    expect(keywordProblem("gomitas 60")).toBeNull();
  });
});
