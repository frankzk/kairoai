import { getDB } from "@/lib/db";
import {
  FINANCE_STORES,
  type FinanceStorePublic,
  type LogisticsProviderCode,
} from "@/lib/store-config";
import { getStoreConfig, type FinanceStoreConfig } from "@/lib/stores";

export type IntegrationProvider =
  | "shopify"
  | "retell"
  | "elevenlabs"
  | "gemini"
  | "icomfly"
  | "courier";

export type CourierMode = "api" | "file" | "both";

export interface PlatformStore {
  id: number;
  code: string;
  name: string;
  short_name: string;
  country_code: string;
  currency: string;
  timezone: string;
  locale: string;
  shopify_created_at_min: string | null;
  default_courier_code: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

export interface StoreIntegration {
  id: number;
  store_id: number;
  provider: IntegrationProvider | string;
  enabled: boolean;
  secret_env_refs: Record<string, string>;
  public_config: Record<string, unknown>;
}

export interface CourierAccount {
  id: number;
  store_id: number;
  courier_code: string;
  display_name: string;
  country_code: string;
  mode: CourierMode;
  enabled: boolean;
  secret_env_refs: Record<string, string>;
  public_config: Record<string, unknown>;
}

export interface CourierFileProfile {
  id: number;
  store_id: number | null;
  courier_code: string;
  profile_code: string;
  file_type: "logistica" | "liquidacion";
  version: number;
  active: boolean;
  column_map: Record<string, string | string[]>;
  status_map: Record<string, string>;
  required_columns: string[];
}

export interface UserStoreRole {
  user_id: string;
  store_id: number;
  role: "owner" | "admin" | "finance" | "ops" | "viewer";
}

export function fallbackPlatformStores(): PlatformStore[] {
  return FINANCE_STORES.map((store) => ({
    id: store.id,
    code: store.code,
    name: store.label,
    short_name: store.shortLabel,
    country_code: store.countryCode,
    currency: store.currency,
    timezone: store.countryCode === "HN" ? "America/Tegucigalpa" : "America/Costa_Rica",
    locale: store.locale,
    shopify_created_at_min:
      store.code === "mireva-hn"
        ? "2025-12-09T00:00:00-06:00"
        : "2026-01-01T00:00:00-06:00",
    default_courier_code: store.logisticsProvider,
    active: true,
    metadata: { fallback: true },
  }));
}

export function fallbackCourierAccounts(): CourierAccount[] {
  return FINANCE_STORES.map((store, index) => ({
    id: index + 1,
    store_id: store.id,
    courier_code: store.logisticsProvider,
    display_name: providerLabel(store.logisticsProvider),
    country_code: store.countryCode,
    mode: "both",
    enabled: true,
    secret_env_refs: {},
    public_config: { fallback: true },
  }));
}

export async function listPlatformStores(): Promise<PlatformStore[]> {
  const { data, error } = await getDB()
    .from("stores")
    .select(
      "id, code, name, short_name, country_code, currency, timezone, locale, shopify_created_at_min, default_courier_code, active, metadata"
    )
    .eq("active", true)
    .order("id");

  if (error) throw new Error(`listPlatformStores: ${error.message}`);
  return (data ?? []).map(normalizeStoreRow);
}

export async function listPlatformStoresWithFallback(): Promise<PlatformStore[]> {
  try {
    const stores = await listPlatformStores();
    return stores.length ? stores : fallbackPlatformStores();
  } catch {
    return fallbackPlatformStores();
  }
}

export async function listStoreIntegrations(storeId?: number): Promise<StoreIntegration[]> {
  let query = getDB()
    .from("store_integrations")
    .select("id, store_id, provider, enabled, secret_env_refs, public_config")
    .order("provider");
  if (storeId) query = query.eq("store_id", storeId);

  const { data, error } = await query;
  if (error) throw new Error(`listStoreIntegrations: ${error.message}`);
  return (data ?? []) as StoreIntegration[];
}

export async function listCourierAccounts(storeId?: number): Promise<CourierAccount[]> {
  let query = getDB()
    .from("courier_accounts")
    .select("id, store_id, courier_code, display_name, country_code, mode, enabled, secret_env_refs, public_config")
    .eq("enabled", true)
    .order("store_id")
    .order("courier_code");
  if (storeId) query = query.eq("store_id", storeId);

  const { data, error } = await query;
  if (error) throw new Error(`listCourierAccounts: ${error.message}`);
  return (data ?? []) as CourierAccount[];
}

export async function listCourierAccountsWithFallback(storeId?: number): Promise<CourierAccount[]> {
  try {
    const accounts = await listCourierAccounts(storeId);
    return accounts.length
      ? accounts
      : fallbackCourierAccounts().filter((account) => !storeId || account.store_id === storeId);
  } catch {
    return fallbackCourierAccounts().filter((account) => !storeId || account.store_id === storeId);
  }
}

export async function listCourierFileProfiles(
  opts: { storeId?: number; courierCode?: string; fileType?: "logistica" | "liquidacion" } = {}
): Promise<CourierFileProfile[]> {
  let query = getDB()
    .from("courier_file_profiles")
    .select("id, store_id, courier_code, profile_code, file_type, version, active, column_map, status_map, required_columns")
    .eq("active", true)
    .order("courier_code")
    .order("profile_code")
    .order("version", { ascending: false });
  if (opts.storeId) query = query.or(`store_id.eq.${opts.storeId},store_id.is.null`);
  if (opts.courierCode) query = query.eq("courier_code", opts.courierCode);
  if (opts.fileType) query = query.eq("file_type", opts.fileType);

  const { data, error } = await query;
  if (error) throw new Error(`listCourierFileProfiles: ${error.message}`);
  return (data ?? []) as CourierFileProfile[];
}

export function getConfiguredEnv(refs: Record<string, string>, key: string): string {
  const envName = refs[key];
  return envName ? process.env[envName] ?? "" : "";
}

export function storeConfigToIntegration(store: FinanceStoreConfig): StoreIntegration {
  return {
    id: 0,
    store_id: store.id,
    provider: "shopify",
    enabled: true,
    secret_env_refs: {
      shopDomain: store.shopDomainEnv,
      accessToken: store.accessTokenEnv,
      clientId: store.clientIdEnv,
      clientSecret: store.clientSecretEnv,
    },
    public_config: {
      legacyShopDomainEnv: store.legacyShopDomainEnv,
      legacyAccessTokenEnv: store.legacyAccessTokenEnv,
    },
  };
}

export function getFallbackStoreIntegration(code: string): StoreIntegration {
  return storeConfigToIntegration(getStoreConfig(code));
}

function normalizeStoreRow(row: Record<string, unknown>): PlatformStore {
  const fallback = FINANCE_STORES.find((store) => store.id === Number(row.id));
  return {
    id: Number(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? fallback?.label ?? ""),
    short_name: String(row.short_name ?? fallback?.shortLabel ?? row.name ?? ""),
    country_code: String(row.country_code ?? fallback?.countryCode ?? ""),
    currency: String(row.currency ?? fallback?.currency ?? ""),
    timezone: String(row.timezone ?? "America/Costa_Rica"),
    locale: String(row.locale ?? fallback?.locale ?? "es-CR"),
    shopify_created_at_min: (row.shopify_created_at_min as string | null) ?? null,
    default_courier_code: String(row.default_courier_code ?? fallback?.logisticsProvider ?? ""),
    active: row.active !== false,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
  };
}

function providerLabel(provider: LogisticsProviderCode): string {
  if (provider === "forza") return "Forza";
  if (provider === "moovin") return "Moovin";
  return provider;
}
