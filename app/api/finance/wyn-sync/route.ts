import { NextRequest, NextResponse } from "next/server";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";
import { upsertWynTracking } from "@/lib/finance";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { fetchWynTracking, isWynGuide, type WynTrackingResult } from "@/lib/wyn";

// Boton "WYN (n)" de Gestion › Pedidos: consulta a WYN (MailAmericas) un tramo
// de guias abiertas, como el de Moovin. WYN bloquea si se le pregunta rapido:
// pocas guias por llamada, 3 s entre cada una (igual que el cron /api/cron/wyn)
// y se corta en cuanto responde 401/403/429 o captcha. El navegador manda los
// tramos uno tras otro y el ultimo (`final`) rearma la tabla de pedidos.

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_GUIDES = 8;
const REQUEST_DELAY_MS = 3_000;

const isProviderBlock = (error: string) => /HTTP (401|403|429)|captcha|forbidden|access denied/i.test(error);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { guides?: unknown; final?: unknown } | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) return NextResponse.json({ error: "store requerido" }, { status: 400 });
  if (store.code !== "mireva-cr")
    return NextResponse.json({ error: "WYN solo está habilitado para Mireva Costa Rica." }, { status: 400 });
  const guides = Array.isArray(body?.guides)
    ? Array.from(new Set(body.guides.map((g) => String(g ?? "").trim()).filter((g) => g && isWynGuide(g)))).slice(0, MAX_GUIDES)
    : [];
  if (!guides.length) return NextResponse.json({ error: "Indica las guías de WYN." }, { status: 400 });

  const ok: WynTrackingResult[] = [];
  let failed = 0;
  let blocked = false;
  for (let i = 0; i < guides.length; i += 1) {
    try {
      ok.push(await fetchWynTracking(guides[i]));
    } catch (reason) {
      failed += 1;
      if (isProviderBlock(reason instanceof Error ? reason.message : String(reason))) {
        blocked = true;
        break;
      }
    }
    if (i + 1 < guides.length) await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
  }

  if (ok.length) {
    await upsertWynTracking(
      ok.map((r) => ({
        guide_number: r.guideNumber,
        tracking_number: r.trackingNumber,
        latest_status: r.latestStatus,
        latest_code: r.latestCode,
        latest_group: r.latestGroup,
        latest_at: r.latestAt,
        has_incident: r.hasIncident,
        incident_reason: r.incidentReason,
        delivery_address: r.deliveryAddress,
        receiver_name: r.receiverName,
        events: r.events,
      })),
      store.id
    );
  }
  // El ultimo tramo (o uno bloqueado) rearma la tabla para que se vean los estados nuevos.
  if ((body?.final === true || blocked) && ok.length) await refreshFinanceDatasetCache(store).catch(() => undefined);

  return NextResponse.json({
    checked: ok.length,
    failed,
    blocked,
    delivered: ok.filter((r) => r.latestGroup === "delivered").length,
    incidents: ok.filter((r) => r.hasIncident || r.latestGroup === "incident").length,
  });
}
