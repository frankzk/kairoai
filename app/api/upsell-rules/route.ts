import { NextRequest, NextResponse } from "next/server";
import {
  getUpsellRules,
  createUpsellRule,
  updateUpsellRule,
  deleteUpsellRule,
  type UpsellRuleDB,
} from "@/lib/db";

export const runtime = "nodejs";

// GET /api/upsell-rules — list all rules
export async function GET() {
  try {
    const rules = await getUpsellRules(false); // include inactive
    return NextResponse.json({ rules });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al leer reglas";
    console.error("[upsell-rules GET]", msg);
    return NextResponse.json({ rules: [], error: msg });
  }
}

// POST /api/upsell-rules — create rule
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { trigger_sku, upsell_sku, upsell_name, upsell_price, pitch, tier } = body as Record<string, string>;

  if (!trigger_sku || !upsell_sku || !upsell_name || !upsell_price || !pitch) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  try {
    const rule = await createUpsellRule({
      trigger_sku: trigger_sku.trim().toLowerCase(),
      upsell_sku: upsell_sku.trim().toLowerCase(),
      upsell_name: upsell_name.trim(),
      upsell_price: Number(upsell_price),
      pitch: pitch.trim(),
      tier: (tier ?? "B") as UpsellRuleDB["tier"],
      active: true,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al guardar en base de datos";
    console.error("[upsell-rules POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/upsell-rules — update rule
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  if (updates.trigger_sku) updates.trigger_sku = updates.trigger_sku.trim().toLowerCase();
  if (updates.upsell_sku) updates.upsell_sku = updates.upsell_sku.trim().toLowerCase();
  if (updates.upsell_price) updates.upsell_price = Number(updates.upsell_price);

  await updateUpsellRule(Number(id), updates);
  return NextResponse.json({ ok: true });
}

// DELETE /api/upsell-rules?id=123 — delete rule
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  await deleteUpsellRule(Number(id));
  return NextResponse.json({ ok: true });
}
