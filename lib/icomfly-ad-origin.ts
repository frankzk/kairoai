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
/** Read captured advertising fields only. Never search free-form customer notes for IDs. */
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
    id(campaign),
    suffix(campaign),
  ]);
  const mediumId = suffix(medium);
  const adsetId = choose("adset", [
    id(v.adset_id),
    mediumId,
    mediumId ? id(term) : null,
  ]);
  const adId = choose("ad", [id(v.ad_id), id(content), suffix(content)]);
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

/** Shopify saved note_attributes are query-encoded; native iComfly values are not. */
export function shopifyAdOrigin(attributes: unknown): Record<string, string> {
  const allowed =
    /^(utm_(source|medium|campaign|content|term|id)|campaign_id|adset_id|ad_id|channel)$/;
  const result: Record<string, string> = {};
  if (!Array.isArray(attributes)) return result;
  for (const item of attributes) {
    const key = text(item?.name).toLowerCase();
    if (!allowed.test(key) || typeof item?.value !== "string") continue;
    let value = text(item.value);
    // A literal '+' in already decoded values (e.g. NAD+) must survive.
    if (/%[0-9a-f]{2}/i.test(value)) {
      try {
        value = decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        /* keep captured text */
      }
    }
    result[key] = value;
  }
  return result;
}

/** Labels and placement names can differ while identifying the same ad. IDs cannot. */
export function mergeAdOrigins(origins: IcomflyAdOrigin[]): {
  origin: IcomflyAdOrigin | null;
  ambiguous: boolean;
} {
  if (!origins.length) return { origin: null, ambiguous: false };
  const ids = (field: "campaignId" | "adsetId" | "adId") =>
    Array.from(
      new Set(
        origins.map((o) => o[field]).filter((v): v is string => Boolean(v)),
      ),
    );
  const platforms = Array.from(
    new Set(origins.map((o) => o.platform).filter((p) => p && p !== "other")),
  );
  const campaigns = ids("campaignId"),
    sets = ids("adsetId"),
    ads = ids("adId");
  if ([campaigns, sets, ads, platforms].some((values) => values.length > 1))
    return { origin: null, ambiguous: true };
  const best = [...origins].sort(
    (a, b) =>
      Number(Boolean(b.campaignId)) - Number(Boolean(a.campaignId)) ||
      Number(Boolean(b.adId)) - Number(Boolean(a.adId)),
  )[0];
  const origin = {
    ...best,
    campaignId: campaigns[0] ?? null,
    adsetId: sets[0] ?? null,
    adId: ads[0] ?? null,
    platform: platforms[0] ?? best.platform,
    hasClick: origins.some((o) => o.hasClick),
    conflicts: Array.from(new Set(origins.flatMap((o) => o.conflicts))),
  };
  return { origin, ambiguous: false };
}

export interface OriginCampaign {
  platform: "meta" | "tiktok";
  accountId: string;
  campaignId: string;
}
/** Unknown utm_source can be resolved by an exact, uniquely verified campaign ID; never by name. */
export function resolveOriginCampaign(
  origin: IcomflyAdOrigin,
  catalog: OriginCampaign[],
): IcomflyAdOrigin {
  if (!origin.campaignId || origin.conflicts.length) return origin;
  const matches = catalog.filter((c) => c.campaignId === origin.campaignId);
  const identities = Array.from(
    new Map(
      matches.map((c) => [JSON.stringify([c.platform, c.accountId]), c]),
    ).values(),
  );
  if (identities.length !== 1) return origin;
  const platform = identities[0].platform;
  if (
    origin.platform &&
    origin.platform !== "other" &&
    origin.platform !== platform
  )
    return { ...origin, conflicts: [...origin.conflicts, "platform"] };
  return { ...origin, platform };
}
