// Lado navegador de la telefonia: que proveedor esta activo y como le pide el
// boton "Llamar" al telefono de Telnyx que marque.
//
// El boton y el telefono viven en arboles de componentes distintos (el boton
// en cada ficha, el telefono una vez por pagina), asi que se hablan con un
// evento de ventana, igual que lib/webphone.ts para el de Zadarma.

export type ProveedorTelefonia = "zadarma" | "telnyx";

let proveedor: Promise<ProveedorTelefonia> | null = null;

/**
 * El proveedor que configuro el servidor (TELEFONIA). Se pregunta una vez por
 * pagina. Si la consulta falla se asume Zadarma, que es lo que habia: un
 * error aqui nunca debe dejar a la asesora sin telefono.
 */
export function proveedorTelefoniaCliente(): Promise<ProveedorTelefonia> {
  if (!proveedor) {
    proveedor = fetch("/api/telefonia", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { proveedor?: string } | null) => (d?.proveedor === "telnyx" ? "telnyx" : "zadarma"))
      .catch(() => "zadarma" as const);
  }
  return proveedor;
}

export interface LlamadaTelnyx {
  /** Numero del cliente en E.164 con '+'. */
  destino: string;
  /** Numero de la tienda que ve el cliente. */
  callerNumber: string;
  /** Id de la llamada de Kairo, para el webhook. */
  clientState: string;
}

const MARCAR_EVENT = "kairo:telnyx-marcar";

/** Pide al telefono de Telnyx de la pagina que marque. */
export function marcarTelnyx(llamada: LlamadaTelnyx): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LlamadaTelnyx>(MARCAR_EVENT, { detail: llamada }));
}

export function onMarcarTelnyx(callback: (llamada: LlamadaTelnyx) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => callback((e as CustomEvent<LlamadaTelnyx>).detail);
  window.addEventListener(MARCAR_EVENT, handler);
  return () => window.removeEventListener(MARCAR_EVENT, handler);
}
