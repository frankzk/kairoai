import { marketingDate, dateTime, MARKETING_DAY } from "./marketing-dates";
import type { PenRate, UsdRate } from "./marketing-charlie-types";
let cached: UsdRate | null = null;
let cachedPen: { at: number; value: PenRate | null } | null = null;

const MESES: Record<string, string> = {
  Ene: "01", Jan: "01", Feb: "02", Mar: "03", Abr: "04", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Ago: "08", Aug: "08", Set: "09", Sep: "09", Oct: "10", Nov: "11", Dic: "12", Dec: "12",
};

/** "30.Oct.26" (formato del BCRP) -> "2026-10-30", o null. */
export function fechaBcrp(name: string): string | null {
  const m = /^(\d{2})\.([A-Za-z]{3})\.(\d{2})$/.exec(String(name).trim());
  const mes = m ? MESES[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()] : undefined;
  return m && mes ? `20${m[3]}-${mes}-${m[1]}` : null;
}

/**
 * El ultimo tipo de cambio publicado en la respuesta del BCRP (los dias sin
 * dato vienen "n.d."). Puro: se prueba sin red.
 */
export function ultimoTipoBcrp(body: unknown): { rate: number; date: string } | null {
  const periods = (body as { periods?: Array<{ name?: string; values?: unknown[] }> } | null)?.periods;
  if (!Array.isArray(periods)) return null;
  for (let i = periods.length - 1; i >= 0; i--) {
    const rate = Number(periods[i]?.values?.[0]);
    const date = fechaBcrp(String(periods[i]?.name ?? ""));
    if (date && Number.isFinite(rate) && rate > 0 && rate < 100) return { rate, date };
  }
  return null;
}

/**
 * Soles por dolar: venta del sistema bancario (SBS) publicada por el Banco
 * Central de Reserva del Peru, serie PD04640PD. Sin dato de los ultimos 7
 * dias, null: mejor sin convertir que con una tasa vieja.
 */
export async function getMarketingPenRate(
  fetcher: typeof fetch = fetch,
  now = new Date(),
  cache = true,
): Promise<PenRate | null> {
  if (cache && cachedPen && now.getTime() - cachedPen.at < 900_000) return cachedPen.value;
  const hoy = marketingDate(now);
  const desde = marketingDate(new Date(now.getTime() - 10 * MARKETING_DAY));
  let value: PenRate | null = null;
  try {
    const response = await fetcher(
      `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04640PD/json/${desde}/${hoy}`,
      { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) throw new Error();
    const ultimo = ultimoTipoBcrp(await response.json());
    const age = ultimo ? (dateTime(hoy) - dateTime(ultimo.date)) / MARKETING_DAY : NaN;
    if (ultimo && Number.isFinite(age) && age >= 0 && age <= 7) value = { ...ultimo, source: "bcrp" };
  } catch {
    value = null;
  }
  if (cache) cachedPen = { at: now.getTime(), value };
  return value;
}
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
        : currency === "PEN" && fx?.pen?.rate && fx.pen.rate > 0
          ? amount / fx.pen.rate
          : null;
