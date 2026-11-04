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
  adsetName?: string;
  campaignName?: string;
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
  /** Native account currency, summed across the selected period including inactive ads. */
  periodSpend?: number;
  id: string;
  name: string;
  campaignId: string;
  dynamic: boolean;
  effectiveStatus: string;
}
export interface CharlieAccount {
  platform?: "meta" | "tiktok";
  id: string;
  name: string;
  currency: string;
  timezone: string;
  ads: CharlieAd[];
  adsets: CharlieAdset[];
  metadataMessage?: string;
  creativeScope?: "active";
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
/** Soles por dolar (TikTok Costa Rica cobra en PEN): venta SBS publicada por el BCRP. */
export interface PenRate {
  rate: number;
  date: string;
  source: "bcrp";
}
export interface UsdRate {
  rate: number | null;
  date: string | null;
  source: "hacienda" | "manual" | "unavailable";
  checkedAt: string;
  message: string;
  /** null si no se pudo verificar: los importes en PEN quedan sin convertir. */
  pen?: PenRate | null;
}
export interface CharlieSettings {
  config: CharlieConfig;
  roles: AdsetRole[];
  fx: UsdRate;
}
