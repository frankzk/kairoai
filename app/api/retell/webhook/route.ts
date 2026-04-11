import { NextRequest, NextResponse } from "next/server";
import {
  addOrderTag,
  addOrderNote,
} from "@/lib/shopify";
import {
  updateCallRecord,
  incrementStat,
  getCallById,
  getCallAttemptCount,
  getAgentSettings,
  scheduleRetry,
  deleteDedup,
} from "@/lib/db";

export const runtime = "nodejs";

interface RetellWebhookPayload {
  event: string;
  call: {
    call_id: string;
    call_status: "registered" | "ongoing" | "ended" | "error";
    start_timestamp?: number;
    end_timestamp?: number;
    duration_ms?: number;
    metadata?: Record<string, unknown>;
    retell_llm_dynamic_variables?: Record<string, unknown>;
    call_analysis?: {
      call_successful?: boolean;
      call_summary?: string;
      user_sentiment?: "Positive" | "Negative" | "Neutral" | "Unknown";
      agent_sentiment?: string;
      custom_analysis_data?: Record<string, unknown>;
    };
    recording_url?: string;
    transcript?: string;
    transcript_object?: Array<{ role: string; content: string }>;
    disconnection_reason?: string;
  };
}

type CallOutcome =
  | "confirmed"
  | "cancelled"
  | "no_answer"
  | "upsell_accepted"
  | "error";

export async function POST(req: NextRequest) {
  let payload: RetellWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, call } = payload;

  if (event !== "call_ended" && event !== "call_analyzed") {
    // Acknowledge other events
    return NextResponse.json({ received: true });
  }

  const callId = call.call_id;
  const metadata = call.metadata ?? call.retell_llm_dynamic_variables ?? {};
  const orderId = String(metadata.order_id ?? "");
  const analysis = call.call_analysis ?? {};

  // ── Determine outcome ─────────────────────────────────────────────────────
  const outcome = determineOutcome(call);
  const durationSeconds = Math.round((call.duration_ms ?? 0) / 1000);
  const summary = analysis.call_summary ?? "";

  console.info(
    `[retell/webhook] Call ${callId} ended. Outcome: ${outcome}. Order: ${orderId}`
  );

  // ── Update call record ────────────────────────────────────────────────────
  await updateCallRecord(callId, {
    status: outcome,
    upsell_accepted: outcome === "upsell_accepted",
    duration_seconds: durationSeconds,
    ended_at: new Date().toISOString(),
    notes: summary,
    ...(call.recording_url ? { recording_url: call.recording_url } : {}),
  });

  // ── Increment stats ───────────────────────────────────────────────────────
  await incrementStat("total");
  if (outcome === "confirmed" || outcome === "upsell_accepted") {
    await incrementStat("confirmed");
  }
  if (outcome === "upsell_accepted") {
    await incrementStat("upsells");
  }
  if (outcome === "cancelled") {
    await incrementStat("cancelled");
  }
  if (outcome === "no_answer") {
    await incrementStat("no_answer");
  }

  // ── Auto-schedule retry for no_answer (Single Prompt agents can't call
  //    schedule_retry themselves, so the webhook does it automatically) ──────
  if (outcome === "no_answer" && orderId &&
      !orderId.startsWith("checkout-") && !orderId.startsWith("draft-")) {
    autoScheduleRetry(callId, orderId).catch((err) =>
      console.error("[retell/webhook] autoScheduleRetry error:", err)
    );
  }

  // ── Update Shopify (best-effort, don't block response) ───────────────────
  if (orderId && !orderId.startsWith("checkout-")) {
    updateShopify(orderId, outcome, summary, durationSeconds).catch((err) =>
      console.error("[retell/webhook] Shopify update error:", err)
    );
  }

  return NextResponse.json({ received: true, outcome });
}

// ─── Auto-retry ───────────────────────────────────────────────────────────

async function autoScheduleRetry(callId: string, orderId: string): Promise<void> {
  const [callRec, settings, attemptsDone] = await Promise.all([
    getCallById(callId),
    getAgentSettings(),
    getCallAttemptCount(orderId),
  ]);

  if (!callRec) return;

  if (attemptsDone >= settings.max_retries) {
    console.info(`[retell/webhook] Max retries (${settings.max_retries}) reached for ${orderId}`);
    return;
  }

  const delays: number[] = settings.retry_delays?.length
    ? settings.retry_delays
    : [settings.retry_delay_minutes ?? 30];
  // attemptsDone is total calls made; use as 0-based index into delays array
  const delayMin = delays[Math.min(attemptsDone - 1, delays.length - 1)] ?? 30;
  const retryAt = Date.now() + delayMin * 60 * 1000;

  await deleteDedup(callRec.phone, orderId);
  await scheduleRetry(callRec.phone, orderId, retryAt);

  console.info(
    `[retell/webhook] Retry #${attemptsDone + 1} scheduled for order ${orderId} in ${delayMin} min`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function determineOutcome(call: RetellWebhookPayload["call"]): CallOutcome {
  const disconnectReason = call.disconnection_reason ?? "";
  const summary = (call.call_analysis?.call_summary ?? "").toLowerCase();
  const customData = call.call_analysis?.custom_analysis_data ?? {};

  // Check for explicit outcome from custom analysis
  if (customData.outcome) {
    const raw = String(customData.outcome).toLowerCase();
    if (raw.includes("confirm")) return "confirmed";
    if (raw.includes("cancel")) return "cancelled";
    if (raw.includes("upsell")) return "upsell_accepted";
    if (raw.includes("no_answer") || raw.includes("no answer"))
      return "no_answer";
  }

  // Infer from call status / disconnection
  if (
    call.call_status === "error" ||
    disconnectReason === "machine_detected" ||
    disconnectReason === "voicemail_reached"
  ) {
    return "no_answer";
  }

  if (
    !call.duration_ms ||
    call.duration_ms < 5000 ||
    disconnectReason === "no_answer"
  ) {
    return "no_answer";
  }

  // Infer from summary text
  if (
    summary.includes("confirmó") ||
    summary.includes("confirmo") ||
    summary.includes("confirmed")
  ) {
    return "confirmed";
  }
  if (
    summary.includes("canceló") ||
    summary.includes("cancelo") ||
    summary.includes("cancelled")
  ) {
    return "cancelled";
  }
  if (summary.includes("upsell") && summary.includes("aceptó")) {
    return "upsell_accepted";
  }

  // Default for short/unclear calls
  return "no_answer";
}

async function updateShopify(
  orderId: string,
  outcome: CallOutcome,
  summary: string,
  durationSeconds: number
): Promise<void> {
  const tag =
    outcome === "confirmed" || outcome === "upsell_accepted"
      ? "kairo-confirmado"
      : outcome === "cancelled"
      ? "kairo-cancelado"
      : outcome === "no_answer"
      ? "kairo-no-contesta"
      : "kairo-procesado";

  await addOrderTag(orderId, tag);

  if (summary) {
    const note = `[Kairo AI] Llamada (${durationSeconds}s): ${summary}`;
    await addOrderNote(orderId, note);
  }
}
