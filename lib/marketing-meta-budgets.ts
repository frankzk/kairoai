import type { MarketingCampaign } from "./marketing-source-types";
type Row = Record<string, unknown>;
export async function readMetaBudgets(
  base: string,
  currency: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
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
    read("campaigns", "id,name,effective_status,daily_budget,lifetime_budget"),
    read(
      "adsets",
      "id,campaign_id,effective_status,daily_budget,lifetime_budget",
    ),
  ]);
  // The configured Costa Rica accounts use USD. Do not guess currency offsets for other currencies.
  const minor = (value: unknown) =>
    ["USD", "CRC"].includes(currency) && /^\d+$/.test(String(value ?? ""))
      ? Number(value) / 100
      : null;
  return campaigns.map((row) => {
    if (typeof row.id !== "string" || !row.id)
      throw new Error("Missing campaign");
    const daily = minor(row.daily_budget),
      lifetime = minor(row.lifetime_budget);
    let dailyBudget: number | null = null;
    let budgetKind: MarketingCampaign["budgetKind"] = "unavailable";
    if (daily != null && daily > 0) {
      dailyBudget = daily;
      budgetKind = "campaign";
    } else if (lifetime != null && lifetime > 0) budgetKind = "lifetime";
    else if (["USD", "CRC"].includes(currency)) {
      const sets = adsets.filter(
        (set) =>
          set.campaign_id === row.id && set.effective_status === "ACTIVE",
      );
      if (sets.some((set) => (minor(set.lifetime_budget) ?? 0) > 0))
        budgetKind = "mixed";
      else if (sets.every((set) => minor(set.daily_budget) != null)) {
        dailyBudget =
          Math.round(
            sets.reduce((sum, set) => sum + minor(set.daily_budget)!, 0) * 100,
          ) / 100;
        budgetKind = "adsets";
      }
    }
    return {
      id: row.id,
      name: typeof row.name === "string" ? row.name : row.id,
      dailyBudget,
      budgetKind,
      effectiveStatus:
        typeof row.effective_status === "string" ? row.effective_status : "",
    };
  });
}
