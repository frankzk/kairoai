import { periodFromInput, type MarketingPeriod } from "./marketing-dates";
import { MARKETING_TIMEZONE } from "./marketing";
import type { MarketingSources } from "./marketing-source-types";

const money = (value: number) => Math.round(value * 100) / 100;

/** A monthly report can share the order denominator only when its calendar boundaries match. */
function matchesOrderCalendar(
  timezone: string,
  input: string | Pick<MarketingPeriod, "from" | "to">,
): boolean {
  const range = periodFromInput(input);
  if (!range) return false;
  try {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    };
    const account = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: timezone,
    });
    const orders = new Intl.DateTimeFormat("en-CA", {
      ...options,
      timeZone: MARKETING_TIMEZONE,
    });
    return [range.start, range.end - 1].every(
      (date) => account.format(date) === orders.format(date),
    );
  } catch {
    return false;
  }
}

/** Platform spend is separate from manual CRC expenses to avoid duplicate counting and currency conversion. */
export function buildMarketingAdsSummary(
  sources: MarketingSources | null,
  period: string | Pick<MarketingPeriod, "from" | "to">,
  generated: number,
  delivered: number,
) {
  const byCurrency = new Map<string, number>();
  const providers: string[] = [];
  let accountCount = 0;
  let aligned = true;
  for (const [key, name] of [
    ["meta", "Meta"],
    ["tiktok", "TikTok"],
  ] as const) {
    const source = sources?.[key];
    if (source?.status !== "ready" || !source.data?.accounts.length) continue;
    providers.push(name);
    for (const account of source.data.accounts) {
      accountCount++;
      aligned = aligned && matchesOrderCalendar(account.timezone, period);
      byCurrency.set(
        account.currency,
        (byCurrency.get(account.currency) ?? 0) +
          account.campaigns.reduce((sum, campaign) => sum + campaign.spend, 0),
      );
    }
  }
  const breakdown = Array.from(byCurrency, ([currency, spend]) => ({
    currency,
    spend: money(spend),
  }));
  const single = breakdown.length === 1 ? breakdown[0] : null;
  const comparable = single && aligned;
  return {
    providers,
    accountCount,
    breakdown,
    partial: providers.length < 2,
    aligned,
    currency: single?.currency ?? null,
    spend: single?.spend ?? null,
    costPerGenerated:
      comparable && generated > 0 ? money(single.spend / generated) : null,
    costPerDelivered:
      comparable && delivered > 0 ? money(single.spend / delivered) : null,
  };
}
