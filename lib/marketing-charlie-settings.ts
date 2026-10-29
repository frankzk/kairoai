import { getDB } from "./db";
import { getMarketingUsdRate } from "./marketing-usd-rate";
import type {
  AdsetRole,
  CharlieConfig,
  CharlieSettings,
} from "./marketing-charlie-types";
export async function readCharlieConfig(
  storeId: number,
): Promise<CharlieConfig> {
  const result = await getDB()
    .from("marketing_charlie_config")
    .select("crc_per_usd,rate_date,hero_product_keys")
    .eq("store_id", storeId)
    .maybeSingle();
  if (result.error) throw new Error("Configuration unavailable");
  return (
    result.data ?? { crc_per_usd: null, rate_date: null, hero_product_keys: [] }
  );
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
  const [config, roles, official] = await Promise.all([
    readCharlieConfig(storeId),
    readRoles(),
    getMarketingUsdRate(),
  ]);
  const fx =
    config.crc_per_usd && config.rate_date
      ? {
          rate: config.crc_per_usd,
          date: config.rate_date,
          source: "manual" as const,
          checkedAt: new Date().toISOString(),
          message:
            "Referencia manual de planificación, no tipo de cambio histórico ni liquidación bancaria.",
        }
      : official;
  return { config, roles, fx };
}
