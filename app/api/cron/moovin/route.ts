import { NextResponse } from "next/server";
import { fetchMoovinTracking } from "@/lib/moovin";
import { listMoovinSyncCandidates, upsertMoovinTracking } from "@/lib/finance";

export const runtime = "nodejs";
export const maxDuration = 60;

// ~2 req/s a Moovin.
const PER_REQUEST_DELAY_MS = 400;
// Tope por corrida para no exceder maxDuration; el resto se cubre en la
// siguiente ejecucion del cron. Configurable por env para afinar segun el plan
// (en Vercel Pro se puede subir maxDuration y este tope para cubrir mas guias).
const MAX_PER_RUN = Number(process.env.MOOVIN_MAX_PER_RUN ?? 130);
// No reconsultar guias vistas dentro de esta ventana. Por defecto 20 min para
// que el cron de 15 min mantenga el tracking fresco sin re-consultar de mas.
const FRESH_WINDOW_MINUTES = Number(process.env.MOOVIN_FRESH_WINDOW_MIN ?? 20);

// Si CRON_SECRET esta configurado, exigirlo (Vercel cron y el workflow de
// GitHub mandan "Authorization: Bearer <CRON_SECRET>"). Si no esta, se permite
// (compatibilidad con el comportamiento actual).
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function run() {
  let candidates;
  try {
    candidates = await listMoovinSyncCandidates(MAX_PER_RUN, FRESH_WINDOW_MINUTES);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta la tabla moovin_tracking (migracion 0006)."
      : message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }

  let checked = 0;
  let incidents = 0;
  let delivered = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await sleep(PER_REQUEST_DELAY_MS);
    const tracking = await fetchMoovinTracking(candidates[i].idPackage, candidates[i].lastName);
    if (!tracking.ok || !tracking.latest_status) {
      failed += 1;
      continue;
    }
    checked += 1;
    if (tracking.has_incident) incidents += 1;
    if (tracking.latest_group === "delivered") delivered += 1;
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
      console.warn("[cron/moovin cache]", err);
    }
  }

  return NextResponse.json({
    candidates: candidates.length,
    checked,
    delivered,
    incidents,
    failed,
  });
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
