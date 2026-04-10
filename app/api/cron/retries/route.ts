import { NextResponse } from "next/server";
import {
  getDueRetries,
  markRetryProcessed,
  getRecentCallByOrder,
  getCallAttemptCount,
  getAgentSettings,
  saveCallRecord,
} from "@/lib/db";
import { createOutboundCall } from "@/lib/retell";

export const runtime = "nodejs";
export const maxDuration = 25;

export async function GET() {
  return handleCron();
}

export async function POST() {
  return handleCron();
}

async function handleCron() {
  const [retries, settings] = await Promise.all([
    getDueRetries(),
    getAgentSettings(),
  ]);

  if (!retries.length) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  let skipped = 0;

  for (const retry of retries) {
    // Mark processed first to avoid double-firing on slow functions
    await markRetryProcessed(retry.id);

    // Check if we've already hit max_retries for this order
    const attempts = await getCallAttemptCount(retry.order_id);
    if (attempts >= settings.max_retries) {
      console.info(
        `[cron/retries] Order ${retry.order_id}: reached max_retries (${attempts}/${settings.max_retries}) — skipping`
      );
      skipped++;
      continue;
    }

    // Get original call metadata to re-create the call
    const originalCall = await getRecentCallByOrder(retry.order_id);
    if (!originalCall) {
      console.warn(`[cron/retries] No original call found for order ${retry.order_id}`);
      continue;
    }

    try {
      const { call_id } = await createOutboundCall({
        toPhone: retry.phone,
        metadata: {
          order_id: retry.order_id,
          shop_domain: process.env.SHOPIFY_SHOP_DOMAIN ?? "",
          customer_name: originalCall.customer_name,
          products: originalCall.products,
          total: originalCall.total,
          country: originalCall.country,
          event_type: "order_confirmation",
          attempt_number: retry.attempt_number,
        },
      });

      await saveCallRecord({
        call_id,
        order_id: retry.order_id,
        phone: retry.phone,
        customer_name: originalCall.customer_name,
        products: originalCall.products,
        total: originalCall.total,
        country: originalCall.country,
        status: "calling",
        upsell_accepted: false,
        duration_seconds: 0,
        started_at: new Date().toISOString(),
        notes: `Reintento #${retry.attempt_number}`,
      });

      processed++;
      console.info(
        `[cron/retries] Retry #${retry.attempt_number} fired for order ${retry.order_id}, call ${call_id}`
      );
    } catch (err) {
      console.error(`[cron/retries] Failed to fire retry for order ${retry.order_id}:`, err);
    }
  }

  return NextResponse.json({ processed, skipped });
}
