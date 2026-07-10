import { NextRequest, NextResponse } from "next/server";
import { fetchMoovinTracking, type MoovinTracking } from "@/lib/moovin";
import { getMoovinTrackingByPackage, upsertMoovinTracking } from "@/lib/finance";
import type { MoovinTrackingRow } from "@/lib/finance-types";

export const runtime = "nodejs";
export const maxDuration = 30;

// Consulta bajo demanda de una guia. Cachea el resultado en moovin_tracking
// para que la siguiente carga ya lo tenga sin volver a llamar a Moovin.
export async function GET(req: NextRequest) {
  const idPackage = (req.nextUrl.searchParams.get("idPackage") || "").trim();
  const lastName = (req.nextUrl.searchParams.get("lastName") || "").trim();
  const includeRaw = req.nextUrl.searchParams.get("raw") === "1";
  if (!idPackage) {
    return NextResponse.json({ error: "idPackage requerido" }, { status: 400 });
  }

  let cached: MoovinTrackingRow | null = null;
  try {
    cached = await getMoovinTrackingByPackage(idPackage);
  } catch (err) {
    console.warn("[moovin-tracking cache read]", err);
  }

  const tracking = await fetchMoovinTracking(idPackage, lastName, { includeRaw });

  if (tracking.ok && tracking.latest_status) {
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
      console.warn("[moovin-tracking cache]", err);
    }
  }

  if ((!tracking.ok || !tracking.latest_status) && cached?.latest_status) {
    return NextResponse.json(cachedMoovinTracking(cached, tracking.error));
  }

  return NextResponse.json(tracking);
}

function cachedMoovinTracking(
  row: MoovinTrackingRow,
  warning = "Moovin no devolvio datos nuevos."
): MoovinTracking & { checked_at: string; from_cache: true; stale: true; warning: string } {
  return {
    ok: true,
    http_status: 200,
    id_package: row.id_package,
    last_name: row.last_name,
    tracking_number: row.tracking_number,
    profile: "",
    latest_status: row.latest_status,
    latest_status_code: row.latest_code,
    latest_group: row.latest_group as MoovinTracking["latest_group"],
    latest_at: row.latest_at,
    delivery_address: row.delivery_address,
    has_incident: row.has_incident,
    incident_reason: row.incident_reason,
    events: row.events as MoovinTracking["events"],
    checked_at: row.checked_at,
    from_cache: true,
    stale: true,
    warning,
  };
}
