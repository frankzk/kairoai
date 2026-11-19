import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { ubicacionDePedido } from "@/lib/wyn-rutas-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Provincia, cantón, distrito y dirección de un pedido, para cruzarlos con las
// rutas de WYN (components/EntregaWyn.tsx). La tienda la valida el middleware.
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  const order = (req.nextUrl.searchParams.get("order") ?? "").trim();
  if (!store || !order) return NextResponse.json({ error: "store y order requeridos" }, { status: 400 });
  try {
    return NextResponse.json({ ubicacion: await ubicacionDePedido(store.id, order) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo leer la dirección." }, { status: 500 });
  }
}
