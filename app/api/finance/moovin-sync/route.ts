import { NextRequest, NextResponse } from "next/server";
import { fetchMoovinTracking } from "@/lib/moovin";
import {
  getRecentlyCheckedMoovinPackages,
  listMoovinTracking,
  upsertMoovinTracking,
} from "@/lib/finance";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

// Moovin tracking es global (no por tienda); refresca el dataset de las tiendas
// que usan Moovin como transportadora. Defensivo: nunca rompe el sync.
async function refreshMoovinStores(): Promise<void> {
  const moovinStores = FINANCE_STORES.filter((store) => store.logisticsProvider === "moovin");
  await Promise.all(
    moovinStores.map((store) =>
      refreshFinanceDatasetCache(getStoreConfig(store.code)).catch((cacheErr) =>
        console.warn(`[moovin-sync cache] ${store.code}:`, cacheErr)
      )
    )
  );
}

// ~2 req/s a Moovin para no saturar; el cliente envia lotes y reintenta.
const PER_REQUEST_DELAY_MS = 400;
const MAX_PACKAGES_PER_CALL = 60;
// No reconsultar guias vistas dentro de esta ventana salvo force. Por defecto
// 20 min, alineado con el cron y el auto-refresco de 15 min.
const FRESH_WINDOW_MINUTES = Number(process.env.MOOVIN_FRESH_WINDOW_MIN ?? 20);

interface RequestedPackage {
  idPackage: string;
  lastName: string;
}

export async function GET() {
  try {
    const rows = await listMoovinTracking();
    return NextResponse.json({ rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer tracking Moovin";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta la tabla moovin_tracking: ejecuta supabase/migrations/0006_moovin_tracking.sql."
      : message;
    return NextResponse.json({ rows: [], total: 0, error: friendly }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requested = Array.isArray(body.packages) ? (body.packages as RequestedPackage[]) : [];
    const force = body.force === true;
    if (!requested.length) {
      return NextResponse.json({ error: "packages requerido" }, { status: 400 });
    }

    const valid = requested
      .map((p) => ({ idPackage: String(p.idPackage ?? "").trim(), lastName: String(p.lastName ?? "").trim() }))
      .filter((p) => p.idPackage)
      .slice(0, MAX_PACKAGES_PER_CALL);

    const fresh = force ? new Set<string>() : await getRecentlyCheckedMoovinPackages(FRESH_WINDOW_MINUTES);
    const toCheck = valid.filter((p) => !fresh.has(p.idPackage));

    let checked = 0;
    let incidents = 0;
    let delivered = 0;
    let failedLookups = 0;
    const results: Array<{ id_package: string; latest_status: string | null; group: string | null; has_incident: boolean }> = [];

    for (let i = 0; i < toCheck.length; i++) {
      if (i > 0) await sleep(PER_REQUEST_DELAY_MS);
      const tracking = await fetchMoovinTracking(toCheck[i].idPackage, toCheck[i].lastName);
      if (!tracking.ok || !tracking.latest_status) {
        failedLookups += 1;
        continue;
      }
      checked += 1;
      if (tracking.has_incident) incidents += 1;
      if (tracking.latest_group === "delivered") delivered += 1;
      results.push({
        id_package: tracking.id_package,
        latest_status: tracking.latest_status,
        group: tracking.latest_group,
        has_incident: tracking.has_incident,
      });
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
        console.warn("[moovin-sync cache]", err);
      }
    }

    // Solo si hubo cambios reales en moovin_tracking vale la pena reconstruir.
    if (checked > 0) await refreshMoovinStores();

    return NextResponse.json({
      requested: valid.length,
      skipped_fresh: valid.length - toCheck.length,
      checked,
      delivered,
      incidents,
      failed_lookups: failedLookups,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando Moovin";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
