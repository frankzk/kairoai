import { marketingDate, dateTime, MARKETING_DAY } from "./marketing-dates";
import type { UsdRate } from "./marketing-charlie-types";
let cached: UsdRate | null = null;
export async function getMarketingUsdRate(
  fetcher: typeof fetch = fetch,
  now = new Date(),
  cache = true,
): Promise<UsdRate> {
  if (cache && cached && now.getTime() - Date.parse(cached.checkedAt) < 900_000)
    return cached;
  const checkedAt = now.toISOString();
  try {
    const response = await fetcher(
      "https://api.hacienda.go.cr/indicadores/tc/dolar",
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) throw new Error();
    const body = await response.json(),
      rate = body?.venta?.valor,
      date = body?.venta?.fecha;
    const age =
      typeof date === "string"
        ? (dateTime(marketingDate(now)) - dateTime(date)) / MARKETING_DAY
        : NaN;
    if (
      typeof rate !== "number" ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      rate > 100_000 ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 4
    )
      throw new Error();
    const result: UsdRate = {
      rate,
      date,
      checkedAt,
      source: "hacienda",
      message:
        "Referencia de venta de Hacienda. Períodos anteriores reexpresados a esta tasa, no tipo de cambio histórico ni liquidación bancaria.",
    };
    if (cache) cached = result;
    return result;
  } catch {
    return {
      rate: null,
      date: null,
      source: "unavailable",
      checkedAt,
      message:
        "No se pudo verificar una referencia vigente. Los importes CRC quedan pendientes de conversión.",
    };
  }
}
export const asUsd = (
  amount: number | null | undefined,
  currency: string | null,
  fx: UsdRate | null,
): number | null =>
  amount == null || !Number.isFinite(amount)
    ? null
    : currency === "USD"
      ? amount
      : currency === "CRC" && fx?.rate && fx.rate > 0
        ? amount / fx.rate
        : null;
