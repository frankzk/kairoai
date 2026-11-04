import { getDB } from "./db";
import type { NativeProduct } from "./marketing-product-groups-server";
import type { CampaignProduct } from "./marketing-settings-types";
export async function readMarketingProductCatalog(
  storeId: number,
): Promise<NativeProduct[]> {
  const rows: NativeProduct[] = [];
  for (let start = 0; start < 20000; start += 1000) {
    const { data, error } = await getDB()
      .from("shopify_archivo")
      .select("shopify_id,title:payload->>title,variants:payload->variants")
      .eq("store_id", storeId)
      .eq("recurso", "product")
      .order("shopify_id")
      .range(start, start + 999);
    if (error || !data) throw new Error("Catalog unavailable");
    rows.push(...(data as unknown as NativeProduct[]));
    if (data.length < 1000) return rows;
  }
  throw new Error("Catalog pagination limit");
}
export async function readMarketingVariantMappings(
  storeId: number,
): Promise<CampaignProduct[]> {
  const rows: CampaignProduct[] = [];
  for (let start = 0; start < 10000; start += 1000) {
    const { data, error } = await getDB()
      .from("marketing_campaign_products")
      .select(
        "platform,account_id,campaign_id,product_key,product_name,sku,family_key,variant_scope,variant_keys,campaign_alias",
      )
      .eq("store_id", storeId)
      .order("platform")
      .order("account_id")
      .order("campaign_id")
      .range(start, start + 999);
    if (error || !data) throw new Error("Variant mappings unavailable");
    rows.push(...(data as unknown as CampaignProduct[]));
    if (data.length < 1000) return rows;
  }
  throw new Error("Mappings pagination limit");
}
