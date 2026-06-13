import { NextRequest, NextResponse } from "next/server";
import {
  deleteProductCost,
  listProductCosts,
  listProductCostVersions,
  upsertProductCost,
} from "@/lib/finance";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  try {
    const costs = await listProductCosts(store.id);
    let versions: unknown[] = [];
    try {
      versions = await listProductCostVersions(undefined, store.id);
    } catch {
      versions = [];
    }
    return NextResponse.json({ costs, versions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer costos";
    return NextResponse.json({ costs: [], error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) return missingStoreResponse();
  if (!body?.sku) {
    return NextResponse.json({ error: "SKU requerido" }, { status: 400 });
  }

  try {
    const cost = await upsertProductCost(body, store.id);
    return NextResponse.json({ cost });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al guardar costo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStoreResponse();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteProductCost(id, store.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al eliminar costo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function missingStoreResponse() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}
