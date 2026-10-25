import { NextRequest, NextResponse } from "next/server";
import { syncWooStatuses, wooAccess } from "@/lib/woo-server";
import { timingSafeEqual } from "node:crypto";
import { withCronRun } from "@/lib/cron-runs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const run = withCronRun("woo-status", async () => {
  try {
    const result = await syncWooStatuses(10);
    return NextResponse.json({ ok: result.failed === 0, ...result });
  }
  catch { return NextResponse.json({ error: "No se pudo sincronizar WooCommerce" }, { status: 503 }); }
});
export async function GET(req: NextRequest) {
  const secret = process.env.WOO_KENKU_IT_SYNC_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ""}`), supplied = Buffer.from(req.headers.get("authorization") || "");
  if (!(secret && supplied.length === expected.length && timingSafeEqual(expected,supplied)) && !wooAccess()) return NextResponse.json({error:"Unauthorized"},{status:401});
  return run();
}
