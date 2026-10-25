import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { listAtribucionDespacho } from "@/lib/finance";
import { resumenDespacho } from "@/lib/productividad-despacho";
import { crDateRange, crRange, MAX_CUSTOM_RANGE_DAYS, parseRange, RANGE_LABELS } from "@/lib/leads-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET: quien despacha (genera la guia) y quien confirma, por persona y por dia,
// para la ventana Productividad de Gestion. ?range=hoy|ayer|7d|30d|mes, o
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (dias locales, inclusivos; mandan sobre range).
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
  const bounds = custom ? crDateRange(fromDate, toDate) : crRange(range, new Date());
  if (!bounds) {
    return NextResponse.json(
      { error: `Rango inválido: revisa las fechas (Desde no puede ser posterior a Hasta, máximo ${MAX_CUSTOM_RANGE_DAYS} días).` },
      { status: 400 }
    );
  }
  try {
    const filas = await listAtribucionDespacho(store.id, bounds.fromIso, bounds.toIso);
    return NextResponse.json({
      range: custom ? "custom" : range,
      range_label: custom ? `${fromDate || toDate} a ${toDate || fromDate}` : RANGE_LABELS[range],
      from: bounds.fromIso,
      to: bounds.toIso,
      ...resumenDespacho(filas, bounds.fromIso, bounds.toIso),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error al leer la productividad" }, { status: 500 });
  }
}
