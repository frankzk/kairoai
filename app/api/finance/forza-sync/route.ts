import { NextRequest, NextResponse } from "next/server";
import { normalizeForzaGuide } from "@/lib/forza";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getRecentlyCheckedForzaGuides, listForzaTracking } from "@/lib/finance";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";
import { syncForzaGuides } from "@/lib/forza-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// La tasa y la concurrencia contra Forza viven en lib/forza-sync.ts, compartidas
// con el cron /api/cron/forza.
const MAX_GUIDES_PER_CALL = 80;
const FRESH_WINDOW_MINUTES = 6 * 60;
// Dejar de arrancar consultas con margen antes del maxDuration (60 s).
const TIME_BUDGET_MS = 50_000;

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
  const startedAt = Date.now();
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

    // Si falla el guardado, syncForzaGuides lanza y se responde 500: antes se
    // tragaba el error y la pantalla decia "Forza actualizado" sin haber
    // guardado nada.
    const sync = await syncForzaGuides(
      toCheck.map((item) => item.guide),
      store.id,
      { deadlineMs: startedAt + TIME_BUDGET_MS }
    );

    // Solo si hubo cambios reales en forza_tracking vale la pena reconstruir.
    // Defensivo: nunca rompe el sync si la cache falla.
    if (sync.checked > 0) {
      await refreshFinanceDatasetCache(store).catch((cacheErr) =>
        console.warn(`[forza-sync cache] ${store.code}:`, cacheErr)
      );
    }

    return NextResponse.json({
      requested: valid.length,
      skipped_fresh: valid.length - toCheck.length,
      checked: sync.checked,
      delivered: sync.delivered,
      incidents: sync.incidents,
      failed_lookups: sync.failedLookups,
      not_started: sync.notStarted,
      results: sync.results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando Forza";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
