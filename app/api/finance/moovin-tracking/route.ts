import { NextRequest, NextResponse } from "next/server";
import { fetchMoovinTracking } from "@/lib/moovin";
import { upsertMoovinTracking } from "@/lib/finance";

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

  return NextResponse.json(tracking);
}
