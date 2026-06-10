import { NextResponse } from "next/server";
import { getProfitabilitySummary } from "@/lib/finance";

export const runtime = "nodejs";

export async function GET() {
  try {
    const summary = await getProfitabilitySummary();
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al calcular rentabilidad";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
