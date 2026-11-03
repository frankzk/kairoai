import { NextResponse } from "next/server";
import { activarCostoEnWebhooks, costoEnWebhooksActivo, getTelnyxConfig } from "@/lib/telnyx";
import { costosTelnyx } from "@/lib/telnyx-costos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Costo de las llamadas de Telnyx, para la tarjeta de Configuracion (exige
// "config", lib/permisos.ts). Solo montos y nombres: nunca claves.

async function estadoAviso(): Promise<{ activo: boolean | null; error: string | null }> {
  const { config } = getTelnyxConfig();
  if (!config) return { activo: null, error: "Faltan credenciales de Telnyx" };
  try {
    return { activo: await costoEnWebhooksActivo(config), error: null };
  } catch (err) {
    return { activo: null, error: err instanceof Error ? err.message : "No se pudo consultar Telnyx" };
  }
}

/** GET: el resumen de hoy y del mes, y si Telnyx esta mandando el costo. */
export async function GET() {
  const [aviso, costos] = await Promise.all([
    estadoAviso(),
    costosTelnyx().catch((err: unknown) => (err instanceof Error ? err : new Error("error"))),
  ]);
  if (costos instanceof Error) {
    return NextResponse.json({ error: costos.message, aviso }, { status: 500 });
  }
  return NextResponse.json({ aviso, ...costos });
}

/** POST: activa en la Credential Connection el aviso de costo (call.cost). */
export async function POST() {
  const { config, faltan } = getTelnyxConfig();
  if (!config) return NextResponse.json({ error: `Falta en Vercel: ${faltan.join(", ")}` }, { status: 400 });
  try {
    const activo = await activarCostoEnWebhooks(config);
    return NextResponse.json({ ok: activo, activo });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo activar" }, { status: 502 });
  }
}
