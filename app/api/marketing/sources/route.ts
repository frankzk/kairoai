import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { MARKETING_STORE } from "@/lib/marketing";
import { periodFromParams } from "@/lib/marketing-dates";
import { getMarketingSources } from "@/lib/marketing-sources";
import { leerCuentasTiktok } from "@/lib/tiktok-diario";

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
    await getMarketingSources(period, process.env, fetch, {
      details: !["overview", "basic", "report"].includes(
        req.nextUrl.searchParams.get("scope") || "",
      ),
      daily: req.nextUrl.searchParams.get("scope") === "report" || undefined,
      overview: req.nextUrl.searchParams.get("scope") === "overview",
      // Sin acceso a la API de TikTok, el gasto que manda Make (lib/tiktok-diario.ts).
      tiktokDesdeMake: (from, to) => leerCuentasTiktok(store.id, from, to),
    }),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
