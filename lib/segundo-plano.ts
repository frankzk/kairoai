// Trabajo que sigue DESPUES de responder (copiar una grabacion desde el
// webhook de Telnyx, sin hacerlo esperar).
//
// Next 14 no trae `after()` (llega en Next 15). En Vercel, el runtime de las
// funciones expone el contexto del pedido en
// globalThis[Symbol.for("@vercel/request-context")], con un waitUntil que
// mantiene viva la funcion hasta que la promesa termine: es lo mismo que usa
// el paquete @vercel/functions por dentro. Fuera de Vercel (local, tests) no
// existe y la promesa simplemente corre suelta; lo que no alcance a terminar
// lo recoge el cron `call-recordings`.

const CONTEXTO_VERCEL = Symbol.for("@vercel/request-context");

type ContextoPedido = { waitUntil?: (p: Promise<unknown>) => void };

function contextoVercel(): ContextoPedido | null {
  const g = globalThis as unknown as Record<symbol, { get?: () => ContextoPedido | undefined } | undefined>;
  try {
    return g[CONTEXTO_VERCEL]?.get?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Corre `tarea` despues de la respuesta. Nunca lanza: un error de la tarea se
 * anota en el log y nada mas (la tarea misma deja su rastro en la base).
 */
export function enSegundoPlano(nombre: string, tarea: () => Promise<unknown>): void {
  const p = Promise.resolve()
    .then(tarea)
    .catch((err) => console.warn(`[segundo-plano] ${nombre}: ${err instanceof Error ? err.message : String(err)}`));
  contextoVercel()?.waitUntil?.(p);
}
