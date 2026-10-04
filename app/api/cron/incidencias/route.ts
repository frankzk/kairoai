import { NextResponse } from "next/server";
import { detectIncidents } from "@/lib/incidents-run";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
// Holgado para el escaneo completo (backfill / boton manual). En regimen
// incremental cada corrida procesa poco y termina mucho antes.
export const maxDuration = 300;

async function handle(full: boolean) {
  try {
    const result = await detectIncidents(full);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta una tabla requerida (migraciones 0016_incidencias / 0017_incident_sync_state, moovin_tracking, forza_tracking o logistics_rows)."
      : message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}

// El cron programado de Vercel (GET) corre en modo incremental.
async function handleGet() {
  return handle(false);
}

// El boton "Detectar novedades" (POST con ?full=1) reescanea todo, para rellenar
// datos faltantes en novedades ya creadas.
async function handlePost(req: Request) {
  const full = new URL(req.url).searchParams.get("full");
  return handle(full === "1" || full === "true");
}

export const GET = withCronRun("incidencias", handleGet);
export const POST = withCronRun("incidencias", handlePost);
