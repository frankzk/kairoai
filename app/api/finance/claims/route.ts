import { NextRequest, NextResponse } from "next/server";
import { listFinanceClaims, upsertFinanceClaim } from "@/lib/finance";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  try {
    const claims = await listFinanceClaims(store.id);
    return NextResponse.json({ claims });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer reclamos";
    return NextResponse.json({ claims: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) return missingStoreResponse();
  if (!body?.anomaly_key) {
    return NextResponse.json({ error: "anomaly_key requerido" }, { status: 400 });
  }

  try {
    const claim = await upsertFinanceClaim(body, store.id);
    return NextResponse.json({ claim });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al guardar reclamo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function missingStoreResponse() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}
