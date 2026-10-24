import { NextRequest, NextResponse } from "next/server";
import {
  listIcomflyOrders,
  listIcomflyAgents,
  listPayrollStaff,
} from "@/lib/finance";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import { runIcomflySync, summarizeRows } from "@/lib/icomfly-sync";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET: lee lo persistido + un resumen para el tablero/atribucion/productividad.
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
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

// POST: dispara la sincronizacion manual desde el dashboard. Con
// refrescar: true (boton "Sync iComfly" de Gestion) rearma tambien la tabla de
// pedidos de esa tienda, para ver lo nuevo sin esperar al cron.
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
    const payload = body as Record<string, unknown>;
    const result = await runIcomflySync({
      store: store.code,
      maxPages: payload.max_pages != null ? Number(payload.max_pages) : undefined,
      startPage: payload.page != null ? Number(payload.page) : undefined,
    });
    if (payload.refrescar !== true) return NextResponse.json(result);
    const tabla = await refreshFinanceDatasetCache(store)
      .then((filas) => ({ ok: true, filas }))
      .catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return NextResponse.json({ ...result, tabla });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando iComfly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
