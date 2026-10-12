import {
  DEFAULT_FINANCE_STORE_CODE,
  FINANCE_STORES,
  getFinanceStore,
  normalizeFinanceStoreCode,
  type FinanceStoreCode,
  type FinanceStorePublic,
} from "./store-config";
import { tiendasPermitidas } from "./identidad";

export interface FinanceStoreConfig extends FinanceStorePublic {
  shopDomainEnv: string;
  accessTokenEnv: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  legacyShopDomainEnv?: string;
  legacyAccessTokenEnv?: string;
  legacyClientIdEnv?: string;
  legacyClientSecretEnv?: string;
}

const STORE_SECRET_ENV: Record<FinanceStoreCode, Omit<FinanceStoreConfig, keyof FinanceStorePublic>> = {
  "mireva-cr": {
    shopDomainEnv: "SHOPIFY_CR_SHOP_DOMAIN",
    accessTokenEnv: "SHOPIFY_CR_ACCESS_TOKEN",
    clientIdEnv: "SHOPIFY_CR_CLIENT_ID",
    clientSecretEnv: "SHOPIFY_CR_CLIENT_SECRET",
    legacyShopDomainEnv: "SHOPIFY_SHOP_DOMAIN",
    legacyAccessTokenEnv: "SHOPIFY_ACCESS_TOKEN",
    legacyClientIdEnv: "SHOPIFY_CLIENT_ID",
    legacyClientSecretEnv: "SHOPIFY_CLIENT_SECRET",
  },
  "mireva-hn": {
    shopDomainEnv: "SHOPIFY_HN_SHOP_DOMAIN",
    accessTokenEnv: "SHOPIFY_HN_ACCESS_TOKEN",
    clientIdEnv: "SHOPIFY_HN_CLIENT_ID",
    clientSecretEnv: "SHOPIFY_HN_CLIENT_SECRET",
  },
};

export function getStoreConfig(value?: string | null): FinanceStoreConfig {
  const store = getFinanceStore(value);
  return {
    ...store,
    ...STORE_SECRET_ENV[store.code],
  };
}

export function parseFinanceStoreCode(value: unknown): FinanceStoreCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return FINANCE_STORES.some((store) => store.code === normalized)
    ? (normalized as FinanceStoreCode)
    : null;
}

/**
 * true si quien llama puede trabajar esta tienda. Sin persona (crons, scripts)
 * no hay restriccion. Ver lib/identidad.ts.
 */
export function storeAllowed(code: string): boolean {
  const permitidas = tiendasPermitidas();
  return permitidas === null || permitidas.includes(code);
}

export function getRequiredStoreConfig(value: unknown): FinanceStoreConfig | null {
  const code = parseFinanceStoreCode(value);
  // Una tienda que no es suya se trata igual que una tienda que no existe: la
  // ruta responde "store requerido" y no toca datos. El middleware ya corta el
  // caso de ?store= en la URL con un 403 claro; esto cubre la tienda que viaja
  // en el cuerpo del pedido.
  return code && storeAllowed(code) ? getStoreConfig(code) : null;
}

export function getStoreId(value?: string | null): number {
  return getStoreConfig(value).id;
}

/** Tienda pedida, o la primera permitida si no vino ninguna o no es suya. */
function tiendaPorDefecto(value: string | null | undefined): FinanceStoreConfig {
  const code = parseFinanceStoreCode(value);
  if (code && storeAllowed(code)) return getStoreConfig(code);
  const permitidas = tiendasPermitidas();
  if (permitidas === null) return getStoreConfig(value);
  const primera = FINANCE_STORES.find((s) => permitidas.includes(s.code));
  // Sin ninguna tienda permitida no hay a que caer: se devuelve la pedida y el
  // middleware ya habra cortado cualquier ?store= ajeno.
  return getStoreConfig(primera?.code ?? value);
}

export function getStoreFromSearchParams(params: URLSearchParams): FinanceStoreConfig {
  return tiendaPorDefecto(params.get("store"));
}

export function getRequiredStoreFromSearchParams(params: URLSearchParams): FinanceStoreConfig | null {
  return getRequiredStoreConfig(params.get("store"));
}

export function getStoreFromBody(body: Record<string, unknown> | null | undefined): FinanceStoreConfig {
  return tiendaPorDefecto(typeof body?.store === "string" ? body.store : DEFAULT_FINANCE_STORE_CODE);
}

export function getRequiredStoreFromBody(body: unknown): FinanceStoreConfig | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return getRequiredStoreConfig((body as { store?: unknown }).store);
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

export function getShopifyOAuthCredentials(store: FinanceStoreConfig): {
  clientId: string;
  clientSecret: string;
  missing: string[];
} {
  const clientId =
    process.env[store.clientIdEnv] ||
    (store.legacyClientIdEnv ? process.env[store.legacyClientIdEnv] : "") ||
    "";
  const clientSecret =
    process.env[store.clientSecretEnv] ||
    (store.legacyClientSecretEnv ? process.env[store.legacyClientSecretEnv] : "") ||
    "";
  const missing: string[] = [];
  if (!clientId) missing.push(store.clientIdEnv);
  if (!clientSecret) missing.push(store.clientSecretEnv);
  return { clientId, clientSecret, missing };
}

export function getStoreCodeFromUnknown(value: unknown): FinanceStoreCode {
  return normalizeFinanceStoreCode(typeof value === "string" ? value : null);
}

export { FINANCE_STORES, DEFAULT_FINANCE_STORE_CODE, normalizeFinanceStoreCode };
