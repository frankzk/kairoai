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
