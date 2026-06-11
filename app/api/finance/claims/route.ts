import { NextRequest, NextResponse } from "next/server";
import { listFinanceClaims, upsertFinanceClaim } from "@/lib/finance";

export const runtime = "nodejs";

export async function GET() {
  try {
    const claims = await listFinanceClaims();
    return NextResponse.json({ claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer reclamos";
    return NextResponse.json({ claims: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.anomaly_key) {
    return NextResponse.json({ error: "anomaly_key requerido" }, { status: 400 });
  }

  try {
    const claim = await upsertFinanceClaim(body);
    return NextResponse.json({ claim });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al guardar reclamo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
