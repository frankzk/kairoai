import { NextRequest, NextResponse } from "next/server";
import { vendedoraEfectiva } from "@/lib/identidad";
import { getTelnyxConfig, TelnyxError } from "@/lib/telnyx";
import { tokenDeAsesora } from "@/lib/telnyx-calls";

export const runtime = "nodejs";
export const maxDuration = 20;

// POST: el token (JWT) con que el navegador de la asesora se conecta a Telnyx.
// La credencial se crea sola la primera vez (lib/telnyx-calls.ts).
//
// El token se reutiliza mientras siga vigente (ver tokenDeAsesora).
export async function POST(req: NextRequest) {
  const { config, faltan } = getTelnyxConfig();
  if (!config) {
    return NextResponse.json({ error: `Telnyx no configurado: falta ${faltan.join(" y ")}.` }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { vendedora_id?: number } | null;
  // Una asesora sin permiso de supervision queda SIEMPRE a su nombre
  // (lib/identidad.ts): el navegador no puede pedir el telefono de otra.
  const vendedoraId = vendedoraEfectiva(body?.vendedora_id) ?? NaN;
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "Selecciona quién eres (asesora) para usar el teléfono." }, { status: 400 });
  }

  try {
    const r = await tokenDeAsesora(vendedoraId, config);
    if (!r) return NextResponse.json({ error: "Asesora no encontrada o inactiva." }, { status: 404 });
    return NextResponse.json({ token: r.token, asesora: r.asesora });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo conectar el teléfono";
    return NextResponse.json({ error: message }, { status: err instanceof TelnyxError ? 502 : 500 });
  }
}
