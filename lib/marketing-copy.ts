// Textos con números para Marketing (es-CR). Puro y usable en el navegador:
// las reglas de lib/ arman sus mensajes con los mismos formatos que la
// interfaz (components/marketing/format.ts).
import { shiftDate } from "./marketing-dates";

const NUMBER = new Intl.NumberFormat("es-CR");
const ONE_DECIMAL = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Same output as `money()` in components/marketing/format.ts ("USD 8,50"). */
export const moneyText = (
  value: number | null | undefined,
  currency: string | null = "USD",
) =>
  value == null || !currency || !Number.isFinite(value)
    ? "Sin datos"
    : new Intl.NumberFormat("es-CR", {
        style: "currency",
        currency,
        currencyDisplay: "code",
        maximumFractionDigits: 2,
      }).format(value);

export const countText = (value: number) => NUMBER.format(value);

/** One decimal: "16,7". */
export const decimalText = (value: number) => ONE_DECIMAL.format(value);

/** Coverage days: "2,4 días" under 10 days, "125 días" above. */
export const daysText = (days: number) =>
  `${days < 10 ? ONE_DECIMAL.format(days) : NUMBER.format(Math.round(days))} días`;

/** "3 nov" for a YYYY-MM-DD date. */
export const shortDateText = (date: string) =>
  new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

/** "14:35" in Costa Rica. */
export const timeCrText = (value: string | Date) =>
  new Intl.DateTimeFormat("es-CR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Costa_Rica",
  }).format(typeof value === "string" ? new Date(value) : value);

/** "4 nov, 16:26" in Costa Rica. */
export const dateTimeCrText = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;
  const day = new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    timeZone: "America/Costa_Rica",
  }).format(date);
  return `${day}, ${timeCrText(date)}`;
};

/** Whether the selected period reaches today (Costa Rica): today's numbers are still moving. */
export const periodIncludesToday = (
  period: { from: string; to: string },
  today: string,
) => period.from <= today && period.to >= today;

/** Whether the selected period is exactly today. */
export const periodIsToday = (
  period: { from: string; to: string },
  today: string,
) => period.from === today && period.to === today;

/**
 * Name of the selected period for labels: "Hoy", "Ayer", "6 nov",
 * "1 al 6 nov", "28 oct al 3 nov". `withDate` adds the date to Hoy/Ayer
 * ("Ayer · 6 nov"). Labels of numbers that depend on the period use this
 * instead of a fixed "hoy".
 */
export function periodLabelText(
  period: { from: string; to: string },
  today: string,
  options: { withDate?: boolean } = {},
): string {
  const { from, to } = period;
  if (from === to) {
    const relative =
      to === today ? "Hoy" : to === shiftDate(today, -1) ? "Ayer" : null;
    if (!relative) return shortDateText(to);
    return options.withDate ? `${relative} · ${shortDateText(to)}` : relative;
  }
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${sameMonth ? String(Number(from.slice(8, 10))) : shortDateText(from)} al ${shortDateText(to)}`;
}
