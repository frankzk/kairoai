import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_FINANCE_STORE_CODE,
  FINANCE_STORES,
  type FinanceStoreCode,
} from "@/lib/store-config";

const STORAGE_KEY = "kairo:selected-store";

function isValidStoreCode(value: string | null): value is FinanceStoreCode {
  return Boolean(value) && FINANCE_STORES.some((store) => store.code === value);
}

// Tienda activa compartida entre las vistas multitienda (Seguimiento/Pedidos,
// Novedades, ...). Se recuerda en localStorage para que la seleccion siga al
// usuario al cambiar de pantalla y entre recargas: si veo Honduras en Pedidos,
// veo Honduras en Novedades.
//
// SSR-safe: arranca en el default (igual en servidor y cliente, sin desajuste de
// hidratacion) y se sincroniza con lo guardado despues de montar.
export function useSelectedStore(): [FinanceStoreCode, (code: FinanceStoreCode) => void] {
  const [code, setCode] = useState<FinanceStoreCode>(DEFAULT_FINANCE_STORE_CODE);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isValidStoreCode(saved)) setCode(saved);
    } catch {
      // localStorage no disponible (modo privado): se mantiene el default.
    }
  }, []);

  const select = useCallback((next: FinanceStoreCode) => {
    setCode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignora errores de escritura (cuota / modo privado).
    }
  }, []);

  return [code, select];
}
