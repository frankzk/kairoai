import { NextRequest, NextResponse } from "next/server";
import { validateRetellSignature } from "@/lib/retell";
import {
  addOrderTag,
  addOrderNote,
} from "@/lib/shopify";
import {
  updateCallRecord,
  incrementStat,
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
  const rawBody = await req.text();
  const signature = req.headers.get("x-retell-signature") ?? "";

  // Validate signature
  if (signature && !validateRetellSignature(rawBody, signature)) {
    console.warn("[retell/webhook] Invalid signature");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: RetellWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
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

  // ── Update Redis record ───────────────────────────────────────────────────
  await updateCallRecord(callId, {
    status: outcome,
    upsell_accepted: outcome === "upsell_accepted",
    duration_seconds: durationSeconds,
    ended_at: new Date().toISOString(),
    notes: summary,
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

  // ── Update Shopify (best-effort, don't block response) ───────────────────
  if (orderId && !orderId.startsWith("checkout-")) {
    updateShopify(orderId, outcome, summary, durationSeconds).catch((err) =>
      console.error("[retell/webhook] Shopify update error:", err)
    );
  }

  return NextResponse.json({ received: true, outcome });
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
