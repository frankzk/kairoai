import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Tipo de cambio a la moneda contable de la tienda desde open.er-api.com
// (gratuito, sin llave, datos diarios). Se cachea en memoria 6 horas para no
// depender del proveedor en cada apertura del formulario.
//
// `from` es la moneda en la que se pago (USD/PEN). `to` es la moneda contable
// de la tienda: CRC para Costa Rica, HNL para Honduras. Si no se envia `to`,
// se asume CRC para conservar el comportamiento historico.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SUPPORTED_FROM = new Set(["USD", "PEN"]);
const SUPPORTED_TO = new Set(["CRC", "HNL"]);

const cache = new Map<string, { rate: number; updated: string; fetchedAt: number }>();

export async function GET(req: NextRequest) {
  const from = String(req.nextUrl.searchParams.get("from") || "USD").toUpperCase();
  const to = String(req.nextUrl.searchParams.get("to") || "CRC").toUpperCase();
  if (!SUPPORTED_FROM.has(from)) {
    return NextResponse.json({ error: `Moneda de origen no soportada: ${from}` }, { status: 400 });
  }
  if (!SUPPORTED_TO.has(to)) {
    return NextResponse.json({ error: `Moneda contable no soportada: ${to}` }, { status: 400 });
  }

  const cacheKey = `${from}->${to}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ from, to, rate: cached.rate, updated: cached.updated, cached: true });
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
    const rate = Number(json.rates?.[to] ?? 0);
    if (json.result !== "success" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("Respuesta invalida del proveedor de tipo de cambio");
    }

    const updated = String(json.time_last_update_utc ?? new Date().toUTCString());
    cache.set(cacheKey, { rate, updated, fetchedAt: Date.now() });
    return NextResponse.json({ from, to, rate, updated, cached: false });
  } catch (err) {
    // Si el proveedor falla pero hay un valor viejo en cache, mejor eso que nada.
    if (cached) {
      return NextResponse.json({ from, to, rate: cached.rate, updated: cached.updated, cached: true, stale: true });
    }
    const message = err instanceof Error ? err.message : "Error obteniendo tipo de cambio";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
