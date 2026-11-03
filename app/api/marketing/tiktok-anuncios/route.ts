import { NextRequest, NextResponse } from "next/server";
import { FINANCE_STORES } from "@/lib/store-config";
import {
  guardarFilasAnuncios,
  leerFilaAnuncio,
  MAX_FILAS_ANUNCIOS,
  secretoValido,
  type FilaAnuncio,
} from "@/lib/tiktok-anuncios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST: TikTok Ads por anuncio y por dia que manda Make (lib/tiktok-anuncios.ts),
// para la Matriz 4Pi. Misma clave que /api/marketing/tiktok-diario
// (KAIRO_MAKE_SECRET en x-kairo-secret). Cuerpo: { store, rows: [...] }.
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
  // Un dia sin anuncios activos llega vacio: no es un error.
  if (!crudas.length) return NextResponse.json({ ok: true, guardadas: 0 });
  if (crudas.length > MAX_FILAS_ANUNCIOS) {
    return NextResponse.json({ error: `hasta ${MAX_FILAS_ANUNCIOS} filas por envio` }, { status: 400 });
  }

  const filas: FilaAnuncio[] = [];
  const rechazadas: Array<{ indice: number; motivo: string }> = [];
  crudas.forEach((cruda, indice) => {
    const r = leerFilaAnuncio(cruda, store.id);
    if (r.ok) filas.push(r.fila);
    else rechazadas.push({ indice, motivo: r.motivo });
  });
  if (rechazadas.length) {
    return NextResponse.json({ error: "filas invalidas", rechazadas: rechazadas.slice(0, 20) }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, guardadas: await guardarFilasAnuncios(filas) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
