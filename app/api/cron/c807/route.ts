import { NextResponse } from "next/server";
import { runShipmentCron } from "@/lib/courier-shipment-sync";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POR QUE EXISTE: c807 Xpress llevo parte de los envios de Mireva Honduras
// (guias 6595-13968-...) y Kairo no los seguia. De 44 guias de septiembre, 15
// terminaron devueltas, 3 tenian un intento fallido sin gestionar y 3 nunca las
// recogio c807 (13/10/2026). Ver lib/c807.ts.

// 44 guias en los ultimos 90 dias: una corrida las cubre (a 1,5 s cada una).
const MAX_PER_RUN = Number(process.env.C807_MAX_PER_RUN ?? 100);
// Una guia ya leida no se reconsulta dentro de esta ventana (el cron corre cada hora).
const FRESH_WINDOW_MINUTES = Number(process.env.C807_FRESH_WINDOW_MIN ?? 45);
const DISCOVERY_DAYS = Number(process.env.C807_DISCOVERY_DAYS ?? 90);
// Margen antes del maxDuration (300 s) para guardar y detectar novedades.
const TIME_BUDGET_MS = 200_000;

async function run(chainDetect: boolean) {
  const { body, status } = await runShipmentCron("c807", {
    // Solo Honduras usa c807 Xpress.
    storeCode: "mireva-hn",
    chainDetect,
    maxPerRun: MAX_PER_RUN,
    freshWindowMinutes: FRESH_WINDOW_MINUTES,
    discoveryDays: DISCOVERY_DAYS,
    deadlineMs: Date.now() + TIME_BUDGET_MS,
  });
  return NextResponse.json(body, { status });
}

async function handleGet() {
  return run(true);
}

async function handlePost() {
  return run(false);
}

export const GET = withCronRun("c807", handleGet);
export const POST = withCronRun("c807", handlePost);
