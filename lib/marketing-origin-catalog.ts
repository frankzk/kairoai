import { getDB } from "./db";
import type { MarketingSources } from "./marketing-source-types";
import type { OriginCampaign } from "./icomfly-ad-origin";

const section = "marketing_attribution_catalog";
const valid = (v: unknown): v is OriginCampaign => {
  const c = v as OriginCampaign | null;
  return Boolean(
    c &&
      ["meta", "tiktok"].includes(c.platform) &&
      typeof c.accountId === "string" &&
      /^\d+$/.test(c.accountId) &&
      typeof c.campaignId === "string" &&
      /^[1-9]\d{5,30}$/.test(c.campaignId),
  );
};
async function read(storeId: number) {
  const { data, error } = await getDB()
    .from("finance_dataset_cache")
    .select("payload,refreshed_at")
    .eq("store_id", storeId)
    .eq("section", section)
    .maybeSingle();
  if (error) throw new Error("No se pudo consultar el catálogo publicitario.");
  return {
    entities: (Array.isArray(data?.payload?.entities)
      ? data.payload.entities
      : []
    ).filter(valid) as OriginCampaign[],
    refreshedAt: data?.refreshed_at as string | undefined,
  };
}
export async function readOriginCatalog(storeId: number) {
  return (await read(storeId)).entities;
}
/** Keep verified native campaign IDs across periods. This cache contains no order/customer data. */
export async function rememberOriginCatalog(
  storeId: number,
  sources: MarketingSources,
) {
  const incoming: OriginCampaign[] = [];
  for (const platform of ["meta", "tiktok"] as const) {
    const source = sources[platform];
    if (source.status !== "ready") continue;
    for (const account of source.data?.accounts ?? [])
      for (const campaign of account.campaigns) {
        const item = {
          platform,
          accountId: account.accountId.replace(/^act_/, ""),
          campaignId: campaign.id,
        };
        if (valid(item)) incoming.push(item);
      }
  }
  if (!incoming.length) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await read(storeId);
    const entities = Array.from(
      new Map(
        [...previous.entities, ...incoming].map((c) => [
          JSON.stringify([c.platform, c.accountId, c.campaignId]),
          c,
        ]),
      ).values(),
    );
    if (entities.length > 50000) throw new Error("Catálogo demasiado grande.");
    const record = {
      payload: { version: 1, entities },
      row_count: entities.length,
      refreshed_at: new Date().toISOString(),
    };
    if (!previous.refreshedAt) {
      const { error } = await getDB()
        .from("finance_dataset_cache")
        .insert({ store_id: storeId, section, ...record });
      if (!error) return;
      if (error.code !== "23505")
        throw new Error("No se pudo guardar el catálogo.");
    } else {
      const { data, error } = await getDB()
        .from("finance_dataset_cache")
        .update(record)
        .eq("store_id", storeId)
        .eq("section", section)
        .eq("refreshed_at", previous.refreshedAt)
        .select("store_id");
      if (error) throw new Error("No se pudo actualizar el catálogo.");
      if (data?.length) return;
    }
  }
  throw new Error("El catálogo cambió durante la actualización.");
}
