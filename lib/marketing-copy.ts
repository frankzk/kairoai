// Textos con números para Marketing (es-CR). Puro y usable en el navegador:
// las reglas de lib/ arman sus mensajes con los mismos formatos que la
// interfaz (components/marketing/format.ts).
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
