import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getProductivity } from "@/lib/leads";
import { identidadActual } from "@/lib/identidad";
import { veProductividadDelEquipo } from "@/lib/permisos";
import { readPresence } from "@/lib/leads-presence-server";
import { connectedProductivityRows } from "@/lib/leads-productivity-presence";
import { crDateRange, crRange, MAX_CUSTOM_RANGE_DAYS, parseRange, RANGE_LABELS } from "@/lib/leads-metrics";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: resumen de productividad por asesora (gestiones + pedidos) en un rango.
// Ventana predefinida con ?range=hoy|ayer|7d|30d|mes, o rango a mano con
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (dias locales, inclusivos). Si vienen fechas,
// mandan sobre `range`.
export async function GET(req: NextRequest) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const [todas, presence] = await Promise.all([
      getProductivity(store.id, fromIso, toIso),
      readPresence(yo, store.id, store.code, Date.now(), bounds),
    ]);
    // Una asesora sin supervision ni "ver productividad del equipo" ve solo su
    // propia fila (y los totales salen de esa fila). Las otras ven a todo el
    // equipo.
    const soloPropia = !veProductividadDelEquipo(yo.permisos) && !yo.permisos.includes("usuarios");
    const rows = connectedProductivityRows(presence, soloPropia ? todas.filter((r) => r.vendedora_id === yo.staffId) : todas);
    const totals = rows.reduce(
      (acc, r) => ({
        gestiones: acc.gestiones + (r.gestiones ?? 0),
        leads: acc.leads + (r.leads ?? 0),
        pedidos: acc.pedidos + (r.pedidos ?? 0),
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
      solo_propia: soloPropia,
      server_time: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer productividad";
    return NextResponse.json({ rows: [], totals: null, error: message }, { status: 500 });
  }
}
