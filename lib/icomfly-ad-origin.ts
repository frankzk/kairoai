export interface IcomflyAdOrigin {
  platform: "meta" | "tiktok" | "google" | "other" | null;
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  campaignName: string;
  adsetName: string;
  adName: string;
  hasClick: boolean;
  origin: string;
  conflicts: string[];
}
const text = (v: unknown) =>
  typeof v === "string" ? v.trim().slice(0, 2000) : "";
const id = (v: unknown): string | null => {
  const s =
    typeof v === "number" && Number.isSafeInteger(v) ? String(v) : text(v);
  return /^[1-9]\d{5,30}$/.test(s) ? s : null;
};
const suffix = (v: string) => id(/-{2,}([1-9]\d{5,30})$/.exec(v)?.[1]);
const name = (v: string) => v.replace(/-{2,}[1-9]\d{5,30}$/, "").trim();
/** Only the order's ad_origin is authoritative. Never search customer notes for IDs. */
export function readIcomflyAdOrigin(value: unknown): IcomflyAdOrigin | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const source = text(v.utm_source),
    medium = text(v.utm_medium),
    campaign = text(v.utm_campaign),
    content = text(v.utm_content),
    term = text(v.utm_term);
  const channel = text(v.channel).toLowerCase(),
    lower = source.toLowerCase();
  const platform =
    /^(facebook|instagram|fb(?:_|$)|ig(?:_|$)|meta|messenger|an$|audience)/.test(
      lower,
    ) || /^(facebook|instagram|meta)$/.test(channel)
      ? "meta"
      : /tiktok|^tt$/.test(lower) || channel === "tiktok"
        ? "tiktok"
        : /google|gads|adwords|youtube/.test(lower) ||
            /^(google|youtube)$/.test(channel)
          ? "google"
          : lower || channel
            ? "other"
            : null;
  const conflicts: string[] = [];
  const choose = (field: string, candidates: Array<string | null>) => {
    const ids = Array.from(
      new Set(candidates.filter((s): s is string => Boolean(s))),
    );
    if (ids.length > 1) {
      conflicts.push(field);
      return null;
    }
    return ids[0] ?? null;
  };
  const campaignId = choose("campaign", [
    id(v.campaign_id),
    id(v.utm_id),
    suffix(campaign),
  ]);
  const mediumId = suffix(medium);
  const adsetId = choose("adset", [
    id(v.adset_id),
    mediumId,
    mediumId ? id(term) : null,
  ]);
  const adId = choose("ad", [id(v.ad_id), suffix(content)]);
  const hasClick = Boolean(text(v.fbclid) || text(v.ttclid) || text(v.gclid));
  if (
    ![source, medium, campaign, content, term, campaignId, adsetId, adId].some(
      Boolean,
    ) &&
    !hasClick
  )
    return null;
  return {
    platform,
    source,
    medium,
    campaign,
    content,
    term,
    campaignId,
    adsetId,
    adId,
    campaignName: name(campaign),
    adsetName: /^(paid|cpc|cpm|social|paid_social|ads?)$/i.test(medium)
      ? ""
      : name(medium),
    adName: name(content),
    hasClick,
    origin: text(v.origen),
    conflicts,
  };
}
