import { NextRequest, NextResponse } from "next/server";
import { upsertProductCost } from "@/lib/finance";
import { getRequiredStoreFromBody } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 60;

interface BulkItem {
  sku?: string;
  product_name?: string;
  unit_cost?: number | string;
  packaging_cost?: number | string;
  effective_from?: string;
}

// Carga masiva de costos por SKU. Upsert por item; reporta cuantos entraron y
// los errores por SKU sin abortar el resto.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  const items: BulkItem[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) {
    return NextResponse.json({ error: "items requerido" }, { status: 400 });
  }

  let saved = 0;
  const errors: Array<{ sku: string; error: string }> = [];

  for (const item of items) {
    const sku = String(item.sku ?? "").trim();
    const unitCost = Number(item.unit_cost ?? 0);
    if (!sku) {
      errors.push({ sku: "", error: "SKU vacio" });
      continue;
    }
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      errors.push({ sku, error: "Costo unitario invalido" });
      continue;
    }
    try {
      await upsertProductCost({
        sku,
        product_name: String(item.product_name ?? ""),
        unit_cost: unitCost,
        packaging_cost: Number(item.packaging_cost ?? 0) || 0,
        effective_from: item.effective_from || undefined,
      }, store.id);
      saved += 1;
    } catch (err) {
      errors.push({ sku, error: err instanceof Error ? err.message : "Error al guardar" });
    }
  }

  return NextResponse.json({ saved, failed: errors.length, errors: errors.slice(0, 100) });
}
