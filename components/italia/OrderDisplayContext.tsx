"use client";

import { createContext, useContext } from "react";
import { kenkuManagementStore } from "@/lib/kenku-management";

export const OrderDisplayContext = createContext(kenkuManagementStore("kenku-it"));
export function useOrderDisplay() {
  const config = useContext(OrderDisplayContext);
  return {
    ...config,
    date: (value: string) => new Date(value).toLocaleString(config.locale, {timeZone: config.timeZone}),
    shortDate: (value: string) => new Date(value).toLocaleDateString(config.locale, {timeZone: config.timeZone}),
    money: (value: number | null, currency: string) => {
      if (value === null) return "Sin importe";
      try { return new Intl.NumberFormat(config.locale, {style: "currency", currency, currencyDisplay: "code"}).format(value); }
      catch { return `${value.toLocaleString(config.locale)} ${currency}`; }
    },
  };
}
