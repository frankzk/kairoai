import { NextResponse } from "next/server";
import { evaluateAll, isProblem } from "@/lib/cron-jobs";
import { listCronRuns } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: estado de los procesos automaticos. Lo lee la tira de aviso que aparece
// arriba de todas las pantallas cuando algo se atrasa. Requiere sesion.
export async function GET() {
  try {
    const jobs = evaluateAll(await listCronRuns(), Date.now());
    return NextResponse.json({
      checked_at: new Date().toISOString(),
      // Solo si esta o no: el valor nunca sale del servidor.
      cron_secret_configured: Boolean(process.env.CRON_SECRET),
      problemas: jobs.filter(isProblem),
      jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer la salud de los crons";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
