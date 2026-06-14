import { NextRequest, NextResponse } from "next/server";
import { fetchForzaTracking } from "@/lib/forza";
import { getStoreFromSearchParams } from "@/lib/stores";
import { upsertForzaTracking } from "@/lib/finance";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const store = getStoreFromSearchParams(req.nextUrl.searchParams);
  const guide = (req.nextUrl.searchParams.get("guide") || "").trim();
  const includeRaw = req.nextUrl.searchParams.get("raw") === "1";
  if (!guide) {
    return NextResponse.json({ error: "guide requerido" }, { status: 400 });
  }

  const tracking = await fetchForzaTracking(guide, { includeRaw });

  if (tracking.ok && tracking.latest_status) {
    try {
      await upsertForzaTracking(
        [
          {
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
          },
        ],
        store.id
      );
    } catch (err) {
      console.warn("[forza-tracking cache]", err);
    }
  }

  return NextResponse.json(tracking);
}
