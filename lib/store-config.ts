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
  // Transportadora primaria / por defecto de la tienda.
  logisticsProvider: LogisticsProviderCode;
  // Transportadoras habilitadas para la tienda. Si se omite (caso actual), la
  // tienda es mono-transportadora y usa `logisticsProvider`. Declarar mas de una
  // activa la resolucion de transportadora por fila (ver lib/carriers.ts).
  carriers?: LogisticsProviderCode[];
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
  },
];

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

