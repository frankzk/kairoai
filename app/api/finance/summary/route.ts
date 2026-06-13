import { NextRequest, NextResponse } from "next/server";
import { getProfitabilitySummary } from "@/lib/finance";
import { getStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const store = getStoreFromSearchParams(req.nextUrl.searchParams);
  try {
    const summary = await getProfitabilitySummary(store.id);
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al calcular rentabilidad";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
