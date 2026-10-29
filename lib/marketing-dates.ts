export const MARKETING_DAY = 86_400_000;
export interface MarketingPeriod {
  from: string;
  to: string;
  start: number;
  end: number;
  days: number;
}
export type MarketingPreset =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "last-month"
  | "7d"
  | "14d"
  | "28d"
  | "30d"
  | "custom";

export function marketingDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
export function dateTime(date: string): number {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(`${date}T06:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === date
    ? time
    : NaN;
}
export const shiftDate = (date: string, days: number) =>
  new Date(dateTime(date) + days * MARKETING_DAY).toISOString().slice(0, 10);
export function marketingPeriod(
  from: string,
  to: string,
): MarketingPeriod | null {
  const start = dateTime(from),
    end = dateTime(to) + MARKETING_DAY;
  const days = (end - start) / MARKETING_DAY;
  return Number.isFinite(days) && days >= 1 && days <= 93
    ? { from, to, start, end, days }
    : null;
}
export function periodFromInput(
  input: string | { from: string; to: string },
): MarketingPeriod | null {
  if (typeof input !== "string") return marketingPeriod(input.from, input.to);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input)) return null;
  const [year, month] = input.split("-").map(Number);
  return marketingPeriod(
    `${input}-01`,
    new Date(Date.UTC(year, month, 0, 6)).toISOString().slice(0, 10),
  );
}
export function periodFromParams(
  params: URLSearchParams,
): MarketingPeriod | null {
  return params.has("from") || params.has("to")
    ? marketingPeriod(params.get("from") || "", params.get("to") || "")
    : periodFromInput(params.get("month") || "");
}
export function presetPeriod(
  preset: Exclude<MarketingPreset, "custom">,
  now = new Date(),
): MarketingPeriod {
  const today = marketingDate(now);
  let from = today,
    to = today;
  if (preset === "yesterday") from = to = shiftDate(today, -1);
  else if (preset === "week")
    from = shiftDate(today, -((new Date(dateTime(today)).getUTCDay() + 6) % 7));
  else if (preset === "month") from = `${today.slice(0, 7)}-01`;
  else if (preset === "last-month") {
    to = shiftDate(`${today.slice(0, 7)}-01`, -1);
    from = `${to.slice(0, 7)}-01`;
  } else if (/^\d+d$/.test(preset))
    from = shiftDate(today, -(Number(preset.slice(0, -1)) - 1));
  return marketingPeriod(from, to)!;
}
export const previousPeriod = (period: MarketingPeriod) =>
  marketingPeriod(
    shiftDate(period.from, -period.days),
    shiftDate(period.from, -1),
  )!;
export const periodQuery = (period: Pick<MarketingPeriod, "from" | "to">) =>
  `store=mireva-cr&from=${period.from}&to=${period.to}`;
