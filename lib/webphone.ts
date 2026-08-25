// Visibilidad del telefono web dentro de la pestaña.
//
// El widget de Zadarma tiene que estar MONTADO siempre: es lo que registra la
// extension en la centralita, y sin registro no hay donde timbrar. Pero no
// tiene que estar VISIBLE siempre: flotando sobre el tablero todo el dia solo
// estorba. Se monta oculto y se muestra cuando hace falta.
//
// Los eventos existen para que el boton "Llamar" y los drawers —que viven en
// otros arboles de componentes— puedan pedir que aparezca o se vaya.
//
// IMPORTANTE para quien venga despues: la visibilidad se maneja SOLO con
// señales nuestras (estos eventos y nuestra propia tabla de llamadas). Dos
// intentos de leer el estado del widget terminaron en produccion rota:
//
//   #193  adivinar su markup      -> rompio el boton de colgar
//   #196  envolver RTCPeerConnection -> "WebrtcPhoneInterface is not defined",
//                                       el telefono dejo de llamar
//
// Poder llamar vale mas que cualquier comodidad. Si hace falta una señal
// nueva, que salga de nuestro lado, no del widget.

export const WEBPHONE_SHOW_EVENT = "kairo:webphone-show";
export const WEBPHONE_HIDE_EVENT = "kairo:webphone-hide";

/** Pide que el telefono web se muestre (lo llama el boton Llamar). */
export function showWebphone(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WEBPHONE_SHOW_EVENT));
}

/**
 * Pide que el telefono web se oculte. Lo llaman los drawers al cerrarse: si la
 * asesora cerro la ficha, ya no esta llamando desde ahi.
 */
export function hideWebphone(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WEBPHONE_HIDE_EVENT));
}

export function onShowWebphone(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WEBPHONE_SHOW_EVENT, callback);
  return () => window.removeEventListener(WEBPHONE_SHOW_EVENT, callback);
}

export function onHideWebphone(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WEBPHONE_HIDE_EVENT, callback);
  return () => window.removeEventListener(WEBPHONE_HIDE_EVENT, callback);
}
