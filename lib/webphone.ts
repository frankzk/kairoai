// Visibilidad del telefono web dentro de la pestaña.
//
// El widget de Zadarma tiene que estar MONTADO siempre: es lo que registra la
// extension en la centralita, y sin registro no hay donde timbrar. Pero no
// tiene que estar VISIBLE siempre: flotando sobre el tablero todo el dia solo
// estorba. Se monta oculto y se muestra cuando hace falta.
//
// El evento existe para que el boton "Llamar" —que vive en otro arbol de
// componentes— pueda pedir que aparezca justo antes de que timbre.

export const WEBPHONE_SHOW_EVENT = "kairo:webphone-show";

/** Pide que el telefono web se muestre (lo llama el boton Llamar). */
export function showWebphone(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WEBPHONE_SHOW_EVENT));
}

export function onShowWebphone(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WEBPHONE_SHOW_EVENT, callback);
  return () => window.removeEventListener(WEBPHONE_SHOW_EVENT, callback);
}
