export type FinanceStoreCode = "mireva-cr" | "mireva-hn";

export interface FinanceStorePublic {
  id: number;
  code: FinanceStoreCode;
  label: string;
  shortLabel: string;
  countryCode: "CR" | "HN";
  currency: "CRC" | "HNL";
  locale: string;
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
  },
  {
    id: 2,
    code: "mireva-hn",
    label: "Mireva Honduras",
    shortLabel: "Honduras",
    countryCode: "HN",
    currency: "HNL",
    locale: "es-HN",
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

