export interface MarketingCampaign {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases?: number | null;
  daily?: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number | null;
  }>;
  dailyBudget?: number | null;
  budgetKind?: "campaign" | "adsets" | "lifetime" | "mixed" | "unavailable";
  effectiveStatus?: string;
}

export interface MarketingStock {
  sku: string;
  warehouseId: string;
  onHand: number;
  available: number;
  allocated: number;
}

export interface MarketingSource<T> {
  status: "pending" | "ready" | "error";
  checkedAt: string;
  message: string;
  data: T | null;
}

export interface MarketingAdsData {
  accountId: string;
  accountName?: string;
  currency: string;
  timezone: string;
  campaigns: MarketingCampaign[];
  budgetMessage?: string;
}

export interface MarketingAdsAccounts {
  accounts: MarketingAdsData[];
}

export interface MarketingSources {
  meta: MarketingSource<MarketingAdsAccounts>;
  tiktok: MarketingSource<MarketingAdsAccounts>;
  shiphero: MarketingSource<{ stock: MarketingStock[] }>;
}
