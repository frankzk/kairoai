import { NextRequest, NextResponse } from "next/server";
import {
  deleteProductCost,
  listProductCosts,
  listProductCostVersions,
  upsertProductCost,
} from "@/lib/finance";

export const runtime = "nodejs";

export async function GET() {
  try {
    const costs = await listProductCosts();
    let versions: unknown[] = [];
    try {
      versions = await listProductCostVersions();
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
  if (!body?.sku) {
    return NextResponse.json({ error: "SKU requerido" }, { status: 400 });
  }

  try {
    const cost = await upsertProductCost(body);
    return NextResponse.json({ cost });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al guardar costo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  try {
    await deleteProductCost(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al eliminar costo";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
