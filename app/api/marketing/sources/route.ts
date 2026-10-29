import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { MARKETING_STORE } from "@/lib/marketing";
import { periodFromParams } from "@/lib/marketing-dates";
import { getMarketingSources } from "@/lib/marketing-sources";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store || store.code !== MARKETING_STORE) {
    return NextResponse.json(
      { error: "store=mireva-cr requerido y autorizado." },
      { status: 400 },
    );
  }
  const period = periodFromParams(req.nextUrl.searchParams);
  if (!period)
    return NextResponse.json(
      { error: "Indica un rango válido de hasta 93 días." },
      { status: 400 },
    );
  return NextResponse.json(
    await getMarketingSources(period, process.env, fetch, { details: true }),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
