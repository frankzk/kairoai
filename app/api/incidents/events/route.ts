import { NextRequest, NextResponse } from "next/server";
import { getIncident, getIncidentEvent, recordIncidentEvent, updateIncidentNote } from "@/lib/incidents";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";

// La tienda se valida igual que en el resto de la API de novedades. El
// middleware solo verifica que la persona tenga acceso a la tienda del ?store=;
// la novedad tiene que ser de esa tienda. Antes este endpoint ignoraba la tienda:
// alguien con acceso solo a Honduras podia escribir o editar notas de una
// novedad de Costa Rica conociendo su numero.
function storeRequerida(req: NextRequest) {
  return getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
}

function sinTienda() {
  return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
}

// Crear una nota: queda como evento kind "nota" en el historial de la novedad.
// No usa patchIncident (no marca manual_override): una nota no debe "congelar"
// la novedad frente al cron de deteccion.
export async function POST(req: NextRequest) {
  const store = storeRequerida(req);
  if (!store) return sinTienda();
  const body = await req.json().catch(() => null);
  const incidentId = Number(body?.incident_id);
  const message = String(body?.message ?? "").trim();
  if (!incidentId || !message) {
    return NextResponse.json({ error: "incident_id y message requeridos" }, { status: 400 });
  }
  try {
    if (!(await getIncident(incidentId, store.id))) {
      return NextResponse.json({ error: "Novedad no encontrada" }, { status: 404 });
    }
    await recordIncidentEvent(incidentId, { kind: "nota", message, result: "info" });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Error al guardar la nota";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

// Editar el texto de una nota existente (solo kind "nota").
export async function PATCH(req: NextRequest) {
  const store = storeRequerida(req);
  if (!store) return sinTienda();
  const body = await req.json().catch(() => null);
  const eventId = Number(body?.event_id);
  const message = String(body?.message ?? "").trim();
  if (!eventId || !message) {
    return NextResponse.json({ error: "event_id y message requeridos" }, { status: 400 });
  }
  try {
    const event = await getIncidentEvent(eventId);
    // Lo demas del historial (deteccion, llamadas, cambios de estado) es bitacora inmutable.
    if (!event || event.kind !== "nota" || !(await getIncident(event.incident_id, store.id))) {
      return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
    }
    await updateIncidentNote(eventId, message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Error al editar la nota";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
