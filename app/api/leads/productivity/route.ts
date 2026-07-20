import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getProductivity } from "@/lib/leads";
import { crRange, parseRange, RANGE_LABELS } from "@/lib/leads-metrics";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: resumen de productividad por asesora (gestiones + pedidos) en un rango.
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const range = parseRange(req.nextUrl.searchParams.get("range"));
  try {
    const { fromIso, toIso } = crRange(range, new Date());
    const rows = await getProductivity(store.id, fromIso, toIso);
    const totals = rows.reduce(
      (acc, r) => ({
        gestiones: acc.gestiones + r.gestiones,
        leads: acc.leads + r.leads,
        pedidos: acc.pedidos + r.pedidos,
      }),
      { gestiones: 0, leads: 0, pedidos: 0 }
    );
    return NextResponse.json({ range, range_label: RANGE_LABELS[range], from: fromIso, to: toIso, rows, totals });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer productividad";
    return NextResponse.json({ rows: [], totals: null, error: message }, { status: 500 });
  }
}
