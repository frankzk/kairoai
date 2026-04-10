import { NextRequest, NextResponse } from "next/server";
import { getAgentSettings, updateAgentSettings } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getAgentSettings();
    return NextResponse.json(settings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const updates: Record<string, unknown> = {};

  if (body.max_retries !== undefined) {
    const v = Number(body.max_retries);
    if (v < 1 || v > 5) return NextResponse.json({ error: "max_retries debe ser entre 1 y 5" }, { status: 400 });
    updates.max_retries = v;
  }

  if (body.retry_delay_minutes !== undefined) {
    const v = Number(body.retry_delay_minutes);
    if (v < 1) return NextResponse.json({ error: "retry_delay_minutes debe ser ≥ 1" }, { status: 400 });
    updates.retry_delay_minutes = v;
  }

  if (Array.isArray(body.retry_delays)) {
    const arr = (body.retry_delays as unknown[]).map(Number).filter((n) => n >= 1);
    updates.retry_delays = arr;
  }

  if (body.cart_agent_enabled !== undefined) updates.cart_agent_enabled = Boolean(body.cart_agent_enabled);
  if (body.cart_agent_name !== undefined) updates.cart_agent_name = String(body.cart_agent_name);
  if (body.cart_agent_phone !== undefined) updates.cart_agent_phone = String(body.cart_agent_phone);
  if (body.cart_agent_retell_id !== undefined) updates.cart_agent_retell_id = String(body.cart_agent_retell_id);

  if (Array.isArray(body.cart_agent_retry_delays)) {
    const arr = (body.cart_agent_retry_delays as unknown[]).map(Number).filter((n) => n >= 1);
    updates.cart_agent_retry_delays = arr;
  }

  try {
    await updateAgentSettings(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al guardar";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
