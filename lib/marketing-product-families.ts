import type { CampaignProduct } from "./marketing-settings-types";
import type { MarketingProduct } from "./marketing";

export interface MarketingVariant {
  key: string;
  sku: string;
  name: string;
  historical?: boolean;
}
export interface MarketingFamily {
  key: string;
  name: string;
  members: MarketingVariant[];
  source: "shopify" | "name";
  review: boolean;
}
export interface MarketingGroupMetric extends MarketingProduct {
  familyKey: string;
  memberKeys: string[];
  scope: "all" | "selected";
}
export const normalProductName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
const signature = (s: string) =>
  normalProductName(s)
    .split(" ")
    .filter((w) => !["de", "del", "el", "la", "para"].includes(w))
    .sort()
    .join(" ");
export function campaignCore(name: string) {
  return name
    .replace(/^(?:(?:CBO|ABO|COST[ _-]*CAP|CAMPA[ÑN]A)\b[\s_|:-]*)+/i, "")
    .replace(/(?:[\s_|-]+(?:CR|CB|Costa[ _]Rica))+$/i, "")
    .trim();
}
export type ProductMatch = {
  kind: "exact" | "suggestion" | "ambiguous" | "none";
  family: MarketingFamily | null;
  variantKeys: string[] | null;
  reason: string;
  candidates: MarketingFamily[];
};
/** Exact unique aliases/SKU only. Token similarity is advisory and never assigns. */
export function matchCampaignProduct(
  name: string,
  families: MarketingFamily[],
): ProductMatch {
  const raw = campaignCore(name),
    core = raw.replace(/(?:[ _|-]+\d{4}(?:\d{4})?)$/, ""),
    needle = signature(core);
  const exactSku = families.flatMap((f) =>
    f.members
      .filter(
        (v) => v.sku && v.sku.toLocaleLowerCase() === raw.toLocaleLowerCase(),
      )
      .map((v) => ({ f, v })),
  );
  if (exactSku.length === 1 && !exactSku[0].f.review)
    return {
      kind: "exact",
      family: exactSku[0].f,
      variantKeys: [exactSku[0].v.key],
      reason: "SKU exacto y único",
      candidates: [exactSku[0].f],
    };
  const exact = families.filter((f) => {
    if (!f.members.length) return false;
    const aliases = [f.name, f.name.split(/\s[-–—]\s/)[0]];
    return aliases.some((a) => {
      const k = signature(a);
      return (
        k === needle &&
        (k.split(" ").length >= 2 || k.length >= 6) &&
        !["capsulas", "producto", "oferta", "pulsera", "shampoo"].includes(k)
      );
    });
  });
  if (
    exact.length === 1 &&
    !exact[0].review &&
    (exact[0].source === "shopify" || exact[0].members.length === 1) &&
    exactSku.length === 0
  )
    return {
      kind: "exact",
      family: exact[0],
      variantKeys: null,
      reason: "Nombre exacto y único del producto",
      candidates: exact,
    };
  if (
    exact.length > 1 ||
    exact.some(
      (f) => f.review || (f.source === "name" && f.members.length > 1),
    ) ||
    exactSku.length > 1 ||
    exactSku.some((x) => x.f.review)
  )
    return {
      kind: "ambiguous",
      family: null,
      variantKeys: null,
      reason: "La coincidencia corresponde a varios productos",
      candidates: exact.length
        ? exact
        : Array.from(new Set(exactSku.map((x) => x.f))),
    };
  const tokens = needle.split(" ").filter((w) => w.length > 2);
  const candidates = families
    .map((f) => ({
      f,
      score:
        tokens.filter((t) => normalProductName(f.name).split(" ").includes(t))
          .length / Math.max(1, tokens.length),
    }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.f);
  return {
    kind: candidates.length ? "suggestion" : "none",
    family: null,
    variantKeys: null,
    reason: candidates.length
      ? "Nombre parecido: requiere tu elección"
      : "Sin coincidencia exacta",
    candidates,
  };
}
export function effectiveAssignment(
  stored: CampaignProduct | undefined,
  families: MarketingFamily[],
  platform: "meta" | "tiktok",
  account: string,
  id: string,
  name: string,
  enabled: boolean,
): CampaignProduct | null {
  if (stored) return stored.variant_scope === "none" ? null : stored;
  if (!enabled) return null;
  const match = matchCampaignProduct(name, families);
  if (match.kind !== "exact" || !match.family) return null;
  const variant = match.variantKeys?.[0];
  return {
    platform,
    account_id: account,
    campaign_id: id,
    product_key: variant || match.family.key,
    product_name: match.family.name,
    sku: variant
      ? match.family.members.find((v) => v.key === variant)?.sku || ""
      : "",
    family_key: match.family.key,
    variant_scope: variant ? "selected" : "all",
    variant_keys: match.variantKeys ?? [],
    automatic: true,
    match_reason: match.reason,
  };
}

export function reportProductMetrics(
  summary: import("./marketing").MarketingSummary,
  assignments: CampaignProduct[],
): Array<
  MarketingProduct &
    Partial<Pick<MarketingGroupMetric, "familyKey" | "memberKeys" | "scope">>
> {
  if (!summary.groupedProducts) return summary.products;
  const out = [...summary.groupedProducts];
  for (const m of assignments)
    if (!out.some((p) => p.key === m.product_key)) {
      const variant = summary.products.find((p) => p.key === m.product_key);
      if (variant)
        out.push({
          ...variant,
          familyKey: m.family_key || "",
          memberKeys: [variant.key],
          scope: "selected",
        });
    }
  return out;
}
