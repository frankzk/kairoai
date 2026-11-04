import { describe, expect, it } from "vitest";
import {
  campaignAlias,
  effectiveAssignment,
  learnedCampaignMatch,
  type MarketingFamily,
} from "../lib/marketing-product-families";
import type { CampaignProduct } from "../lib/marketing-settings-types";
const family: MarketingFamily = {
  key: "family:shopify:42",
  name: "Fat-Burn Shorts - Compresión",
  source: "shopify",
  review: false,
  members: [
    { key: "sku:black", sku: "BLACK", name: "Negro" },
    { key: "sku:beige", sku: "BEIGE", name: "Beige" },
  ],
};
const other: MarketingFamily = {
  ...family,
  key: "family:shopify:43",
  name: "Otro producto",
  members: [{ key: "sku:other", sku: "OTHER", name: "Otro" }],
};
const rule: CampaignProduct = {
  platform: "tiktok",
  account_id: "10",
  campaign_id: "20",
  product_key: family.key,
  product_name: family.name,
  sku: "",
  family_key: family.key,
  variant_scope: "all",
  variant_keys: [],
  campaign_alias: "fat burn",
};
const assign = (
  name: string,
  rules: CampaignProduct[] = [rule],
  enabled = true,
) =>
  effectiveAssignment(
    undefined,
    [family, other],
    "meta",
    "100",
    "200",
    name,
    enabled,
    rules,
  );
describe("Learned campaign aliases", () => {
  it("normalizes FAT BURN_CB and known wrappers consistently across platforms", () => {
    for (const name of [
      "FAT BURN_CB",
      "CBO FAT BURN | CR",
      "ABO_FAT BURN | CR",
      "Fat-Burn",
    ]) {
      expect(campaignAlias(name)).toBe("fat burn");
      expect(assign(name)).toMatchObject({
        platform: "meta",
        account_id: "100",
        campaign_id: "200",
        product_key: family.key,
        variant_scope: "all",
        automatic: true,
        campaign_alias: null,
      });
    }
    expect(
      effectiveAssignment(
        undefined,
        [family],
        "tiktok",
        "101",
        "201",
        "FAT BURN_CB",
        true,
        [{ ...rule, platform: "meta" }],
      )?.product_key,
    ).toBe(family.key);
  });
  it("does not learn from automatic assignments, missing settings or similar names", () => {
    expect(assign("FAT BURN_CB", [{ ...rule, automatic: true }])).toBeNull();
    expect(assign("FAT BURN_CB", [rule], false)).toBeNull();
    expect(assign("FAT BURN gomitas")).toBeNull();
    expect(assign("FAT BURN ROJO")).toBeNull();
    expect(assign("FAT BURN_CB", [])).toBeNull();
    expect(campaignAlias("CBO Ventas | CR")).toBeNull();
  });
  it("preserves a learned variant subset and does not broaden to all variants", () => {
    const subset = {
      ...rule,
      product_key: "sku:black",
      variant_scope: "selected" as const,
      variant_keys: ["sku:black"],
    };
    expect(assign("FAT BURN_CB", [subset])).toMatchObject({
      product_key: "sku:black",
      variant_scope: "selected",
      variant_keys: ["sku:black"],
    });
    expect(
      learnedCampaignMatch("FAT BURN_CB", [family], [rule, subset]).kind,
    ).toBe("ambiguous");
  });
  it("blocks conflicting products or obsolete variants instead of choosing the first rule", () => {
    const conflicting = {
      ...rule,
      product_key: other.key,
      family_key: other.key,
    };
    expect(assign("FAT BURN_CB", [rule, conflicting])).toBeNull();
    expect(assign("FAT BURN_CB", [conflicting, rule])).toBeNull();
    expect(
      assign("FAT BURN_CB", [
        { ...rule, variant_scope: "selected", variant_keys: ["sku:missing"] },
      ]),
    ).toBeNull();
    expect(
      assign("FAT BURN_CB", [
        rule,
        { ...rule, platform: "meta", account_id: "99" },
      ])?.product_key,
    ).toBe(family.key);
  });
  it("keeps manual campaign overrides and disables above learned aliases", () => {
    for (const stored of [
      { ...rule, product_key: other.key },
      { ...rule, variant_scope: "none" as const },
    ]) {
      expect(
        effectiveAssignment(
          stored,
          [family, other],
          "meta",
          "100",
          "200",
          "FAT BURN_CB",
          true,
          [rule],
        ),
      ).toBe(stored.variant_scope === "none" ? null : stored);
    }
  });
  it("does not let learned aliases override a different exact catalog product", () => {
    const wrong = { ...rule, campaign_alias: "other", product_key: family.key };
    expect(assign("OTHER", [wrong])).toBeNull();
  });
});
