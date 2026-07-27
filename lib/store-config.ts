export type FinanceStoreCode = "mireva-cr" | "mireva-hn";
export type LogisticsProviderCode = "moovin" | "forza";

export interface FinanceStorePublic {
  id: number;
  code: FinanceStoreCode;
  label: string;
  shortLabel: string;
  countryCode: "CR" | "HN";
  currency: "CRC" | "HNL";
  locale: string;
  logisticsProvider: LogisticsProviderCode;
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

export function getStoreRegions(value?: string | null): StoreRegions {
  return getFinanceStore(value).countryCode === "HN" ? HN_REGIONS : CR_REGIONS;
}

/** Simbolo de moneda de la tienda (colon o lempira). */
export function getCurrencySymbol(value?: string | null): string {
  return getFinanceStore(value).currency === "HNL" ? "L" : "₡";
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

