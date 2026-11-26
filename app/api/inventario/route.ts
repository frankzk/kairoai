// Inventario de ShipHero (Boxful) para el equipo (Mejoras Kairo N.º 1).
// GET: la foto más reciente (el cron la renueva cada 15 min).
// POST: "Actualizar ahora": lee ShipHero en el momento, con la misma espera de
// 10 min que Marketing (los créditos de la API se comparten con Boxful).
// El permiso lo pone lib/permisos.ts (/api/inventario) y la tienda la valida
// el middleware (?store= debe ser una de las de la persona).
import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "@/lib/identidad";
import { leerInventario } from "@/lib/inventario-db";
import { marketingCatalogLoader } from "@/lib/marketing-catalog-loader";
import { TIENDA_INVENTARIO } from "@/lib/navegacion";
import {
  SHIPHERO_SYNC_BUDGET_MS,
  ShipHeroStorageError,
  readConnectionRow,
  syncCooldownLeftMs,
  syncShipHeroInventory,
} from "@/lib/shiphero-connection";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

function tiendaDe(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return { error: reply({ error: "store requerido: usa mireva-cr" }, 400) };
  if (store.code !== TIENDA_INVENTARIO)
    return { error: reply({ error: "El inventario de ShipHero (Boxful) es solo de Mireva Costa Rica." }, 404) };
  return { store };
}

export async function GET(req: NextRequest) {
  const { store, error } = tiendaDe(req);
  if (!store) return error;
  try {
    return reply(await leerInventario(store.id));
  } catch (e) {
    console.error("[inventario] lectura", e instanceof Error ? e.message : e);
    return reply({ error: e instanceof ShipHeroStorageError ? e.message : "No se pudo leer el inventario." }, 503);
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const { store, error } = tiendaDe(req);
  if (!store) return error;
  try {
    const waitMs = syncCooldownLeftMs(await readConnectionRow(store.id), start);
    if (waitMs > 0) {
      const minutos = Math.max(1, Math.ceil(waitMs / 60_000));
      return reply({ error: `Se leyó de ShipHero hace poco. Prueba en ${minutos} min.`, retryInMinutes: minutos }, 429);
    }
  } catch (e) {
    return reply({ error: e instanceof ShipHeroStorageError ? e.message : "No se pudo leer la conexión con ShipHero." }, 503);
  }
  const yo = identidadActual();
  const result = await syncShipHeroInventory(store.id, {
    by: yo ? `${yo.id}:${yo.nombre}`.slice(0, 200) : "inventario",
    deadline: start + SHIPHERO_SYNC_BUDGET_MS,
    catalog: marketingCatalogLoader(store),
  });
  if (!result.ok) return reply({ error: result.error ?? "No se pudo leer ShipHero." }, 502);
  if (result.skipped === "ocupado") return reply({ error: "ShipHero se está leyendo en este momento. Prueba en un minuto." }, 409);
  return reply(await leerInventario(store.id));
}
