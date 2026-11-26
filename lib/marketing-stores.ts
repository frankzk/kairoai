// Tiendas que tienen Marketing y lo que cambia entre ellas (26/11/2026).
// Puro y usable en el navegador: sin env, sin base. La configuración de Meta
// de cada tienda (token, cuentas) vive en lib/marketing-meta-config.ts (solo
// servidor).
//
// Mireva Costa Rica y Mireva Honduras comparten la hora (UTC−6, sin horario de
// verano): el calendario de Marketing (lib/marketing-dates.ts) sirve para las
// dos. Lo que cambia es la moneda de la tienda, el prefijo telefónico y qué
// fuentes tiene conectadas (TikTok e inventario de ShipHero solo en Costa Rica).
import {
  DEFAULT_FINANCE_STORE_CODE,
  getFinanceStore,
  type FinanceStoreCode,
} from "./store-config";

export interface MarketingStoreInfo {
  code: FinanceStoreCode;
  id: number;
  label: string;
  /** "Costa Rica" / "Honduras". */
  country: string;
  /** Moneda de los precios y pedidos de la tienda (CRC, HNL). */
  currency: string;
  /** Zona horaria de la tienda (misma hora que la de Costa Rica). */
  timezone: string;
  /** Prefijo telefónico del país, para reconocer al mismo cliente. */
  phonePrefix: string;
  /** TikTok Ads tiene acceso (API o Make) en esta tienda. */
  tiktok: boolean;
  /** Inventario de ShipHero y archivo product_table en esta tienda. */
  shiphero: boolean;
}

const INFO: Record<FinanceStoreCode, Omit<MarketingStoreInfo, "code" | "id" | "label" | "currency" | "timezone">> = {
  "mireva-cr": { country: "Costa Rica", phonePrefix: "506", tiktok: true, shiphero: true },
  "mireva-hn": { country: "Honduras", phonePrefix: "504", tiktok: false, shiphero: false },
};

/** Tiendas con Marketing, en el orden del selector. */
export const MARKETING_STORE_CODES: readonly FinanceStoreCode[] = ["mireva-cr", "mireva-hn"];

export const DEFAULT_MARKETING_STORE: FinanceStoreCode = DEFAULT_FINANCE_STORE_CODE;

export function isMarketingStore(code: unknown): code is FinanceStoreCode {
  return typeof code === "string" && (MARKETING_STORE_CODES as readonly string[]).includes(code);
}

/** Datos de Marketing de una tienda; una desconocida es Costa Rica (como getFinanceStore). */
export function marketingStoreInfo(code?: string | null): MarketingStoreInfo {
  const store = getFinanceStore(isMarketingStore(code) ? code : DEFAULT_MARKETING_STORE);
  return {
    code: store.code,
    id: store.id,
    label: store.label,
    currency: store.currency,
    timezone: store.timezone,
    ...INFO[store.code],
  };
}

/** "Hora de Costa Rica" / "Hora de Honduras". */
export const marketingHourLabel = (code?: string | null) =>
  `Hora de ${marketingStoreInfo(code).country}`;

/**
 * Zonas horarias de una cuenta publicitaria cuyas horas y días coinciden con
 * los de los pedidos de la tienda: la de Costa Rica (el calendario de
 * Marketing) y la de la propia tienda. Para Costa Rica es solo
 * America/Costa_Rica, como siempre.
 */
export function marketingClockZones(code?: string | null): ReadonlySet<string> {
  return new Set(["America/Costa_Rica", marketingStoreInfo(code).timezone]);
}

/**
 * Time zones aligned with a Marketing summary's orders: its own `timezone`
 * plus, for a Marketing store, that store's clock (Honduras accounts in
 * America/Tegucigalpa). Costa Rica: only America/Costa_Rica, as always.
 */
export function summaryClockZones(summary: {
  store?: string | null;
  timezone: string;
}): ReadonlySet<string> {
  const zones = new Set([summary.timezone]);
  if (isMarketingStore(summary.store))
    marketingClockZones(summary.store).forEach((zone) => zones.add(zone));
  return zones;
}
