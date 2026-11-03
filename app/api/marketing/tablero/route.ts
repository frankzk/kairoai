// Origen de los pedidos e inventario de iComfly para el Tablero de Marketing.
// Cada parte falla por separado: sin una, la otra se muestra igual.
import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { MARKETING_STORE } from "@/lib/marketing";
import { periodFromParams } from "@/lib/marketing-dates";
import { inventarioIcomfly, origenesDelPeriodo } from "@/lib/marketing-origen";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  const period = periodFromParams(req.nextUrl.searchParams);
  const respond = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!store || store.code !== MARKETING_STORE || !period)
    return respond({ error: "Tienda de Costa Rica y período válido requeridos." }, 400);
  const [origen, inventario] = await Promise.allSettled([
    origenesDelPeriodo(store.id, new Date(period.start).toISOString(), new Date(period.end).toISOString()),
    inventarioIcomfly(),
  ]);
  if (origen.status === "rejected") console.error("[marketing/tablero] origen", origen.reason);
  if (inventario.status === "rejected") console.error("[marketing/tablero] inventario", inventario.reason);
  return respond({
    origen: origen.status === "fulfilled" ? origen.value : null,
    inventario: inventario.status === "fulfilled" ? inventario.value : null,
  });
}
