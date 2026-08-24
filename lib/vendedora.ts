// Identidad de la asesora en el navegador.
//
// Kairo todavia entra con una sola contraseña de admin (no hay Supabase Auth),
// asi que "quien soy" se resuelve con el selector de asesora que ya usan el
// composer, la barra de gestion y el panel de crear pedido. La clave vivia
// duplicada en cada uno; aqui queda en un solo lugar y, sobre todo, avisa a
// quien escuche: el telefono web necesita saber en el acto que cambio la
// asesora para registrarse con SU extension de la centralita.

export const VENDEDORA_KEY = "kairo:leads-vendedora";
export const VENDEDORA_EVENT = "kairo:vendedora-change";

export function getVendedoraId(): number | null {
  if (typeof window === "undefined") return null;
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
