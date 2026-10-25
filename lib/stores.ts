import {
  DEFAULT_FINANCE_STORE_CODE,
  FINANCE_STORES,
  getFinanceStore,
  normalizeFinanceStoreCode,
  type FinanceStoreCode,
  type FinanceStorePublic,
} from "./store-config";
import { tiendasPermitidas } from "./identidad";

/** Lo que hace falta para hablar con el Admin API de una tienda de Shopify. */
export interface TiendaShopify {
  id: number;
  code: string;
  label: string;
  shopDomainEnv: string;
  accessTokenEnv: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  legacyShopDomainEnv?: string;
  legacyAccessTokenEnv?: string;
  legacyClientIdEnv?: string;
  legacyClientSecretEnv?: string;
}

export interface FinanceStoreConfig extends FinanceStorePublic, TiendaShopify {
  code: FinanceStoreCode;
}

/**
 * Tiendas que Kairo SOLO respalda: las tres Kenku, que salen de Shopify el
 * 28/10/2026 igual que Mireva. No son tiendas de Kairo todavia (Kairo asume
 * Costa Rica u Honduras en moneda, hora y telefonos): no aparecen en Gestion,
 * Leads ni Novedades, ni en los permisos. Solo las recorre el respaldo
 * (lib/shopify-archivo.ts) y la autorizacion de la app (/api/shopify/auth).
 * Su fila en `stores` va con active = false (migracion 0052).
 */
export const TIENDAS_SOLO_RESPALDO: TiendaShopify[] = [
  { id: 3, code: "kenku-mx", label: "Kenku México", ...envShopify("KENKU_MX") },
  { id: 4, code: "kenku-ar", label: "Kenku Argentina", ...envShopify("KENKU_AR") },
  { id: 5, code: "kenku-it", label: "Kenku Italia", ...envShopify("KENKU_IT") },
];

function envShopify(prefijo: string): Pick<TiendaShopify, "shopDomainEnv" | "accessTokenEnv" | "clientIdEnv" | "clientSecretEnv"> {
  return {
    shopDomainEnv: `SHOPIFY_${prefijo}_SHOP_DOMAIN`,
    accessTokenEnv: `SHOPIFY_${prefijo}_ACCESS_TOKEN`,
    clientIdEnv: `SHOPIFY_${prefijo}_CLIENT_ID`,
    clientSecretEnv: `SHOPIFY_${prefijo}_CLIENT_SECRET`,
  };
}

/** Todas las tiendas de Shopify que se respaldan: las de Kairo y las de solo respaldo. */
export function tiendasARespaldar(): TiendaShopify[] {
  return [...FINANCE_STORES.map((store) => getStoreConfig(store.code)), ...TIENDAS_SOLO_RESPALDO];
}

/**
 * Tienda de Shopify por codigo, para la autorizacion de la app: las de Kairo
 * (con el control de tiendas permitidas de siempre) o una de solo respaldo.
 */
export function tiendaShopifyPorCodigo(value: unknown): TiendaShopify | null {
  const deKairo = getRequiredStoreConfig(value);
  if (deKairo) return deKairo;
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TIENDAS_SOLO_RESPALDO.find((store) => store.code === code) ?? null;
}

export function esSoloRespaldo(store: Pick<TiendaShopify, "code">): boolean {
  return TIENDAS_SOLO_RESPALDO.some((t) => t.code === store.code);
}

const STORE_SECRET_ENV: Record<FinanceStoreCode, Omit<TiendaShopify, "id" | "code" | "label">> = {
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

export function getShopifyCredentials(store: TiendaShopify): {
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

export function getShopifyOAuthCredentials(store: TiendaShopify): {
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
