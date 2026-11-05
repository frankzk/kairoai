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
  /** Meta: campaign bid strategy, else the single strategy of its active ad sets. */
  bidStrategy?: string | null;
  /** Meta: the single `bid_amount` of the active ad sets (account currency units), e.g. the COST CAP. */
  bidAmount?: number | null;
  /** True when active ad sets carry different bid amounts (`bidAmount` is then null). */
  bidAmountMixed?: boolean;
  createdTime?: string | null;
  startTime?: string | null;
  /** Latest edit of the campaign or its active ad sets (Meta `updated_time`). */
  updatedTime?: string | null;
  /** Since launch: account-currency spend, pixel purchases and first CR date. */
  lifetime?: CampaignLifetime | null;
}

export interface CampaignLifetime {
  spend: number;
  purchases: number | null;
  /** YYYY-MM-DD in Costa Rica; null when unknown. */
  firstDate: string | null;
}

/** One change on a campaign: Meta activity log, Meta last-edit fallback or a manual entry. */
export interface CampaignChange {
  platform: "meta" | "tiktok";
  accountId: string;
  campaignId: string;
  /** ISO timestamp. */
  at: string;
  kind: "presupuesto" | "puja" | "creativo" | "estado" | "lanzamiento" | "otro";
  detail: string;
  source: "meta" | "meta_edicion" | "manual";
  id?: string;
  by?: string;
}

/** Manual entry of the change log (`/api/marketing/changes`). */
export interface ManualCampaignChange extends CampaignChange {
  source: "manual";
  id: string;
  by: string;
  campaignName: string;
  productKey: string | null;
}

export interface MarketingStock {
  sku: string;
  warehouseId: string;
  onHand: number;
  available: number;
  allocated: number;
}

export interface MarketingInventory {
  stock: MarketingStock[];
  origin?: "shiphero" | "csv";
  /** CR date of the uploaded snapshot (CSV only). */
  snapshotDate?: string;
  uploadedAt?: string;
  uploadedBy?: string;
  /** The snapshot of the previous day with data, for "entró reposición". */
  previous?: { snapshotDate: string; stock: MarketingStock[] } | null;
}

export interface MarketingSource<T> {
  status: "pending" | "ready" | "error";
  checkedAt: string;
  message: string;
  data: T | null;
}

/** Account-level spend per hour of the account day (account currency). */
export interface MarketingHourlySpend {
  from: string;
  to: string;
  /** `hours` has 24 entries, index = hour of the day in the account time zone. */
  days: Array<{ date: string; hours: number[] }>;
}

export interface MarketingAdsData {
  accountId: string;
  accountName?: string;
  currency: string;
  timezone: string;
  campaigns: MarketingCampaign[];
  budgetMessage?: string;
  /** Account-currency daily totals for the executive graph; independent of the selected-period campaign totals. */
  dailySpend?: {
    from: string;
    to: string;
    days: Array<{ date: string; spend: number }>;
  };
  /** Only for accounts in America/Costa_Rica (the hours must match the orders' hours). */
  hourly?: MarketingHourlySpend;
  hourlyMessage?: string;
  lifetimeMessage?: string;
  changes?: CampaignChange[];
  /** activity = Meta activity log; updated_time = last edit only; unavailable = neither. */
  changesStatus?: "activity" | "updated_time" | "unavailable";
}

export interface MarketingAdsAccounts {
  accounts: MarketingAdsData[];
}

export interface MarketingSources {
  meta: MarketingSource<MarketingAdsAccounts>;
  tiktok: MarketingSource<MarketingAdsAccounts>;
  shiphero: MarketingSource<MarketingInventory>;
}
