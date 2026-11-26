// Configuración de Meta Ads de cada tienda de Marketing (26/11/2026).
// Solo servidor: el token se lee aquí y nunca sale (ni al navegador, ni a un
// log, ni a una URL: Kairo lo manda en `Authorization: Bearer`).
//
// Cada tienda tiene sus variables con el código del país:
//   META_CR_ACCESS_TOKEN, META_CR_AD_ACCOUNT_IDS (o META_CR_AD_ACCOUNT_ID),
//   META_CR_GRAPH_VERSION, META_CR_APP_ID          → Mireva Costa Rica
//   META_HN_ACCESS_TOKEN, META_HN_AD_ACCOUNT_IDS (o META_HN_AD_ACCOUNT_ID),
//   META_HN_GRAPH_VERSION, META_HN_APP_ID          → Mireva Honduras
// Una tienda nunca lee las variables de otra: sin las suyas queda "pendiente
// de configurar".
//
// Pruebas: tests/marketing-meta-config.test.ts.
import { getFinanceStore, type FinanceStoreCode } from "./store-config";
import { isMarketingStore } from "./marketing-stores";

type Env = Record<string, string | undefined>;

export interface MetaStoreConfig {
  store: FinanceStoreCode;
  /** Prefijo de sus variables: "META_CR", "META_HN". */
  prefix: string;
  /** Versión, token y lista de cuentas presentes (no dice si son válidos). */
  configured: boolean;
  /** Nombres (nunca valores) de las variables que faltan. */
  missing: string[];
  version: string;
  /** Solo servidor. Nunca se devuelve ni se registra. */
  token: string;
  /** Lista tal como viene de la variable; se valida con metaConfigAccountIds. */
  accountList: string;
  appId: string;
}

const read = (env: Env, key: string) => env[key]?.trim() ?? "";

/** La configuración de Meta de la tienda (por defecto Costa Rica, como antes). */
export function metaConfigFor(
  store: string | null | undefined = "mireva-cr",
  env: Env = process.env,
): MetaStoreConfig {
  const code: FinanceStoreCode = isMarketingStore(store) ? store : "mireva-cr";
  const prefix = `META_${getFinanceStore(code).countryCode}`;
  const version = read(env, `${prefix}_GRAPH_VERSION`);
  const token = read(env, `${prefix}_ACCESS_TOKEN`);
  // Igual que siempre: la lista (IDS) gana sobre la cuenta suelta (ID).
  const accountList = env[`${prefix}_AD_ACCOUNT_IDS`] || env[`${prefix}_AD_ACCOUNT_ID`] || "";
  const missing = [
    !version && `${prefix}_GRAPH_VERSION`,
    !token && `${prefix}_ACCESS_TOKEN`,
    !accountList.trim() && `${prefix}_AD_ACCOUNT_IDS`,
  ].filter((key): key is string => Boolean(key));
  return {
    store: code,
    prefix,
    configured: missing.length === 0,
    missing,
    version,
    token,
    accountList,
    appId: read(env, `${prefix}_APP_ID`),
  };
}

/** Versión del Graph con formato válido ("v21.0"). */
export const metaVersionValid = (config: Pick<MetaStoreConfig, "version">) =>
  /^v\d+\.\d+$/.test(config.version);

/**
 * Cuentas configuradas, sin `act_` y sin repetir. Lanza si la lista no es
 * válida (vacía, más de 10, o un id que no es numérico).
 */
export function metaConfigAccountIds(config: Pick<MetaStoreConfig, "accountList">): string[] {
  const ids = Array.from(
    new Set(config.accountList.split(",").map((id) => id.trim().replace(/^act_/, ""))),
  );
  if (!ids.length || ids.length > 10 || ids.some((id) => !/^\d+$/.test(id)))
    throw new Error("Invalid Meta account list");
  return ids;
}

/** Cabecera de Meta de la tienda. El token va aquí, nunca en la URL. */
export const metaAuthHeaders = (config: Pick<MetaStoreConfig, "token">) => ({
  Authorization: `Bearer ${config.token}`,
});

/** Texto para el usuario cuando falta la configuración (solo nombres de variables). */
export function metaPendingMessage(config: MetaStoreConfig): string {
  const country = getFinanceStore(config.store).shortLabel;
  return config.missing.length
    ? `Meta Ads de ${country}: pendiente de configurar (faltan ${config.missing.join(", ")}).`
    : `Meta Ads de ${country}: pendiente de configurar acceso de lectura.`;
}
