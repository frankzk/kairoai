// Identidad de la asesora en el navegador.
//
// Desde el 12/10/2026 cada persona entra con su usuario. Si es una ASESORA (su
// usuario esta vinculado a la planilla) y no supervisa, la asesora queda FIJA:
// getVendedoraId devuelve siempre la suya y no se puede cambiar. El servidor lo
// impone igual (lib/identidad.ts); esto es para que la pantalla lo muestre.
//
// Supervision (y el admin) siguen eligiendo con el selector de siempre, que se
// recuerda aca y avisa a quien escuche: el telefono web necesita saber en el
// acto que cambio la asesora para registrarse con SU extension.

import { asesoraFija, leerYo } from "./sesion-cliente";

export const VENDEDORA_KEY = "kairo:leads-vendedora";

/** La asesora fija de quien esta usando la app, o null si puede elegir. */
export function vendedoraBloqueada(): number | null {
  return asesoraFija(leerYo());
}
export const VENDEDORA_EVENT = "kairo:vendedora-change";

export function getVendedoraId(): number | null {
  if (typeof window === "undefined") return null;
  const fija = vendedoraBloqueada();
  if (fija) return fija;
  try {
    const raw = Number(window.localStorage.getItem(VENDEDORA_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Guarda la asesora activa y notifica a los componentes de la pestaña. */
export function setVendedoraId(id: number): void {
  if (typeof window === "undefined") return;
  // Una asesora fija no puede pasar a ser otra.
  if (vendedoraBloqueada()) return;
  try {
    window.localStorage.setItem(VENDEDORA_KEY, String(id));
  } catch {
    // Modo privado / storage bloqueado: la seleccion vive solo en memoria.
  }
  window.dispatchEvent(new CustomEvent<number>(VENDEDORA_EVENT, { detail: id }));
}

/**
 * Suscribe a los cambios de asesora: el evento propio cubre la misma pestaña
 * y `storage` cubre otra pestaña del mismo navegador.
 */
export function onVendedoraChange(callback: (id: number | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    callback(Number.isFinite(detail) && detail > 0 ? detail : null);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== VENDEDORA_KEY) return;
    callback(getVendedoraId());
  };
  window.addEventListener(VENDEDORA_EVENT, handleCustom);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(VENDEDORA_EVENT, handleCustom);
    window.removeEventListener("storage", handleStorage);
  };
}
