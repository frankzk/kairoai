import {
  DEFAULT_FINANCE_STORE_CODE,
  FINANCE_STORES,
  getFinanceStore,
  normalizeFinanceStoreCode,
  type FinanceStoreCode,
  type FinanceStorePublic,
} from "./store-config";

export interface FinanceStoreConfig extends FinanceStorePublic {
  shopDomainEnv: string;
  accessTokenEnv: string;
  legacyShopDomainEnv?: string;
  legacyAccessTokenEnv?: string;
}

const STORE_SECRET_ENV: Record<FinanceStoreCode, Omit<FinanceStoreConfig, keyof FinanceStorePublic>> = {
  "mireva-cr": {
    shopDomainEnv: "SHOPIFY_CR_SHOP_DOMAIN",
    accessTokenEnv: "SHOPIFY_CR_ACCESS_TOKEN",
    legacyShopDomainEnv: "SHOPIFY_SHOP_DOMAIN",
    legacyAccessTokenEnv: "SHOPIFY_ACCESS_TOKEN",
  },
  "mireva-hn": {
    shopDomainEnv: "SHOPIFY_HN_SHOP_DOMAIN",
    accessTokenEnv: "SHOPIFY_HN_ACCESS_TOKEN",
  },
};

export function getStoreConfig(value?: string | null): FinanceStoreConfig {
  const store = getFinanceStore(value);
  return {
    ...store,
    ...STORE_SECRET_ENV[store.code],
  };
}

export function getStoreId(value?: string | null): number {
  return getStoreConfig(value).id;
}

export function getStoreFromSearchParams(params: URLSearchParams): FinanceStoreConfig {
  return getStoreConfig(params.get("store"));
}

export function getStoreFromBody(body: Record<string, unknown> | null | undefined): FinanceStoreConfig {
  return getStoreConfig(typeof body?.store === "string" ? body.store : DEFAULT_FINANCE_STORE_CODE);
}

export function getShopifyCredentials(store: FinanceStoreConfig): {
  shop: string;
  token: string;
  missing: string[];
} {
  const shop =
    process.env[store.shopDomainEnv] ||
    (store.legacyShopDomainEnv ? process.env[store.legacyShopDomainEnv] : "") ||
    "";
  const token =
    process.env[store.accessTokenEnv] ||
    (store.legacyAccessTokenEnv ? process.env[store.legacyAccessTokenEnv] : "") ||
    "";
  const missing: string[] = [];
  if (!shop) missing.push(store.shopDomainEnv);
  if (!token) missing.push(store.accessTokenEnv);
  return { shop, token, missing };
}

export function getStoreCodeFromUnknown(value: unknown): FinanceStoreCode {
  return normalizeFinanceStoreCode(typeof value === "string" ? value : null);
}

export { FINANCE_STORES, DEFAULT_FINANCE_STORE_CODE, normalizeFinanceStoreCode };

