import { NextRequest, NextResponse } from "next/server";
import {
  listIcomflyOrders,
  listIcomflyAgents,
  listPayrollStaff,
} from "@/lib/finance";
import { getStoreFromBody, getStoreFromSearchParams } from "@/lib/stores";
import { runIcomflySync, summarizeRows } from "@/lib/icomfly-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET: lee lo persistido + un resumen para el tablero/atribucion/productividad.
export async function GET(req: NextRequest) {
  try {
    const store = getStoreFromSearchParams(req.nextUrl.searchParams);
    const [orders, agents, staff] = await Promise.all([
      listIcomflyOrders({ storeId: store.id }),
      listIcomflyAgents(store.id),
      listPayrollStaff(),
    ]);
    return NextResponse.json({ orders, agents, staff, summary: summarizeRows(orders) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer datos de iComfly";
    return NextResponse.json(
      { orders: [], agents: [], staff: [], summary: null, error: message },
      { status: 500 }
    );
  }
}

// POST: dispara la sincronizacion manual desde el dashboard.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const store = getStoreFromBody(body);
    const result = await runIcomflySync({
      store: store.code,
      maxPages: body.max_pages != null ? Number(body.max_pages) : undefined,
      startPage: body.page != null ? Number(body.page) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando iComfly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
