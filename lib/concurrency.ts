// Utilidad para consultar APIs de terceros sin pagar por esperar.
//
// El patron ingenuo es "dormir X ms y despues consultar": el resultado es que
// cada item cuesta X + latencia, y en serverless se factura todo ese rato con
// la funcion sin hacer nada. Aca se separan las dos cosas: se limita cada
// cuanto ARRANCA una consulta (la tasa que exige el proveedor) y se permite
// tener varias en vuelo, asi la latencia sale del camino critico.

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RateLimitedOptions {
  /** Consultas simultaneas como maximo. */
  concurrency: number;
  /** Milisegundos minimos entre el ARRANQUE de dos consultas. */
  minIntervalMs: number;
}

/**
 * Recorre `items` llamando a `worker`, con concurrencia acotada y una tasa de
 * arranque garantizada (nunca dos arranques separados por menos de
 * `minIntervalMs`).
 *
 * Si `worker` lanza, el error se propaga igual que en Promise.all; el resto de
 * las tareas en vuelo termina, pero no se arrancan nuevas.
 */
export async function forEachRateLimited<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  opts: RateLimitedOptions
): Promise<void> {
  const concurrency = Math.max(1, Math.min(opts.concurrency, items.length));
  if (items.length === 0) return;

  let nextSlotAt = Date.now();
  const reserveSlot = (): Promise<void> => {
    const now = Date.now();
    const startAt = Math.max(now, nextSlotAt);
    nextSlotAt = startAt + opts.minIntervalMs;
    const wait = startAt - now;
    return wait > 0 ? sleep(wait) : Promise.resolve();
  };

  // Cursor compartido: JS es de un solo hilo, asi que el i++ no necesita lock.
  let cursor = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await reserveSlot();
      await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, run));
}
