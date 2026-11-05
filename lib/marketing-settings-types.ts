export type MarketingPlatform = "meta" | "tiktok";
export interface CampaignProduct {
  platform: MarketingPlatform;
  account_id: string;
  campaign_id: string;
  product_key: string;
  product_name: string;
  sku: string;
  family_key?: string | null;
  variant_scope?: "legacy" | "all" | "selected" | "none";
  variant_keys?: string[];
  campaign_alias?: string | null;
  automatic?: boolean;
  match_reason?: string;
  updated_at?: string;
}
export interface ProductPlan {
  product_key: string;
  product_name: string;
  sku: string;
  priority: boolean;
  supplier: string;
  lead_days: number | null;
  cover_days: number | null;
  incoming_units: number;
  updated_at?: string;
}
/** Team rule: a campaign whose name contains `keyword` gets this product family. */
export interface CampaignKeywordRule {
  keyword: string;
  family_key: string;
  product_name: string;
  updated_at?: string;
}
/** Short name of an ad account (Madre, CR2…CR5). */
export interface AccountLabel {
  platform: MarketingPlatform;
  account_id: string;
  label: string;
}
export interface MarketingSettings {
  mappings: CampaignProduct[];
  plans: ProductPlan[];
  keywords?: CampaignKeywordRule[];
  accountLabels?: AccountLabel[];
  /** Set when the keyword/label tables are not available yet (pending migration). */
  keywordsError?: string;
}
/**
 * Stored keyword form: lowercase ASCII words separated by one space
 * (same normalization as product names).
 */
export const normalKeyword = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
export const campaignKey = (
  platform: string,
  account: string,
  campaign: string,
) => `${platform}:${account}:${campaign}`;
