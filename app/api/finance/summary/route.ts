import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getProfitabilitySummary } from "@/lib/finance";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    const summary = await getProfitabilitySummary(store.id);
    return NextResponse.json({ summary });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al calcular rentabilidad");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
