export type FinanceStoreCode = "mireva-cr" | "mireva-hn";
export type LogisticsProviderCode = "moovin" | "forza";
/**
 * Paises y monedas que Kairo sabe atender (regiones, telefonos, simbolo). Una
 * tienda nueva de uno de estos paises entra con solo su fila en FINANCE_STORES.
 * Mexico esta listo para Kenku Mexico (que hoy es solo respaldo, lib/stores.ts).
 */
export type CountryCode = "CR" | "HN" | "MX";
export type CurrencyCode = "CRC" | "HNL" | "MXN";

export interface FinanceStorePublic {
  id: number;
  code: FinanceStoreCode;
  label: string;
  shortLabel: string;
  countryCode: CountryCode;
  currency: CurrencyCode;
  locale: string;
  /** Zona horaria IANA de la tienda: el dia y la hora de sus pedidos y su cola. */
  timezone: string;
  logisticsProvider: LogisticsProviderCode;
  /**
   * Desde que dia (YYYY-MM-DD) se toman los pedidos que estan SOLO en iComfly.
   * Sin valor, CORTE_PEDIDOS_ICOMFLY (lib/icomfly-pedidos.ts): Mireva los tiene
   * en Shopify hasta el 05/10/2026. Una tienda sin historia en Shopify (Kenku
   * Mexico) los toma desde el principio.
   */
  pedidosIcomflyDesde?: string;
  // Link del catalogo que las asesoras comparten por WhatsApp. Viene de
  // NEXT_PUBLIC_CATALOG_URL_{CR|HN} (build-time); sin env el boton se oculta.
  catalogUrl?: string;
}

export const DEFAULT_FINANCE_STORE_CODE: FinanceStoreCode = "mireva-cr";
export const DEFAULT_FINANCE_STORE_ID = 1;

export const FINANCE_STORES: FinanceStorePublic[] = [
  {
    id: 1,
    code: "mireva-cr",
    label: "Mireva Costa Rica",
    shortLabel: "Costa Rica",
    countryCode: "CR",
    currency: "CRC",
    locale: "es-CR",
    timezone: "America/Costa_Rica",
    logisticsProvider: "moovin",
    catalogUrl: process.env.NEXT_PUBLIC_CATALOG_URL_CR || undefined,
  },
  {
    id: 2,
    code: "mireva-hn",
    label: "Mireva Honduras",
    shortLabel: "Honduras",
    countryCode: "HN",
    currency: "HNL",
    locale: "es-HN",
    timezone: "America/Tegucigalpa",
    logisticsProvider: "forza",
    catalogUrl: process.env.NEXT_PUBLIC_CATALOG_URL_HN || undefined,
  },
];

// Division administrativa de cada pais para la direccion de entrega. CR usa
// provincia/canton; HN usa departamento/municipio. Sin esto el formulario de
// pedido ofrecia provincias de Costa Rica al vender en Honduras.
export interface StoreRegions {
  /** Etiqueta del primer nivel ("Provincia" / "Departamento"). */
  label: string;
  /** Etiqueta del segundo nivel ("Canton" / "Municipio"). */
  subLabel: string;
  options: string[];
}

const CR_REGIONS: StoreRegions = {
  label: "Provincia",
  subLabel: "Cantón",
  options: ["San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas", "Limón"],
};

const HN_REGIONS: StoreRegions = {
  label: "Departamento",
  subLabel: "Municipio",
  options: [
    "Atlántida",
    "Choluteca",
    "Colón",
    "Comayagua",
    "Copán",
    "Cortés",
    "El Paraíso",
    "Francisco Morazán",
    "Gracias a Dios",
    "Intibucá",
    "Islas de la Bahía",
    "La Paz",
    "Lempira",
    "Ocotepeque",
    "Olancho",
    "Santa Bárbara",
    "Valle",
    "Yoro",
  ],
};

// Mexico: estados y municipio (Kenku Mexico).
const MX_REGIONS: StoreRegions = {
  label: "Estado",
  subLabel: "Municipio",
  options: [
    "Aguascalientes",
    "Baja California",
    "Baja California Sur",
    "Campeche",
    "Chiapas",
    "Chihuahua",
    "Ciudad de México",
    "Coahuila",
    "Colima",
    "Durango",
    "Estado de México",
    "Guanajuato",
    "Guerrero",
    "Hidalgo",
    "Jalisco",
    "Michoacán",
    "Morelos",
    "Nayarit",
    "Nuevo León",
    "Oaxaca",
    "Puebla",
    "Querétaro",
    "Quintana Roo",
    "San Luis Potosí",
    "Sinaloa",
    "Sonora",
    "Tabasco",
    "Tamaulipas",
    "Tlaxcala",
    "Veracruz",
    "Yucatán",
    "Zacatecas",
  ],
};

// Por pais, no "Honduras o si no Costa Rica": una tienda de otro pais caia en
// las provincias de Costa Rica y "Crear en iComfly" mandaba departamento
// "San José".
const REGIONES_POR_PAIS: Record<CountryCode, StoreRegions> = { CR: CR_REGIONS, HN: HN_REGIONS, MX: MX_REGIONS };

export function regionesDePais(pais: CountryCode): StoreRegions {
  return REGIONES_POR_PAIS[pais];
}

export function getStoreRegions(value?: string | null): StoreRegions {
  return regionesDePais(getFinanceStore(value).countryCode);
}

const SIMBOLO_MONEDA: Record<string, string> = { CRC: "₡", HNL: "L", MXN: "$", USD: "$", EUR: "€", ARS: "$", PEN: "S/" };

/** Simbolo de una moneda (codigo ISO). Uno desconocido se muestra con su codigo. */
export function simboloDeMoneda(currency?: string | null): string {
  const codigo = String(currency ?? "").trim().toUpperCase();
  return SIMBOLO_MONEDA[codigo] ?? (codigo ? `${codigo} ` : "");
}

/** Simbolo de moneda de la tienda (colon, lempira, peso). */
export function getCurrencySymbol(value?: string | null): string {
  return simboloDeMoneda(getFinanceStore(value).currency);
}

export function normalizeFinanceStoreCode(value?: string | null): FinanceStoreCode {
  const normalized = String(value || "").trim().toLowerCase();
  return FINANCE_STORES.some((store) => store.code === normalized)
    ? (normalized as FinanceStoreCode)
    : DEFAULT_FINANCE_STORE_CODE;
}

export function getFinanceStore(value?: string | null): FinanceStorePublic {
  const code = normalizeFinanceStoreCode(value);
  return FINANCE_STORES.find((store) => store.code === code) ?? FINANCE_STORES[0];
}

export function getFinanceStoreById(id: number): FinanceStorePublic | null {
  return FINANCE_STORES.find((store) => store.id === id) ?? null;
}

