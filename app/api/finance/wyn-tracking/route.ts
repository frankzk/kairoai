import { NextRequest, NextResponse } from "next/server";
import { upsertWynTracking } from "@/lib/finance";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { fetchWynTracking, isWynGuide } from "@/lib/wyn";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }

  const guide = (req.nextUrl.searchParams.get("guide") || "").trim();
  if (!guide) return NextResponse.json({ error: "guide requerido" }, { status: 400 });
  if (!isWynGuide(guide)) return NextResponse.json({ error: "La guia no corresponde a WYN." }, { status: 400 });
  if (store.code !== "mireva-cr") {
    return NextResponse.json({ error: "WYN solo esta habilitado para Mireva Costa Rica." }, { status: 400 });
  }

  try {
    const tracking = await fetchWynTracking(guide);
    try {
      await upsertWynTracking(
        [
          {
            guide_number: tracking.guideNumber,
            tracking_number: tracking.trackingNumber,
            latest_status: tracking.latestStatus,
            latest_code: tracking.latestCode,
            latest_group: tracking.latestGroup,
            latest_at: tracking.latestAt,
            has_incident: tracking.hasIncident,
            incident_reason: tracking.incidentReason,
            delivery_address: tracking.deliveryAddress,
            receiver_name: tracking.receiverName,
            events: tracking.events,
          },
        ],
        store.id
      );
    } catch (error) {
      console.warn("[wyn-tracking cache]", error);
    }

    return NextResponse.json({ ok: true, ...tracking });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar WYN.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
