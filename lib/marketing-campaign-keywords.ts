// Auto-asignación de producto por palabras del nombre de la campaña
// (documento de mejoras, A5): "NEOCELL" es Colágeno, "HER LOSS" es Her Loss,
// "GOMITAS" es Gomitas. Va después de la asignación guardada, del alias
// aprendido y de la coincidencia exacta; siempre se puede corregir a mano.
import {
  campaignCore,
  type MarketingFamily,
} from "./marketing-product-families";
import {
  normalKeyword,
  type CampaignKeywordRule,
} from "./marketing-settings-types";

export { normalKeyword };
export type { CampaignKeywordRule };

export type KeywordTier = "regla" | "sku" | "nombre" | "palabra";
export interface KeywordIndex {
  entries: Array<{
    words: string[];
    familyKey: string;
    tier: KeywordTier;
    keyword: string;
  }>;
}
export interface KeywordMatch {
  kind: "exact" | "ambiguous" | "none";
  family: MarketingFamily | null;
  keyword: string | null;
  tier: KeywordTier | null;
  candidates: MarketingFamily[];
}

const TIERS: KeywordTier[] = ["regla", "sku", "nombre", "palabra"];
const CAMPAIGN_NOISE = new Set([
  "cr",
  "cbo",
  "abo",
  "cost",
  "cap",
  "ventas",
  "campana",
  "test",
  "testing",
  "prueba",
]);
const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "para",
  "con",
  "y",
  "x",
  "pack",
  "en",
  "por",
  "sin",
  "al",
  "un",
  "una",
  "su",
  "sus",
  "tu",
  "tus",
  "que",
  "mas",
  "the",
  "and",
  "for",
  "with",
]);
const GENERIC = new Set(
  "capsulas crema shampoo aceite serum soporte pulsera mini suplemento formula magnetica cobre celular cabello alivio premium natural complex puro himalaya original oferta ventas control prueba testing".split(
    " ",
  ),
);

const isDigits = (word: string) => /^\d+$/.test(word);

/** Tokens of a campaign name, without wrappers, account tags and long ids. */
export function campaignTokens(name: string): Set<string> {
  return new Set(
    normalKeyword(campaignCore(name))
      .split(" ")
      .filter(
        (w) => w && !(isDigits(w) && w.length >= 4) && !CAMPAIGN_NOISE.has(w),
      ),
  );
}

/**
 * Why a team keyword could never match, or null. Campaign names lose the
 * account and type words (CR, CBO, COST CAP, prueba…) and ids of 4+ digits
 * before matching, so a rule with them would be saved but never assign.
 */
export function keywordProblem(keyword: string): string | null {
  const words = normalKeyword(keyword).split(" ").filter(Boolean);
  const noise = words.filter(
    (w) => CAMPAIGN_NOISE.has(w) || (isDigits(w) && w.length >= 4),
  );
  if (!noise.length) return null;
  return `Quita ${noise.map((w) => `«${w.toLocaleUpperCase("es")}»`).join(", ")}: no cuenta${noise.length > 1 ? "n" : ""} al leer el nombre de la campaña.`;
}

/** Product name up to its first separator: "HER LOSS – Colonia…" → "her loss". */
function nameHead(name: string): string[] {
  const head = name.split(/\s[-–—|:]\s|:\s|\s\(/)[0] ?? "";
  const words = normalKeyword(head)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w));
  const text = words.join(" ");
  return text.length >= 4 && words.length <= 5 ? words : [];
}

function skuWords(sku: string): string[] {
  const words = normalKeyword(sku).split(" ").filter(Boolean);
  const letters = words.join("").replace(/[^a-z]/g, "").length;
  return letters >= 4 && !words.every(isDigits) ? words : [];
}

export function buildKeywordIndex(
  families: MarketingFamily[],
  rules: CampaignKeywordRule[],
): KeywordIndex {
  const usable = families.filter((f) => !f.review && f.members.length > 0);
  const known = new Set(usable.map((f) => f.key));
  const entries: KeywordIndex["entries"] = [];
  const seen = new Set<string>();
  const push = (tier: KeywordTier, familyKey: string, words: string[]) => {
    if (!words.length) return;
    const keyword = words.join(" ");
    const id = `${tier}|${familyKey}|${[...words].sort().join(" ")}`;
    if (seen.has(id)) return;
    seen.add(id);
    entries.push({
      words: Array.from(new Set(words)),
      familyKey,
      tier,
      keyword,
    });
  };
  for (const rule of rules) {
    const words = normalKeyword(rule.keyword).split(" ").filter(Boolean);
    if (known.has(rule.family_key)) push("regla", rule.family_key, words);
  }
  const vocabulary = new Map<string, Set<string>>();
  for (const family of usable) {
    const words = new Set<string>();
    for (const member of family.members) {
      const sku = skuWords(member.sku);
      push("sku", family.key, sku);
      sku.forEach((w) => words.add(w));
    }
    const head = nameHead(family.name);
    push("nombre", family.key, head);
    head.forEach((w) => words.add(w));
    normalKeyword(family.name)
      .split(" ")
      .forEach((w) => words.add(w));
    for (const word of Array.from(words)) {
      const owners = vocabulary.get(word) ?? new Set<string>();
      owners.add(family.key);
      vocabulary.set(word, owners);
    }
  }
  for (const [word, owners] of Array.from(vocabulary))
    if (
      owners.size === 1 &&
      word.length >= 5 &&
      !isDigits(word) &&
      !GENERIC.has(word) &&
      !STOPWORDS.has(word) &&
      !CAMPAIGN_NOISE.has(word)
    )
      push("palabra", Array.from(owners)[0], [word]);
  return { entries };
}

/**
 * An entry matches when all its words are whole tokens of the campaign name.
 * The first tier with a match decides; inside it, an entry whose words are a
 * strict subset of another match is ignored. One family = exact; several =
 * ambiguous (nothing is assigned).
 */
export function keywordCampaignMatch(
  name: string,
  families: MarketingFamily[],
  index: KeywordIndex,
): KeywordMatch {
  const tokens = campaignTokens(name);
  const byKey = new Map(families.map((f) => [f.key, f]));
  for (const tier of TIERS) {
    const matched = index.entries.filter(
      (e) =>
        e.tier === tier &&
        byKey.has(e.familyKey) &&
        e.words.every((w) => tokens.has(w)),
    );
    if (!matched.length) continue;
    const kept = matched.filter(
      (e) =>
        !matched.some(
          (other) =>
            other.words.length > e.words.length &&
            e.words.every((w) => other.words.includes(w)),
        ),
    );
    const keys = Array.from(new Set(kept.map((e) => e.familyKey)));
    const candidates = keys.map((k) => byKey.get(k)!);
    if (keys.length === 1)
      return {
        kind: "exact",
        family: candidates[0],
        keyword: kept[0].keyword,
        tier,
        candidates,
      };
    return { kind: "ambiguous", family: null, keyword: null, tier, candidates };
  }
  return {
    kind: "none",
    family: null,
    keyword: null,
    tier: null,
    candidates: [],
  };
}
