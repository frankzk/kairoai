import type { MarketingCampaign } from "./marketing-source-types";
type Row = Record<string, unknown>;

/** Meta timestamps come as `2026-11-04T16:26:12-0600`; returns ISO UTC or null. */
export function metaTime(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export type MetaCampaignBudget = Pick<
  MarketingCampaign,
  | "id"
  | "name"
  | "dailyBudget"
  | "budgetKind"
  | "effectiveStatus"
  | "bidStrategy"
  | "bidAmount"
  | "bidAmountMixed"
  | "createdTime"
  | "startTime"
  | "updatedTime"
>;

/**
 * Campaign catalogue of one Meta account: budgets, bid strategy and bid amount
 * (the COST CAP lives on the ad sets), creation/start/last-edit times, and the
 * ad set → campaign map the activity log needs.
 */
export async function readMetaCampaignCatalog(
  base: string,
  currency: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<{
  campaigns: MetaCampaignBudget[];
  adsetCampaign: Map<string, string>;
}> {
  async function read(edge: string, fields: string) {
    const rows: Row[] = [];
    let after = "";
    for (let page = 0; page < 25; page++) {
      const url = new URL(`${base}/${edge}`);
      url.searchParams.set("fields", fields);
      url.searchParams.set("limit", "500");
      if (after) url.searchParams.set("after", after);
      const response = await fetcher(url, {
        headers,
        signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) throw new Error("Budget unavailable");
      const body = await response.json();
      if (body.error || !Array.isArray(body.data))
        throw new Error("Invalid budgets");
      rows.push(...body.data);
      if (!body.paging?.next) return rows;
      const cursor = body.paging?.cursors?.after;
      if (typeof cursor !== "string" || !cursor || cursor === after)
        throw new Error("Incomplete budgets");
      after = cursor;
    }
    throw new Error("Budget pagination limit");
  }
  const [campaigns, adsets] = await Promise.all([
    read(
      "campaigns",
      "id,name,effective_status,daily_budget,lifetime_budget,bid_strategy,created_time,start_time,updated_time",
    ),
    read(
      "adsets",
      "id,campaign_id,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,updated_time",
    ),
  ]);
  // The configured Costa Rica accounts use USD. Do not guess currency offsets for other currencies.
  const minor = (value: unknown) =>
    ["USD", "CRC"].includes(currency) && /^\d+$/.test(String(value ?? ""))
      ? Number(value) / 100
      : null;
  const adsetCampaign = new Map<string, string>();
  for (const set of adsets)
    if (
      typeof set.id === "string" &&
      set.id &&
      typeof set.campaign_id === "string" &&
      set.campaign_id
    )
      adsetCampaign.set(set.id, set.campaign_id);
  const unique = <T>(values: T[]) => Array.from(new Set(values));
  return {
    adsetCampaign,
    campaigns: campaigns.map((row) => {
      if (typeof row.id !== "string" || !row.id)
        throw new Error("Missing campaign");
      const daily = minor(row.daily_budget),
        lifetime = minor(row.lifetime_budget);
      const sets = adsets.filter(
        (set) =>
          set.campaign_id === row.id && set.effective_status === "ACTIVE",
      );
      let dailyBudget: number | null = null;
      let budgetKind: MarketingCampaign["budgetKind"] = "unavailable";
      if (daily != null && daily > 0) {
        dailyBudget = daily;
        budgetKind = "campaign";
      } else if (lifetime != null && lifetime > 0) budgetKind = "lifetime";
      else if (["USD", "CRC"].includes(currency)) {
        if (sets.some((set) => (minor(set.lifetime_budget) ?? 0) > 0))
          budgetKind = "mixed";
        else if (sets.every((set) => minor(set.daily_budget) != null)) {
          dailyBudget =
            Math.round(
              sets.reduce((sum, set) => sum + minor(set.daily_budget)!, 0) *
                100,
            ) / 100;
          budgetKind = "adsets";
        }
      }
      const setStrategies = unique(
        sets
          .map((set) => set.bid_strategy)
          .filter((v): v is string => typeof v === "string" && v !== ""),
      );
      const bidStrategy =
        typeof row.bid_strategy === "string" && row.bid_strategy
          ? row.bid_strategy
          : setStrategies.length === 1
            ? setStrategies[0]
            : null;
      const amounts = unique(
        sets
          .map((set) => minor(set.bid_amount))
          .filter((v): v is number => v != null && v > 0),
      );
      const updated = [row, ...sets]
        .map((entry) => metaTime(entry.updated_time))
        .filter((v): v is string => v != null)
        .sort();
      return {
        id: row.id,
        name: typeof row.name === "string" ? row.name : row.id,
        dailyBudget,
        budgetKind,
        effectiveStatus:
          typeof row.effective_status === "string" ? row.effective_status : "",
        bidStrategy,
        bidAmount: amounts.length === 1 ? amounts[0] : null,
        bidAmountMixed: amounts.length > 1,
        createdTime: metaTime(row.created_time),
        startTime: metaTime(row.start_time),
        updatedTime: updated[updated.length - 1] ?? null,
      };
    }),
  };
}

export async function readMetaBudgets(
  base: string,
  currency: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  return (
    await readMetaCampaignCatalog(base, currency, headers, signal, fetcher)
  ).campaigns;
}
