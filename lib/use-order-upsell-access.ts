"use client";

import { useEffect, useState } from "react";
import { leerYo } from "./sesion-cliente";
import { canManageOrderUpsell } from "./order-upsell-access";

export function useOrderUpsellAccess(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const yo = leerYo();
    setAllowed(yo ? canManageOrderUpsell(yo.permisos) : true);
  }, []);
  return allowed;
}
