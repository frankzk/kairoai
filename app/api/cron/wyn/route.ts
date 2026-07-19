import { NextRequest, NextResponse } from "next/server";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";
import { listWynSyncCandidates, upsertWynTracking } from "@/lib/finance";
import type { WynTrackingRow } from "@/lib/finance-types";
import { getStoreConfig } from "@/lib/stores";
import { fetchWynTracking, type WynTrackingResult } from "@/lib/wyn";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STORE_ID = 1;
const STORE_CODE = "mireva-cr";
const MAX_GUIDES_PER_RUN = 60;
const FRESH_WINDOW_MINUTES = 180;
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 350;

type RunSummary = {
  candidates: number;
  checked: number;
  failed: number;
  blocked: boolean;
  delivered: number;
  returned: number;
  notDelivered: number;
  enRoute: number;
  incidents: number;
  pending: number;
  unknown: number;
  errors: Array<{ guide: string; error: string }>;
};

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function toCacheRow(result: WynTrackingResult): Omit<WynTrackingRow, "checked_at" | "store_id"> {
  return {
    guide_number: result.guideNumber,
    tracking_number: result.trackingNumber,
    latest_status: result.latestStatus,
    latest_code: result.latestCode,
    latest_group: result.latestGroup,
    latest_at: result.latestAt,
    has_incident: result.hasIncident,
    incident_reason: result.incidentReason,
    delivery_address: result.deliveryAddress,
    receiver_name: result.receiverName,
    events: result.events,
  };
}

function isProviderBlock(error: string): boolean {
  return /HTTP (401|403|429)|captcha|forbidden|access denied/i.test(error);
}

function increment(summary: RunSummary, group: string): void {
  if (group === "delivered") summary.delivered += 1;
  else if (group === "returned") summary.returned += 1;
  else if (group === "not_delivered" || group === "cancelled") summary.notDelivered += 1;
  else if (group === "en_route") summary.enRoute += 1;
  else if (group === "incident") summary.incidents += 1;
  else if (group === "pending") summary.pending += 1;
  else summary.unknown += 1;
}

async function run(): Promise<RunSummary> {
  const store = getStoreConfig(STORE_CODE);
  if (!store || store.id !== STORE_ID) throw new Error("No se encontro Mireva Costa Rica.");

  const guides = await listWynSyncCandidates(MAX_GUIDES_PER_RUN, FRESH_WINDOW_MINUTES, STORE_ID);
  const summary: RunSummary = {
    candidates: guides.length,
    checked: 0,
    failed: 0,
    blocked: false,
    delivered: 0,
    returned: 0,
    notDelivered: 0,
    enRoute: 0,
    incidents: 0,
    pending: 0,
    unknown: 0,
    errors: [],
  };

  for (let offset = 0; offset < guides.length; offset += BATCH_SIZE) {
    const batch = guides.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((guide) => fetchWynTracking(guide)));
    const successful: WynTrackingResult[] = [];
    const currentErrors: Array<{ guide: string; error: string }> = [];

    results.forEach((result, index) => {
      const guide = batch[index];
      if (result.status === "fulfilled") {
        successful.push(result.value);
        summary.checked += 1;
        increment(summary, result.value.latestGroup);
        return;
      }

      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      summary.failed += 1;
      currentErrors.push({ guide, error });
      if (summary.errors.length < 10) summary.errors.push({ guide, error });
    });

    if (successful.length) await upsertWynTracking(successful.map(toCacheRow), STORE_ID);

    if (
      !successful.length &&
      currentErrors.length === batch.length &&
      currentErrors.every((entry) => isProviderBlock(entry.error))
    ) {
      summary.blocked = true;
      break;
    }

    if (offset + BATCH_SIZE < guides.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  if (summary.checked > 0) {
    await refreshFinanceDatasetCache(store).catch(() => undefined);
  }

  return summary;
}

async function handler(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const summary = await run();
    return NextResponse.json({ ok: !summary.blocked, store: STORE_CODE, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar WYN.";
    return NextResponse.json({ ok: false, store: STORE_CODE, error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handler(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handler(request);
}
