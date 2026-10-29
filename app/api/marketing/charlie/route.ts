import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { periodFromParams } from "@/lib/marketing-dates";
import { getCharlieReport } from "@/lib/marketing-charlie-source";
import type { CharlieReport } from "@/lib/marketing-charlie-types";
export const runtime = "nodejs";
export const maxDuration = 60;
const cache = new Map<string, { at: number; report: Promise<CharlieReport> }>();
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams),
    period = periodFromParams(req.nextUrl.searchParams);
  if (store?.code !== "mireva-cr")
    return NextResponse.json(
      { error: "store=mireva-cr requerido y autorizado." },
      { status: 400 },
    );
  if (!period)
    return NextResponse.json(
      { error: "Rango válido de hasta 93 días requerido." },
      { status: 400 },
    );
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        process.env.META_CR_ACCESS_TOKEN,
        process.env.META_CR_AD_ACCOUNT_IDS,
        process.env.META_CR_AD_ACCOUNT_ID,
        process.env.META_CR_GRAPH_VERSION,
        period.from,
        period.to,
      ]),
    )
    .digest("hex");
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at > 45_000) {
    if (cache.size >= 20) cache.clear();
    entry = { at: Date.now(), report: getCharlieReport(period) };
    cache.set(key, entry);
  }
  const result = await entry.report;
  if (result.status !== "ready") cache.delete(key);
  const body = JSON.stringify(result);
  if (Buffer.byteLength(body, "utf8") > 3_500_000)
    return NextResponse.json(
      { error: "El reporte es muy grande. Selecciona un rango menor." },
      { status: 503 },
    );
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
    },
  });
}
