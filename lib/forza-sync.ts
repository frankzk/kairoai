// Consulta a Forza un lote de guias y guarda lo que responde. Lo usan el boton
// manual "Forza (N)" del tablero y el cron /api/cron/forza.
import { forEachRateLimited } from "@/lib/concurrency";
import { upsertForzaTracking } from "@/lib/finance";
import { fetchForzaTracking, type ForzaTracking } from "@/lib/forza";

// Espaciado MINIMO entre el ARRANQUE de dos consultas a Forza: es el limite de
// tasa acordado con el courier y no se toca (<= 1 consulta cada 300 ms).
export const FORZA_MIN_INTERVAL_MS = 300;
// Consultas en vuelo a la vez: saca la latencia de Forza del camino critico sin
// subir la tasa (ver lib/concurrency.ts y el commit 7f2abde).
export const FORZA_CONCURRENCY = 5;
// Filas por upsert: cada una lleva el historial de eventos en JSON.
const SAVE_CHUNK = 50;

type ForzaRow = Parameters<typeof upsertForzaTracking>[0][number];

export interface ForzaSyncResult {
  requested: number;
  /** Respondieron con estado. */
  checked: number;
  delivered: number;
  incidents: number;
  /** Forza no respondio o no trajo estado; no se guarda nada de esas. */
  failedLookups: number;
  /** No se llegaron a consultar por el corte de tiempo. */
  notStarted: number;
  /** Filas guardadas en forza_tracking. */
  saved: number;
  results: Array<{ guide_number: string; latest_status: string | null; group: string | null; has_incident: boolean }>;
}

export interface ForzaSyncDeps {
  fetch: (guide: string) => Promise<ForzaTracking>;
  save: (rows: ForzaRow[], storeId: number) => Promise<void>;
}

const DEFAULT_DEPS: ForzaSyncDeps = {
  fetch: (guide) => fetchForzaTracking(guide),
  save: (rows, storeId) => upsertForzaTracking(rows, storeId),
};

/**
 * Consulta las guias respetando la tasa de Forza y guarda las respuestas.
 *
 * Un error al GUARDAR se propaga. Antes el boton lo tragaba con un warn y
 * mostraba "Forza actualizado: N consultados" aunque no se hubiera guardado
 * nada; si el tracking deja de actualizarse, tiene que notarse.
 *
 * `deadlineMs` corta el ARRANQUE de consultas nuevas (las que estan en vuelo
 * terminan), para no pasarse del maxDuration de la funcion si Forza anda lento.
 */
export async function syncForzaGuides(
  guides: string[],
  storeId: number,
  opts: { deadlineMs?: number } = {},
  deps: ForzaSyncDeps = DEFAULT_DEPS
): Promise<ForzaSyncResult> {
  const result: ForzaSyncResult = {
    requested: guides.length,
    checked: 0,
    delivered: 0,
    incidents: 0,
    failedLookups: 0,
    notStarted: 0,
    saved: 0,
    results: [],
  };
  const pending: ForzaRow[] = [];
  let started = 0;
  const deadline = opts.deadlineMs;

  // JS corre en un solo hilo: los contadores no necesitan lock.
  await forEachRateLimited(
    guides,
    async (guide) => {
      started += 1;
      let tracking: ForzaTracking;
      try {
        tracking = await deps.fetch(guide);
      } catch {
        // Una guia que falla no frena al resto de la tanda.
        result.failedLookups += 1;
        return;
      }
      if (!tracking.ok || !tracking.latest_status) {
        result.failedLookups += 1;
        return;
      }
      result.checked += 1;
      if (tracking.has_incident) result.incidents += 1;
      if (tracking.latest_group === "delivered") result.delivered += 1;
      result.results.push({
        guide_number: tracking.guide_number,
        latest_status: tracking.latest_status,
        group: tracking.latest_group,
        has_incident: tracking.has_incident,
      });
      pending.push({
        guide_number: tracking.guide_number,
        tracking_number: tracking.tracking_number,
        latest_status: tracking.latest_status ?? "",
        latest_code: tracking.latest_status_code ?? "",
        latest_group: tracking.latest_group ?? "",
        latest_at: tracking.latest_at,
        has_incident: tracking.has_incident,
        incident_reason: tracking.incident_reason,
        delivery_address: tracking.delivery_address,
        receiver_name: tracking.receiver_name,
        events: tracking.events,
      });
    },
    {
      concurrency: FORZA_CONCURRENCY,
      minIntervalMs: FORZA_MIN_INTERVAL_MS,
      shouldStop: deadline === undefined ? undefined : () => Date.now() >= deadline,
    }
  );
  result.notStarted = guides.length - started;

  for (let i = 0; i < pending.length; i += SAVE_CHUNK) {
    const chunk = pending.slice(i, i + SAVE_CHUNK);
    await deps.save(chunk, storeId);
    result.saved += chunk.length;
  }
  return result;
}
