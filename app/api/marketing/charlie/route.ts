import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { marketingStoreFromParams } from "@/lib/marketing-access";
import { metaConfigFor } from "@/lib/marketing-meta-config";
import { marketingStoreInfo } from "@/lib/marketing-stores";
import { periodFromParams } from "@/lib/marketing-dates";
import { getCharlieReport } from "@/lib/marketing-charlie-source";
import { leerCuentasCharlieTiktok } from "@/lib/tiktok-anuncios";
import type { CharlieReport } from "@/lib/marketing-charlie-types";
export const runtime = "nodejs";
export const maxDuration = 60;
const cache = new Map<string, { at: number; report: Promise<CharlieReport> }>();
export async function GET(req: NextRequest) {
  const store = marketingStoreFromParams(req.nextUrl.searchParams),
    period = periodFromParams(req.nextUrl.searchParams);
  if (!store)
    return NextResponse.json(
      { error: "store=mireva-cr o mireva-hn requerido y autorizado." },
      { status: 400 },
    );
  if (!period)
    return NextResponse.json(
      { error: "Rango válido de hasta 93 días requerido." },
      { status: 400 },
    );
  const includeStructure = req.nextUrl.searchParams.get("scope") !== "ads";
  // The store's own Meta configuration (hashed, never kept in clear).
  const meta = metaConfigFor(store.code, process.env);
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        store.code,
        meta.token,
        meta.accountList,
        meta.version,
        period.from,
        period.to,
        includeStructure,
        store.id,
      ]),
    )
    .digest("hex");
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.at > 45_000) {
    if (cache.size >= 20) cache.clear();
    entry = {
      at: Date.now(),
      // Mas las cuentas de TikTok por anuncio que manda Make (lib/tiktok-anuncios.ts).
      report: getCharlieReport(
        period,
        process.env,
        fetch,
        new Date(),
        // TikTok only where the store has it (Costa Rica).
        marketingStoreInfo(store.code).tiktok
          ? (from, to) => leerCuentasCharlieTiktok(store.id, from, to)
          : undefined,
        includeStructure,
        false,
        includeStructure,
        store.code,
      ),
    };
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
