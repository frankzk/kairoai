"use client";
// Marketing de la tienda elegida en el menú (Mireva Costa Rica o Mireva
// Honduras). Al cambiar de tienda el tablero se vuelve a montar desde cero:
// ningún dato, caché del navegador ni selección de una tienda queda en la otra.
import { useEffect, useState } from "react";
import { useSelectedStore } from "@/lib/use-selected-store";
import {
  DEFAULT_MARKETING_STORE,
  isMarketingStore,
} from "@/lib/marketing-stores";
import MarketingDashboard from "./MarketingDashboard";

export default function MarketingPage() {
  const [selected] = useSelectedStore();
  // useSelectedStore reads the saved store after mounting: wait for it, so a
  // person of Honduras never asks Costa Rica first.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  const store = isMarketingStore(selected) ? selected : DEFAULT_MARKETING_STORE;
  return <MarketingDashboard key={store} store={store} />;
}
