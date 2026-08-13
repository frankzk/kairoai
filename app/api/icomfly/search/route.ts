import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { MIN_QUERY_LENGTH } from "@/lib/dispatch-search";
import { searchDispatchOrders } from "@/lib/dispatch-search-db";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: busca pedidos de despacho por guia, celular o numero de pedido.
// Consulta la BD completa, no solo los pedidos visibles en el tablero.
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));

  try {
    const result = await searchDispatchOrders({
      storeId: store.id,
      storeCode: store.code,
      query,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
    });
    if (!result) {
      return NextResponse.json({
        hits: [],
        query,
        error: `Escribi al menos ${MIN_QUERY_LENGTH} caracteres para buscar.`,
      });
    }
    return NextResponse.json({ hits: result.hits, query, terms: result.terms });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al buscar el pedido";
    return NextResponse.json({ hits: [], query, error: message }, { status: 500 });
  }
}
