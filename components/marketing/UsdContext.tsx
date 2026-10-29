"use client";
import { createContext, useCallback, useContext } from "react";
import type { ReactNode } from "react";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import { asUsd } from "@/lib/marketing-usd-rate";
import { money } from "./format";
const Fx = createContext<UsdRate | null>(null);
export function UsdProvider({
  fx,
  children,
}: {
  fx: UsdRate | null;
  children: ReactNode;
}) {
  return <Fx.Provider value={fx}>{children}</Fx.Provider>;
}
export function useUsdMoney() {
  const fx = useContext(Fx);
  return useCallback(
    (value: number | null | undefined, currency: string | null = "USD") =>
      value == null
        ? "Sin datos"
        : currency !== "USD" && asUsd(value, currency, fx) == null
          ? "Conversión pendiente"
          : money(asUsd(value, currency, fx), "USD"),
    [fx],
  );
}
