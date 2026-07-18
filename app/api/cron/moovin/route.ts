import { NextResponse } from "next/server";
import { fetchMoovinTracking } from "@/lib/moovin";
import { listMoovinSyncCandidates, upsertMoovinTracking } from "@/lib/finance";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";
import { detectIncidents } from "@/lib/incidents-run";

export const runtime = "nodejs";
export const maxDuration = 300;

// ~2 req/s a Moovin.
const PER_REQUEST_DELAY_MS = 400;
// Tope por corrida para no exceder maxDuration; el resto se cubre en la
// siguiente ejecucion del cron.
const MAX_PER_RUN = 120;
// No reconsultar guias vistas en las ultimas 6h.
const FRESH_WINDOW_MINUTES = 6 * 60;

async function run(chainDetect: boolean) {
  const moovinStores = FINANCE_STORES.filter((store) => store.logisticsProvider === "moovin");
  const candidates: Array<{ idPackage: string; lastName: string }> = [];
  const seen = new Set<string>();
  try {
    for (const store of moovinStores) {
      const remaining = MAX_PER_RUN - candidates.length;
      if (remaining <= 0) break;
      const storeCandidates = await listMoovinSyncCandidates(
        remaining,
        FRESH_WINDOW_MINUTES,
        store.id
      );
      for (const candidate of storeCandidates) {
        if (seen.has(candidate.idPackage)) continue;
        seen.add(candidate.idPackage);
        candidates.push(candidate);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta la tabla moovin_tracking (migracion 0006)."
      : message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }

  let checked = 0;
  let incidents = 0;
  let delivered = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await sleep(PER_REQUEST_DELAY_MS);
    const tracking = await fetchMoovinTracking(candidates[i].idPackage, candidates[i].lastName);
    if (!tracking.ok || !tracking.latest_status) {
      failed += 1;
      continue;
    }
    checked += 1;
    if (tracking.has_incident) incidents += 1;
    if (tracking.latest_group === "delivered") delivered += 1;
    try {
      await upsertMoovinTracking([
        {
          id_package: tracking.id_package,
          last_name: tracking.last_name,
          tracking_number: tracking.tracking_number,
          latest_status: tracking.latest_status ?? "",
          latest_code: tracking.latest_status_code ?? "",
          latest_group: tracking.latest_group ?? "",
          latest_at: tracking.latest_at,
          has_incident: tracking.has_incident,
          incident_reason: tracking.incident_reason,
          delivery_address: tracking.delivery_address,
          events: tracking.events,
        },
      ]);
    } catch (err) {
      console.warn("[cron/moovin cache]", err);
    }
  }

  // El cron muto moovin_tracking: refresca la cache durable del dataset de las
  // tiendas que usan Moovin (solo si hubo cambios). Defensivo: nunca rompe el cron.
  if (checked > 0) {
    await Promise.all(
      moovinStores.map((store) =>
        refreshFinanceDatasetCache(getStoreConfig(store.code)).catch((cacheErr) =>
          console.warn(`[cron/moovin cache] ${store.code}:`, cacheErr)
        )
      )
    );
  }

  // Encadena la deteccion de novedades sobre el tracking recien refrescado: asi
  // las incidencias nuevas entran sin depender de una corrida aparte. Solo en el
  // cron programado (GET) y si hubo cambios; best-effort (nunca rompe el sync).
  let detected: Awaited<ReturnType<typeof detectIncidents>> | null = null;
  if (chainDetect && checked > 0) {
    try {
      detected = await detectIncidents(false);
    } catch (err) {
      console.warn("[cron/moovin detect]", err);
    }
  }

  return NextResponse.json({
    candidates: candidates.length,
    checked,
    delivered,
    incidents,
    failed,
    detected,
  });
}

export async function GET() {
  return run(true);
}

export async function POST() {
  return run(false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
