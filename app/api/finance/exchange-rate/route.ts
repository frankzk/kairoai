import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Tipo de cambio a colones desde open.er-api.com (gratuito, sin llave, datos
// diarios). Se cachea en memoria 6 horas para no depender del proveedor en
// cada apertura del formulario.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SUPPORTED = new Set(["USD", "PEN"]);

const cache = new Map<string, { rate: number; updated: string; fetchedAt: number }>();

export async function GET(req: NextRequest) {
  const from = String(req.nextUrl.searchParams.get("from") || "USD").toUpperCase();
  if (!SUPPORTED.has(from)) {
    return NextResponse.json({ error: `Moneda no soportada: ${from}` }, { status: 400 });
  }

  const cached = cache.get(from);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ from, to: "CRC", rate: cached.rate, updated: cached.updated, cached: true });
  }

  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Proveedor de tipo de cambio respondio ${res.status}`);
    const json = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    const rate = Number(json.rates?.CRC ?? 0);
    if (json.result !== "success" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("Respuesta invalida del proveedor de tipo de cambio");
    }

    const updated = String(json.time_last_update_utc ?? new Date().toUTCString());
    cache.set(from, { rate, updated, fetchedAt: Date.now() });
    return NextResponse.json({ from, to: "CRC", rate, updated, cached: false });
  } catch (err) {
    // Si el proveedor falla pero hay un valor viejo en cache, mejor eso que nada.
    if (cached) {
      return NextResponse.json({ from, to: "CRC", rate: cached.rate, updated: cached.updated, cached: true, stale: true });
    }
    const message = err instanceof Error ? err.message : "Error obteniendo tipo de cambio";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
