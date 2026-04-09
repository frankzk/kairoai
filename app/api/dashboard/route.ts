import { NextResponse } from "next/server";
import { getRecentCalls, getTodayStats } from "@/lib/db";

export const runtime = "nodejs";
export const revalidate = 0;

export async function GET() {
  const [calls, stats] = await Promise.all([
    getRecentCalls(50),
    getTodayStats(),
  ]);

  const confirmationRate =
    stats.total > 0
      ? Math.round(((stats.confirmed / stats.total) * 100))
      : 0;

  return NextResponse.json({
    stats: { ...stats, confirmation_rate: confirmationRate },
    calls,
    fetched_at: new Date().toISOString(),
  });
}
