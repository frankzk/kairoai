// Consulta a Cargo Expreso un lote de guias y guarda lo que responde. Lo usa el
// cron /api/cron/cargo-expreso.
import { forEachRateLimited } from "@/lib/concurrency";
import { upsertCargoExpresoTracking } from "@/lib/finance";
import { fetchCargoExpresoTracking, type CargoExpresoTracking } from "@/lib/cargo-expreso";

// Es la API de su pagina publica de rastreo, sin limite publicado: se consulta
// de a una guia por segundo, como mucho, para no parecer un ataque.
export const CARGO_EXPRESO_MIN_INTERVAL_MS = 1_000;
const CARGO_EXPRESO_CONCURRENCY = 2;

export interface CargoExpresoSyncResult {
  requested: number;
  checked: number;
  delivered: number;
  returned: number;
  /** Con un intento de entrega fallido sin volver a salir a ruta. */
  incidents: number;
  /** No respondio o no trajo la guia; no se guarda nada de esas. */
  failedLookups: number;
  /** No se llegaron a consultar por el corte de tiempo. */
  notStarted: number;
  saved: number;
}

export interface CargoExpresoSyncDeps {
  fetch: (guide: string) => Promise<CargoExpresoTracking>;
  save: (rows: CargoExpresoTracking[], storeId: number) => Promise<void>;
}

const DEFAULT_DEPS: CargoExpresoSyncDeps = {
  fetch: (guide) => fetchCargoExpresoTracking(guide),
  save: (rows, storeId) => upsertCargoExpresoTracking(rows, storeId),
};

/**
 * Consulta las guias y guarda las respuestas. Una guia que falla no frena la
 * tanda; un error al GUARDAR si se propaga, para que se note en el cron.
 * `deadlineMs` corta el arranque de consultas nuevas.
 */
export async function syncCargoExpresoGuides(
  guides: string[],
  storeId: number,
  opts: { deadlineMs?: number } = {},
  deps: CargoExpresoSyncDeps = DEFAULT_DEPS
): Promise<CargoExpresoSyncResult> {
  const result: CargoExpresoSyncResult = {
    requested: guides.length,
    checked: 0,
    delivered: 0,
    returned: 0,
    incidents: 0,
    failedLookups: 0,
    notStarted: 0,
    saved: 0,
  };
  const rows: CargoExpresoTracking[] = [];
  let started = 0;
  const deadline = opts.deadlineMs;

  await forEachRateLimited(
    guides,
    async (guide) => {
      started += 1;
      let tracking: CargoExpresoTracking;
      try {
        tracking = await deps.fetch(guide);
      } catch {
        result.failedLookups += 1;
        return;
      }
      result.checked += 1;
      if (tracking.latestGroup === "delivered") result.delivered += 1;
      if (tracking.latestGroup === "returned") result.returned += 1;
      if (tracking.hasIncident) result.incidents += 1;
      rows.push(tracking);
    },
    {
      concurrency: CARGO_EXPRESO_CONCURRENCY,
      minIntervalMs: CARGO_EXPRESO_MIN_INTERVAL_MS,
      shouldStop: deadline === undefined ? undefined : () => Date.now() >= deadline,
    }
  );
  result.notStarted = guides.length - started;

  if (rows.length) {
    await deps.save(rows, storeId);
    result.saved = rows.length;
  }
  return result;
}
