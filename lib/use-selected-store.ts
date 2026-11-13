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

/** Aviso dentro de la pestaña: el selector del menú cambió la tienda. */
export const EVENTO_TIENDA = "kairo:tienda";

/**
 * Cambia la tienda activa para TODA la app: la guarda y avisa a cada pantalla
 * montada (useSelectedStore escucha el aviso), así el selector único del menú
 * recarga la pantalla abierta sin refrescar la página.
 */
export function elegirTienda(next: FinanceStoreCode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Ignora errores de escritura (cuota / modo privado).
  }
  window.dispatchEvent(new CustomEvent<FinanceStoreCode>(EVENTO_TIENDA, { detail: next }));
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

    // El selector del menú (misma pestaña) y otras pestañas (storage).
    const onElegida = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (isValidStoreCode(next) && tiendasPermitidasCliente().some((s) => s.code === next)) setCode(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (isValidStoreCode(e.newValue) && tiendasPermitidasCliente().some((s) => s.code === e.newValue))
        setCode(e.newValue);
    };
    window.addEventListener(EVENTO_TIENDA, onElegida);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENTO_TIENDA, onElegida);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const select = useCallback((next: FinanceStoreCode) => {
    setCode(next);
    elegirTienda(next);
  }, []);

  return [code, select];
}
