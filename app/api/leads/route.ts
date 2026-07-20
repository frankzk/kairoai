import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import { countByStage, listLeads } from "@/lib/leads";
import { runLeadsSync } from "@/lib/leads-sync";
import { BOARD_VIEWS, statusBoardStage } from "@/lib/leads-classify";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET: tablero de leads de la tienda (agrupado por bucket + conteos).
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    const leads = await listLeads({ storeId: store.id });
    const counts = countByStage(leads);
    const withStage = leads.map((l) => ({ ...l, board_stage: statusBoardStage(l.status) }));
    return NextResponse.json({
      store: store.code,
      views: BOARD_VIEWS,
      counts,
      leads: withStage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer leads";
    return NextResponse.json({ leads: [], counts: null, error: message }, { status: 500 });
  }
}

// POST: dispara la sincronizacion/clasificacion manual desde el tablero.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    const payload = (body ?? {}) as Record<string, unknown>;
    const result = await runLeadsSync({
      store: store.code,
      deep: payload.deep === true || payload.deep === "1",
      maxPages: payload.max_pages != null ? Number(payload.max_pages) : undefined,
      startPage: payload.page != null ? Number(payload.page) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
