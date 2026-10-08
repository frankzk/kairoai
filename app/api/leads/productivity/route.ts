import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getProductivity } from "@/lib/leads";
import { crDateRange, crRange, MAX_CUSTOM_RANGE_DAYS, parseRange, RANGE_LABELS } from "@/lib/leads-metrics";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: resumen de productividad por asesora (gestiones + pedidos) en un rango.
// Ventana predefinida con ?range=hoy|ayer|7d|30d|mes, o rango a mano con
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (dias locales, inclusivos). Si vienen fechas,
// mandan sobre `range`.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(sp);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }

  const fromDate = sp.get("from");
  const toDate = sp.get("to");
  const custom = Boolean(fromDate || toDate);
  const range = parseRange(sp.get("range"));

  let bounds: { fromIso: string; toIso: string };
  if (custom) {
    const r = crDateRange(fromDate, toDate);
    if (!r) {
      return NextResponse.json(
        {
          rows: [],
          totals: null,
          error: `Rango invalido: revisa las fechas (Desde no puede ser posterior a Hasta, maximo ${MAX_CUSTOM_RANGE_DAYS} dias).`,
        },
        { status: 400 }
      );
    }
    bounds = r;
  } else {
    bounds = crRange(range, new Date());
  }

  try {
    const { fromIso, toIso } = bounds;
    const rows = await getProductivity(store.id, fromIso, toIso);
    const totals = rows.reduce(
      (acc, r) => ({
        gestiones: acc.gestiones + r.gestiones,
        leads: acc.leads + r.leads,
        pedidos: acc.pedidos + r.pedidos,
      }),
      { gestiones: 0, leads: 0, pedidos: 0 }
    );
    return NextResponse.json({
      range: custom ? "custom" : range,
      range_label: custom ? `${fromDate || toDate} a ${toDate || fromDate}` : RANGE_LABELS[range],
      from: fromIso,
      to: toIso,
      rows,
      totals,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer productividad";
    return NextResponse.json({ rows: [], totals: null, error: message }, { status: 500 });
  }
}
