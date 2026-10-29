import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { marketingMonth, MARKETING_STORE } from "@/lib/marketing";
import { getMarketingSources } from "@/lib/marketing-sources";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store || store.code !== MARKETING_STORE) {
    return NextResponse.json({ error: "store=mireva-cr requerido y autorizado." }, { status: 400 });
  }
  const month = req.nextUrl.searchParams.get("month") || "";
  if (!marketingMonth(month)) return NextResponse.json({ error: "month requerido con formato YYYY-MM válido." }, { status: 400 });
  return NextResponse.json(await getMarketingSources(month), { headers: { "Cache-Control": "private, no-store" } });
}
