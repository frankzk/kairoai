import { NextRequest, NextResponse } from "next/server";
import { fetchForzaTracking, normalizeForzaGuide } from "@/lib/forza";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  getRecentlyCheckedForzaGuides,
  listForzaTracking,
  upsertForzaTracking,
} from "@/lib/finance";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";
import { forEachRateLimited } from "@/lib/concurrency";

export const runtime = "nodejs";
export const maxDuration = 60;

// Espaciado MINIMO entre el ARRANQUE de dos consultas a Forza: es el limite de
// tasa acordado con el courier y no se toca (<= 1 consulta cada 300 ms).
const PER_REQUEST_DELAY_MS = 300;
// Consultas en vuelo a la vez. Antes era 1: se dormia 300 ms y RECIEN despues
// se consultaba, asi que la latencia de Forza se sumaba a la espera y la
// funcion facturaba ~800 ms por guia sin hacer nada. Con varias en vuelo el
// costo por guia baja al espaciado (300 ms) sin subir la tasa contra Forza.
const MAX_CONCURRENCY = 5;
const MAX_GUIDES_PER_CALL = 80;
const FRESH_WINDOW_MINUTES = 6 * 60;

type ForzaUpsertRow = Parameters<typeof upsertForzaTracking>[0][number];

interface RequestedGuide {
  guide: string;
}

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    const rows = await listForzaTracking(store.id);
    return NextResponse.json({ rows, total: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer tracking Forza";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta la tabla forza_tracking: ejecuta supabase/migrations/0011_forza_tracking.sql."
      : message;
    return NextResponse.json({ rows: [], total: 0, error: friendly }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const store = getRequiredStoreFromBody(body);
    if (!store) {
      return NextResponse.json(
        { error: "store requerido: usa mireva-cr o mireva-hn" },
        { status: 400 }
      );
    }
    const requested = Array.isArray(body.guides) ? (body.guides as RequestedGuide[]) : [];
    const force = body.force === true;
    if (!requested.length) {
      return NextResponse.json({ error: "guides requerido" }, { status: 400 });
    }

    const seen = new Set<string>();
    const valid = requested
      .map((item) => ({ guide: normalizeForzaGuide(String(item.guide ?? "")) }))
      .filter((item) => {
        if (!item.guide || seen.has(item.guide)) return false;
        seen.add(item.guide);
        return true;
      })
      .slice(0, MAX_GUIDES_PER_CALL);

    const fresh = force ? new Set<string>() : await getRecentlyCheckedForzaGuides(store.id, FRESH_WINDOW_MINUTES);
    const toCheck = valid.filter((item) => !fresh.has(item.guide) && !fresh.has(item.guide.replace(/^FD/i, "")));

    let checked = 0;
    let incidents = 0;
    let delivered = 0;
    let failedLookups = 0;
    const results: Array<{ guide_number: string; latest_status: string | null; group: string | null; has_incident: boolean }> = [];

    const pending: ForzaUpsertRow[] = [];

    // JS corre en un solo hilo: los contadores no necesitan lock.
    await forEachRateLimited(
      toCheck,
      async (item) => {
        const tracking = await fetchForzaTracking(item.guide);
        if (!tracking.ok || !tracking.latest_status) {
          failedLookups += 1;
          return;
        }
        checked += 1;
        if (tracking.has_incident) incidents += 1;
        if (tracking.latest_group === "delivered") delivered += 1;
        results.push({
          guide_number: tracking.guide_number,
          latest_status: tracking.latest_status,
          group: tracking.latest_group,
          has_incident: tracking.has_incident,
        });
        pending.push({
          guide_number: tracking.guide_number,
          tracking_number: tracking.tracking_number,
          latest_status: tracking.latest_status ?? "",
          latest_code: tracking.latest_status_code ?? "",
          latest_group: tracking.latest_group ?? "",
          latest_at: tracking.latest_at,
          has_incident: tracking.has_incident,
          incident_reason: tracking.incident_reason,
          delivery_address: tracking.delivery_address,
          receiver_name: tracking.receiver_name,
          events: tracking.events,
        });
      },
      { concurrency: MAX_CONCURRENCY, minIntervalMs: PER_REQUEST_DELAY_MS }
    );

    // Un solo upsert por tanda en vez de uno por guia (antes eran hasta 80
    // viajes a la base, cada uno bloqueando el bucle).
    if (pending.length) {
      try {
        await upsertForzaTracking(pending, store.id);
      } catch (err) {
        console.warn("[forza-sync cache]", err);
      }
    }

    // Solo si hubo cambios reales en forza_tracking vale la pena reconstruir.
    // Defensivo: nunca rompe el sync si la cache falla.
    if (checked > 0) {
      await refreshFinanceDatasetCache(store).catch((cacheErr) =>
        console.warn(`[forza-sync cache] ${store.code}:`, cacheErr)
      );
    }

    return NextResponse.json({
      requested: valid.length,
      skipped_fresh: valid.length - toCheck.length,
      checked,
      delivered,
      incidents,
      failed_lookups: failedLookups,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando Forza";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
