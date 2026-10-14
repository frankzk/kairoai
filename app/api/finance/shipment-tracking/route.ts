// Seguimiento de una guia de Cargo Expreso o c807 Xpress para el modal de la
// tabla de pedidos: el historial completo dentro de Kairo, sin ir a la pagina
// del courier. Consulta en vivo y guarda la lectura (como el cron); si el
// courier no contesta, devuelve el ultimo historial guardado con su fecha.
import { NextRequest, NextResponse } from "next/server";
import { fetchC807Tracking } from "@/lib/c807";
import { fetchCargoExpresoTracking } from "@/lib/cargo-expreso";
import type { ShipmentTracking } from "@/lib/courier-tracking";
import { getShipmentTrackingByGuide, upsertShipmentTracking } from "@/lib/finance";
import {
  SHIPMENT_COURIER_LABELS,
  detectShipmentCourier,
  normalizeShipmentGuide,
  type ShipmentCourierCode,
} from "@/lib/shipment-couriers";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 30;

const FETCHERS: Record<ShipmentCourierCode, (guide: string) => Promise<ShipmentTracking>> = {
  cargoexpreso: fetchCargoExpresoTracking,
  c807: fetchC807Tracking,
};

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const rawGuide = (req.nextUrl.searchParams.get("guide") || "").trim();
  if (!rawGuide) return NextResponse.json({ error: "guide requerido" }, { status: 400 });
  const courier = detectShipmentCourier(rawGuide);
  if (!courier) {
    return NextResponse.json({ error: "La guia no es de Cargo Expreso ni de c807 Xpress." }, { status: 400 });
  }
  const guide = normalizeShipmentGuide(courier, rawGuide);
  const courierLabel = SHIPMENT_COURIER_LABELS[courier];

  try {
    const tracking = await FETCHERS[courier](guide);
    try {
      await upsertShipmentTracking([tracking], store.id, courier);
    } catch (error) {
      console.warn("[shipment-tracking cache]", error);
    }
    return NextResponse.json({ ok: true, courier, courierLabel, ...tracking });
  } catch (error) {
    const message = error instanceof Error ? error.message : `No se pudo consultar ${courierLabel}.`;
    try {
      const cached = await getShipmentTrackingByGuide(store.id, courier, guide);
      if (cached) {
        const result: ShipmentTracking = {
          guideNumber: cached.guide_number,
          latestStatus: cached.latest_status,
          latestCode: cached.latest_code,
          latestGroup: cached.latest_group as ShipmentTracking["latestGroup"],
          latestAt: cached.latest_at,
          hasIncident: cached.has_incident,
          incidentReason: cached.incident_reason,
          deliveryAddress: cached.delivery_address,
          receiverName: cached.receiver_name,
          events: cached.events as ShipmentTracking["events"],
        };
        return NextResponse.json({
          ok: true,
          courier,
          courierLabel,
          ...result,
          cached: true,
          cachedAt: cached.checked_at,
          liveError: message,
        });
      }
    } catch (cacheError) {
      console.warn("[shipment-tracking cache read]", cacheError);
    }
    return NextResponse.json({ ok: false, courier, courierLabel, error: message }, { status: 502 });
  }
}
