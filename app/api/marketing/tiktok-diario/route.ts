import { NextRequest, NextResponse } from "next/server";
import { FINANCE_STORES } from "@/lib/store-config";
import { guardarFilasTiktok, leerFilaTiktok, MAX_FILAS_POR_ENVIO, secretoValido, type FilaTiktok } from "@/lib/tiktok-diario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST: el gasto diario de TikTok Ads que manda Make (lib/tiktok-diario.ts).
// Publico, pero solo con la clave KAIRO_MAKE_SECRET en la cabecera
// x-kairo-secret. Sin clave configurada no se acepta nada.
//
// Cuerpo: una fila { store, advertiser_id, advertiser_name, campaign_id,
// campaign_name, date, spend, clicks, impressions?, conversions?, currency,
// timezone? } o { store, rows: [ ...esas filas ] }.
export async function POST(req: NextRequest) {
  const esperado = process.env.KAIRO_MAKE_SECRET?.trim();
  if (!esperado) {
    return NextResponse.json({ error: "KAIRO_MAKE_SECRET no configurada" }, { status: 503 });
  }
  if (!secretoValido(req.headers.get("x-kairo-secret"), esperado)) {
    return NextResponse.json({ error: "clave invalida" }, { status: 401 });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "cuerpo invalido: se espera JSON" }, { status: 400 });
  }
  // Solo una tienda exacta: nunca caer en la tienda por defecto.
  const storeCode = String(cuerpo?.store ?? "").trim();
  const store = FINANCE_STORES.find((s) => s.code === storeCode);
  if (!store) {
    return NextResponse.json({ error: "store invalido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const crudas = Array.isArray(cuerpo.rows) ? (cuerpo.rows as unknown[]) : [cuerpo];
  if (!crudas.length || crudas.length > MAX_FILAS_POR_ENVIO) {
    return NextResponse.json({ error: `entre 1 y ${MAX_FILAS_POR_ENVIO} filas por envio` }, { status: 400 });
  }

  const filas: FilaTiktok[] = [];
  const rechazadas: Array<{ indice: number; motivo: string }> = [];
  crudas.forEach((cruda, indice) => {
    const r = leerFilaTiktok(cruda, store.id);
    if (r.ok) filas.push(r.fila);
    else rechazadas.push({ indice, motivo: r.motivo });
  });
  // Una fila mala no se guarda a medias: Make ve el 400 y el error en su historial.
  if (rechazadas.length) {
    return NextResponse.json({ error: "filas invalidas", rechazadas: rechazadas.slice(0, 20) }, { status: 400 });
  }

  try {
    const guardadas = await guardarFilasTiktok(filas);
    return NextResponse.json({ ok: true, guardadas });
  } catch (err) {
    // 500: Make lo marca como error y se puede reintentar.
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
