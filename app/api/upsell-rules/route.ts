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
  const rules = await getUpsellRules(false); // include inactive
  return NextResponse.json({ rules });
}

// POST /api/upsell-rules — create rule
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { trigger_sku, upsell_sku, upsell_name, upsell_price, pitch, tier } = body;

  if (!trigger_sku || !upsell_sku || !upsell_name || !upsell_price || !pitch) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

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
