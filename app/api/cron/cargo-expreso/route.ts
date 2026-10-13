import { NextResponse } from "next/server";
import { listCargoExpresoSyncCandidates } from "@/lib/finance";
import { syncCargoExpresoGuides } from "@/lib/cargo-expreso-sync";
import { getStoreConfig } from "@/lib/stores";
import { detectIncidents } from "@/lib/incidents-run";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POR QUE EXISTE: Cargo Expreso lleva parte de los envios de Mireva Honduras
// (guias BH...-1) y Kairo no los seguia: sus intentos fallidos y devoluciones no
// llegaban a Novedades. De 60 guias de septiembre y octubre, 22 se devolvieron
// sin que nadie llamara al cliente desde Kairo. Ver lib/cargo-expreso.ts.

// Solo Honduras usa Cargo Expreso.
const STORE_CODE = "mireva-hn";
// ~60 guias en los ultimos 90 dias (13/10/2026): una corrida las cubre todas.
const MAX_PER_RUN = Number(process.env.CARGO_EXPRESO_MAX_PER_RUN ?? 150);
// Una guia ya leida no se reconsulta dentro de esta ventana (el cron corre cada hora).
const FRESH_WINDOW_MINUTES = Number(process.env.CARGO_EXPRESO_FRESH_WINDOW_MIN ?? 45);
const DISCOVERY_DAYS = Number(process.env.CARGO_EXPRESO_DISCOVERY_DAYS ?? 90);
// Margen antes del maxDuration (300 s) para guardar y detectar novedades.
const TIME_BUDGET_MS = 200_000;

async function run(chainDetect: boolean) {
  const startedAt = Date.now();
  const store = getStoreConfig(STORE_CODE);
  try {
    const guides = await listCargoExpresoSyncCandidates(store.id, {
      limit: MAX_PER_RUN,
      freshWindowMinutes: FRESH_WINDOW_MINUTES,
      discoveryDays: DISCOVERY_DAYS,
    });
    const sync = await syncCargoExpresoGuides(guides, store.id, { deadlineMs: startedAt + TIME_BUDGET_MS });

    // Encadena la deteccion sobre el tracking recien leido, como Forza y Moovin.
    let detected: Awaited<ReturnType<typeof detectIncidents>> | null = null;
    if (chainDetect && sync.checked > 0) {
      try {
        detected = await detectIncidents(false);
      } catch (err) {
        console.warn("[cron/cargo-expreso detect]", err);
      }
    }

    // Si ninguna consulta respondio, Cargo Expreso cambio o bloqueo la API:
    // tiene que verse como error, no quedar tapado por un 200.
    const caido = guides.length > 0 && sync.checked === 0 && sync.failedLookups > 0;
    return NextResponse.json(
      {
        store: store.code,
        candidates: guides.length,
        checked: sync.checked,
        delivered: sync.delivered,
        returned: sync.returned,
        incidents: sync.incidents,
        failed_lookups: sync.failedLookups,
        not_started: sync.notStarted,
        saved: sync.saved,
        detected,
      },
      { status: caido ? 502 : 200 }
    );
  } catch (err) {
    console.error("[cron/cargo-expreso]", err);
    return NextResponse.json(
      { store: store.code, error: err instanceof Error ? err.message : "Error" },
      { status: 500 }
    );
  }
}

async function handleGet() {
  return run(true);
}

async function handlePost() {
  return run(false);
}

export const GET = withCronRun("cargo-expreso", handleGet);
export const POST = withCronRun("cargo-expreso", handlePost);
