import { getDB } from "./db";
import { getMarketingPenRate, getMarketingUsdRate } from "./marketing-usd-rate";
import type {
  AdsetRole,
  CharlieConfig,
  CharlieSettings,
  PenRate,
} from "./marketing-charlie-types";
const CONFIG_COLUMNS = "crc_per_usd,rate_date,hero_product_keys";
/** Postgres/PostgREST "undefined column": 20261105120600 not applied yet. */
const missingColumn = (error: { code?: string } | null) =>
  ["42703", "PGRST204"].includes(String(error?.code));

export async function readCharlieConfig(
  storeId: number,
): Promise<CharlieConfig> {
  const read = (columns: string) =>
    getDB()
      .from("marketing_charlie_config")
      .select(columns)
      .eq("store_id", storeId)
      .maybeSingle();
  let result = await read(`${CONFIG_COLUMNS},pen_per_usd,pen_rate_date`);
  // Before the PEN migration: same configuration without the manual PEN rate.
  if (missingColumn(result.error)) result = await read(CONFIG_COLUMNS);
  if (result.error) throw new Error("Configuration unavailable");
  const data = result.data as unknown as CharlieConfig | null;
  if (!data)
    return { crc_per_usd: null, rate_date: null, hero_product_keys: [] };
  return {
    ...data,
    crc_per_usd: data.crc_per_usd == null ? null : Number(data.crc_per_usd),
    ...("pen_per_usd" in data
      ? {
          pen_per_usd:
            data.pen_per_usd == null ? null : Number(data.pen_per_usd),
        }
      : {}),
  };
}

/** Manual PEN rate when both the rate and its date are set; else the BCRP one. */
export function appliedPenRate(
  config: CharlieConfig,
  official: PenRate | null,
): PenRate | null {
  const rate = Number(config.pen_per_usd);
  return config.pen_per_usd != null &&
    Number.isFinite(rate) &&
    rate > 0 &&
    rate < 100 &&
    config.pen_rate_date
    ? {
        rate,
        date: String(config.pen_rate_date).slice(0, 10),
        source: "manual",
      }
    : official;
}
export async function readCharlieSettings(
  storeId: number,
): Promise<CharlieSettings> {
  const readRoles = async () => {
    const rows: AdsetRole[] = [];
    for (let page = 0; page < 10; page++) {
      const result = await getDB()
        .from("marketing_adset_roles")
        .select("account_id,adset_id,role,updated_at")
        .eq("store_id", storeId)
        .order("account_id")
        .order("adset_id")
        .range(page * 1000, page * 1000 + 999);
      if (result.error || !result.data) throw new Error("Roles unavailable");
      rows.push(...(result.data as AdsetRole[]));
      if (result.data.length < 1000) return rows;
    }
    throw new Error("Roles pagination limit");
  };
  const [config, roles, official, bcrp] = await Promise.all([
    readCharlieConfig(storeId),
    readRoles(),
    getMarketingUsdRate(),
    // TikTok Costa Rica cobra en soles: sin esto su gasto no entra al CPA combinado.
    getMarketingPenRate(),
  ]);
  const pen = appliedPenRate(config, bcrp);
  const fx =
    config.crc_per_usd && config.rate_date
      ? {
          rate: config.crc_per_usd,
          date: config.rate_date,
          source: "manual" as const,
          checkedAt: new Date().toISOString(),
          message:
            "Referencia manual de planificación, no tipo de cambio histórico ni liquidación bancaria.",
          pen,
        }
      : { ...official, pen };
  return { config, roles, fx };
}
