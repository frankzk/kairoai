"use client";
// La tienda que muestra Marketing (la elegida en el selector del menú). Cada
// pedido a /api/marketing/* lleva `store=` de aquí: Costa Rica y Honduras
// nunca se mezclan. El tablero se vuelve a montar al cambiar de tienda
// (MarketingPage), así ningún dato de una queda a la vista de la otra.
import { createContext, useContext } from "react";
import type { FinanceStoreCode } from "@/lib/store-config";
import { DEFAULT_MARKETING_STORE } from "@/lib/marketing-stores";

const MarketingStoreContext = createContext<FinanceStoreCode>(
  DEFAULT_MARKETING_STORE,
);

export const MarketingStoreProvider = MarketingStoreContext.Provider;

/** Código de la tienda de Marketing (mireva-cr, mireva-hn). */
export const useMarketingStore = () => useContext(MarketingStoreContext);
