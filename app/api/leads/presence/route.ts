import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "@/lib/identidad";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { parsePresenceSignal } from "@/lib/leads-presence";
import { canSeePresenceTeam, readPresence, recordPresence } from "@/lib/leads-presence-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "Tienda no permitida." }, { status: 400, headers });
  try {
    const now = Date.now();
    const rows = await readPresence(yo, store.id, store.code, now);
    return NextResponse.json({ rows, server_time: new Date(now).toISOString(), team: canSeePresenceTeam(yo) }, { headers });
  } catch {
    return NextResponse.json({ error: "Presencia no disponible. Reintentando…" }, { status: 503, headers });
  }
}

export async function POST(req: NextRequest) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  // Same-origin JSON requests (including pagehide beacons); no cross-site writes.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers });
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "Tienda no permitida." }, { status: 400, headers });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Señal inválida." }, { status: 400, headers }); }
  const signal = parsePresenceSignal(body);
  if (!signal) return NextResponse.json({ error: "Señal inválida." }, { status: 400, headers });
  try {
    // Never accept a user/advisor identity supplied by the browser.
    await recordPresence(yo.id, store.id, signal);
    return new NextResponse(null, { status: 204, headers });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar la presencia." }, { status: 503, headers });
  }
}
