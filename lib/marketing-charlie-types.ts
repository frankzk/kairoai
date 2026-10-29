import type { MarketingSource } from "./marketing-source-types";
export interface CharlieDay {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  frequency: number | null;
  purchases: number;
  purchaseValue: number | null;
  interactions: number;
}
export interface CharlieAd {
  id: string;
  name: string;
  adsetId: string;
  campaignId: string;
  effectiveStatus: string;
  postId: string | null;
  creativeId: string | null;
  assets: {
    creatives: number | null;
    bodies: number | null;
    titles: number | null;
  } | null;
  daily: CharlieDay[];
}
export interface CharlieAdset {
  id: string;
  name: string;
  campaignId: string;
  dynamic: boolean;
  effectiveStatus: string;
}
export interface CharlieAccount {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  ads: CharlieAd[];
  adsets: CharlieAdset[];
  metadataMessage?: string;
}
export type CharlieReport = MarketingSource<{
  accounts: CharlieAccount[];
  from: string;
  to: string;
  trailFrom: string;
  trailTo: string;
}>;
export interface CharlieConfig {
  crc_per_usd: number | null;
  rate_date: string | null;
  hero_product_keys: string[];
}
export interface AdsetRole {
  account_id: string;
  adset_id: string;
  role: "control" | "testing" | "other";
  updated_at?: string;
}
export interface UsdRate {
  rate: number | null;
  date: string | null;
  source: "hacienda" | "manual" | "unavailable";
  checkedAt: string;
  message: string;
}
export interface CharlieSettings {
  config: CharlieConfig;
  roles: AdsetRole[];
  fx: UsdRate;
}
