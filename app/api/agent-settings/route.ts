import { NextRequest, NextResponse } from "next/server";
import { getAgentSettings, updateAgentSettings } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const settings = await getAgentSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { max_retries, retry_delay_minutes } = body;

  const updates: Record<string, number> = {};
  if (max_retries !== undefined) {
    const v = Number(max_retries);
    if (v < 1 || v > 5) return NextResponse.json({ error: "max_retries debe ser entre 1 y 5" }, { status: 400 });
    updates.max_retries = v;
  }
  if (retry_delay_minutes !== undefined) {
    const v = Number(retry_delay_minutes);
    if (v < 1) return NextResponse.json({ error: "retry_delay_minutes debe ser al menos 1" }, { status: 400 });
    updates.retry_delay_minutes = v;
  }

  await updateAgentSettings(updates);
  return NextResponse.json({ ok: true });
}
