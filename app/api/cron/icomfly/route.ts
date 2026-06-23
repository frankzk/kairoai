import { NextResponse } from "next/server";
import { runIcomflySync } from "@/lib/icomfly-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cron: refresca el estado de despacho desde iComfly. Publico (sin cookie),
// igual que el resto de crons del proyecto.
async function handle() {
  try {
    const result = await runIcomflySync();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error en cron iComfly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
