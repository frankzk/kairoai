import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_FINANCE_STORE_CODE,
  FINANCE_STORES,
  type FinanceStoreCode,
  type FinanceStorePublic,
} from "@/lib/store-config";
import { leerYo } from "@/lib/sesion-cliente";

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
/**
 * Tiendas que la persona puede trabajar (todas si no hay sesion legible, p.ej.
 * en el servidor). El servidor lo impone igual; esto es para no ofrecerle una
 * tienda que le va a responder "no tienes acceso".
 */
export function tiendasPermitidasCliente(): FinanceStorePublic[] {
  const yo = leerYo();
  if (!yo) return FINANCE_STORES;
  const propias = FINANCE_STORES.filter((s) => yo.tiendas.includes(s.code));
  return propias.length ? propias : FINANCE_STORES;
}

/** Version hook (sin desajuste de hidratacion: arranca con todas). */
export function useTiendasPermitidas(): FinanceStorePublic[] {
  const [tiendas, setTiendas] = useState<FinanceStorePublic[]>(FINANCE_STORES);
  useEffect(() => setTiendas(tiendasPermitidasCliente()), []);
  return tiendas;
}

export function useSelectedStore(): [FinanceStoreCode, (code: FinanceStoreCode) => void] {
  const [code, setCode] = useState<FinanceStoreCode>(DEFAULT_FINANCE_STORE_CODE);

  useEffect(() => {
    const permitidas = tiendasPermitidasCliente().map((s) => s.code);
    let elegida: FinanceStoreCode | null = null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isValidStoreCode(saved) && permitidas.includes(saved)) elegida = saved;
    } catch {
      // localStorage no disponible (modo privado): se mantiene el default.
    }
    // Sin una guardada valida, la primera tienda de la persona (una asesora de
    // Honduras no arranca en Costa Rica).
    if (!elegida && !permitidas.includes(DEFAULT_FINANCE_STORE_CODE)) elegida = permitidas[0] ?? null;
    if (elegida) setCode(elegida);
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
