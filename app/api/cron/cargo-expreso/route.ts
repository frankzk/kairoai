import { NextResponse } from "next/server";
import { runShipmentCron } from "@/lib/courier-shipment-sync";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POR QUE EXISTE: Cargo Expreso lleva parte de los envios de Mireva Honduras
// (guias BH...-1) y Kairo no los seguia: sus intentos fallidos y devoluciones no
// llegaban a Novedades. De 60 guias de septiembre y octubre, 22 se devolvieron
// sin que nadie llamara al cliente desde Kairo. Ver lib/cargo-expreso.ts.

// ~60 guias en los ultimos 90 dias (13/10/2026): una corrida las cubre todas.
const MAX_PER_RUN = Number(process.env.CARGO_EXPRESO_MAX_PER_RUN ?? 150);
// Una guia ya leida no se reconsulta dentro de esta ventana (el cron corre cada hora).
const FRESH_WINDOW_MINUTES = Number(process.env.CARGO_EXPRESO_FRESH_WINDOW_MIN ?? 45);
const DISCOVERY_DAYS = Number(process.env.CARGO_EXPRESO_DISCOVERY_DAYS ?? 90);
// Margen antes del maxDuration (300 s) para guardar y detectar novedades.
const TIME_BUDGET_MS = 200_000;

async function run(chainDetect: boolean) {
  const { body, status } = await runShipmentCron("cargoexpreso", {
    // Solo Honduras usa Cargo Expreso.
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

export const GET = withCronRun("cargo-expreso", handleGet);
export const POST = withCronRun("cargo-expreso", handlePost);
