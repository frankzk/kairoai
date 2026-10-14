// Lectura periodica de los couriers de Honduras que Kairo sigue por su rastreo
// publico (Cargo Expreso y c807 Xpress): consulta un lote de guias, guarda lo
// que responden y encadena la deteccion de novedades. La usan los crons
// /api/cron/cargo-expreso y /api/cron/c807.
import { forEachRateLimited } from "@/lib/concurrency";
import { listShipmentSyncCandidates, upsertShipmentTracking, type ShipmentCourierCode } from "@/lib/finance";
import { fetchCargoExpresoTracking } from "@/lib/cargo-expreso";
import { fetchC807Tracking } from "@/lib/c807";
import type { ShipmentTracking } from "@/lib/courier-tracking";
import { detectIncidents } from "@/lib/incidents-run";
import { getStoreConfig } from "@/lib/stores";

export interface ShipmentCourier {
  nombre: string;
  fetch: (guide: string) => Promise<ShipmentTracking>;
  /** Espaciado minimo entre el arranque de dos consultas. */
  minIntervalMs: number;
  concurrency: number;
}

// Son las APIs de sus paginas publicas, sin limite publicado: se consultan
// despacio para no parecer un ataque. c807 corto 3 de 44 conexiones a una
// consulta por segundo, asi que va mas despacio y de a una.
export const SHIPMENT_COURIERS: Record<ShipmentCourierCode, ShipmentCourier> = {
  cargoexpreso: { nombre: "Cargo Expreso", fetch: fetchCargoExpresoTracking, minIntervalMs: 1_000, concurrency: 2 },
  c807: { nombre: "c807 Xpress", fetch: fetchC807Tracking, minIntervalMs: 1_500, concurrency: 1 },
};

export interface ShipmentSyncResult {
  requested: number;
  checked: number;
  delivered: number;
  returned: number;
  /** Con un intento de entrega fallido sin volver a salir a ruta. */
  incidents: number;
  /** No respondio o no trajo la guia; no se guarda nada de esas. La proxima corrida las reintenta. */
  failedLookups: number;
  /** No se llegaron a consultar por el corte de tiempo. */
  notStarted: number;
  saved: number;
}

export interface ShipmentSyncDeps {
  fetch: (guide: string) => Promise<ShipmentTracking>;
  save: (rows: ShipmentTracking[], storeId: number) => Promise<void>;
}

/**
 * Consulta las guias y guarda las respuestas. Una guia que falla no frena la
 * tanda; un error al GUARDAR si se propaga, para que se note en el cron.
 * `deadlineMs` corta el arranque de consultas nuevas.
 */
export async function syncShipmentGuides(
  guides: string[],
  storeId: number,
  opts: { deadlineMs?: number; minIntervalMs: number; concurrency: number },
  deps: ShipmentSyncDeps
): Promise<ShipmentSyncResult> {
  const result: ShipmentSyncResult = {
    requested: guides.length,
    checked: 0,
    delivered: 0,
    returned: 0,
    incidents: 0,
    failedLookups: 0,
    notStarted: 0,
    saved: 0,
  };
  const rows: ShipmentTracking[] = [];
  let started = 0;
  const deadline = opts.deadlineMs;

  await forEachRateLimited(
    guides,
    async (guide) => {
      started += 1;
      let tracking: ShipmentTracking;
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
      concurrency: opts.concurrency,
      minIntervalMs: opts.minIntervalMs,
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

/** Una corrida del cron de un courier: lee, guarda y (si se pide) detecta novedades. */
export async function runShipmentCron(
  courierCode: ShipmentCourierCode,
  opts: {
    storeCode: string;
    chainDetect: boolean;
    maxPerRun: number;
    freshWindowMinutes: number;
    discoveryDays: number;
    deadlineMs: number;
  }
): Promise<{ body: Record<string, unknown>; status: number }> {
  const courier = SHIPMENT_COURIERS[courierCode];
  const store = getStoreConfig(opts.storeCode);
  try {
    const guides = await listShipmentSyncCandidates(store.id, courierCode, {
      limit: opts.maxPerRun,
      freshWindowMinutes: opts.freshWindowMinutes,
      discoveryDays: opts.discoveryDays,
    });
    const sync = await syncShipmentGuides(
      guides,
      store.id,
      { deadlineMs: opts.deadlineMs, minIntervalMs: courier.minIntervalMs, concurrency: courier.concurrency },
      { fetch: courier.fetch, save: (rows, storeId) => upsertShipmentTracking(rows, storeId, courierCode) }
    );

    // Encadena la deteccion sobre el tracking recien leido, como Forza y Moovin.
    let detected: Awaited<ReturnType<typeof detectIncidents>> | null = null;
    if (opts.chainDetect && sync.checked > 0) {
      try {
        detected = await detectIncidents(false);
      } catch (err) {
        console.warn(`[cron/${courierCode} detect]`, err);
      }
    }

    // Si ninguna consulta respondio, el courier cambio o bloqueo la API: tiene
    // que verse como error, no quedar tapado por un 200.
    const caido = guides.length > 0 && sync.checked === 0 && sync.failedLookups > 0;
    return {
      status: caido ? 502 : 200,
      body: {
        store: store.code,
        courier: courier.nombre,
        candidates: guides.length,
        checked: sync.checked,
        delivered: sync.delivered,
        returned: sync.returned,
        incidents: sync.incidents,
        failed_lookups: sync.failedLookups,
        not_started: sync.notStarted,
        saved: sync.saved,
        detected,
      },
    };
  } catch (err) {
    console.error(`[cron/${courierCode}]`, err);
    return { status: 500, body: { store: store.code, error: err instanceof Error ? err.message : "Error" } };
  }
}
