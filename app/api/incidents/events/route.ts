import { NextRequest, NextResponse } from "next/server";
import { recordIncidentEvent, updateIncidentNote } from "@/lib/incidents";

export const runtime = "nodejs";

// Crear una nota: queda como evento kind "nota" en el historial de la novedad.
// No usa patchIncident (no marca manual_override): una nota no debe "congelar"
// la novedad frente al cron de deteccion.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const incidentId = Number(body?.incident_id);
  const message = String(body?.message ?? "").trim();
  if (!incidentId || !message) {
    return NextResponse.json({ error: "incident_id y message requeridos" }, { status: 400 });
  }
  try {
    await recordIncidentEvent(incidentId, { kind: "nota", message, result: "info" });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Error al guardar la nota";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}

// Editar el texto de una nota existente (solo kind "nota").
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const eventId = Number(body?.event_id);
  const message = String(body?.message ?? "").trim();
  if (!eventId || !message) {
    return NextResponse.json({ error: "event_id y message requeridos" }, { status: 400 });
  }
  try {
    await updateIncidentNote(eventId, message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const m = err instanceof Error ? err.message : "Error al editar la nota";
    return NextResponse.json({ error: m }, { status: 500 });
  }
}
