export const count = (value: number) =>
  new Intl.NumberFormat("es-CR").format(value);
export const money = (
  value: number | null | undefined,
  currency: string | null = "USD",
) =>
  value == null || !currency
    ? "Sin datos"
    : new Intl.NumberFormat("es-CR", {
        style: "currency",
        currency,
        currencyDisplay: "code",
        maximumFractionDigits: 2,
      }).format(value);
export const percentage = (value: number | null) =>
  value == null
    ? "Sin datos"
    : new Intl.NumberFormat("es-CR", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
export const shortDate = (date: string) =>
  new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
export {
  daysText as days,
  timeCrText as timeCr,
  dateTimeCrText as dateTimeCr,
} from "@/lib/marketing-copy";
/** Whole hours since an ISO time ("hace 30 h"). */
export const hoursAgo = (iso: string, now: Date = new Date()) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 3_600_000));
