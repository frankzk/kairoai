export type MarketingPlatform = "meta" | "tiktok";
export interface CampaignProduct {
  platform: MarketingPlatform;
  account_id: string;
  campaign_id: string;
  product_key: string;
  product_name: string;
  sku: string;
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
export interface MarketingSettings {
  mappings: CampaignProduct[];
  plans: ProductPlan[];
}
export const campaignKey = (
  platform: string,
  account: string,
  campaign: string,
) => `${platform}:${account}:${campaign}`;
