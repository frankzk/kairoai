import { NextResponse } from "next/server";
import { listForzaSyncCandidates } from "@/lib/finance";
import { syncForzaGuides } from "@/lib/forza-sync";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";
import { detectIncidents } from "@/lib/incidents-run";

export const runtime = "nodejs";
export const maxDuration = 300;

// POR QUE EXISTE: el tracking de Forza (Honduras) solo se actualizaba con el
// boton manual "Forza (N)" del tablero. Nadie lo apreto despues del 27/07 y
// Honduras paso dos meses sin estados de entrega: al 26/09, 2.812 guias Forza
// de agosto y septiembre nunca se habian consultado y las Novedades de HN
// estaban congeladas (la deteccion lee de este tracking). Moovin tiene su cron
// desde siempre; Forza no tenia ninguno.

// Consultas por corrida. Con ~3.800 guias atrasadas, 200 por hora ponen al dia
// el atraso en alrededor de un dia; despues entran ~50 guias nuevas por dia y
// el resto del cupo re-lee las que siguen en camino. Configurable por env.
const MAX_PER_RUN = Number(process.env.FORZA_MAX_PER_RUN ?? 200);
// Una guia ya leida no se reconsulta dentro de esta ventana (el cron corre cada
// hora; evita repetir si alguien usa el boton manual en el medio).
const FRESH_WINDOW_MINUTES = Number(process.env.FORZA_FRESH_WINDOW_MIN ?? 45);
// Guias nuevas: se descubren en pedidos de hasta esta antiguedad.
const DISCOVERY_DAYS = Number(process.env.FORZA_DISCOVERY_DAYS ?? 90);
// Dejar de arrancar consultas con margen antes del maxDuration (300 s) para
// guardar, refrescar la cache y detectar novedades.
const TIME_BUDGET_MS = 200_000;

// Si CRON_SECRET esta configurado, exigirlo (Vercel cron manda
// "Authorization: Bearer <CRON_SECRET>"). Si no esta, se permite, igual que en
// los demas crons.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type StoreResult =
  | {
      store: string;
      candidates: number;
      checked: number;
      delivered: number;
      incidents: number;
      failed_lookups: number;
      not_started: number;
      saved: number;
    }
  | { store: string; error: string };

async function run(chainDetect: boolean) {
  const startedAt = Date.now();
  const results: StoreResult[] = [];
  let anyChecked = false;

  for (const publicStore of FINANCE_STORES.filter((s) => s.logisticsProvider === "forza")) {
    const store = getStoreConfig(publicStore.code);
    try {
      const guides = await listForzaSyncCandidates(store.id, {
        limit: MAX_PER_RUN,
        freshWindowMinutes: FRESH_WINDOW_MINUTES,
        discoveryDays: DISCOVERY_DAYS,
      });
      const sync = await syncForzaGuides(guides, store.id, { deadlineMs: startedAt + TIME_BUDGET_MS });
      if (sync.checked > 0) {
        anyChecked = true;
        // El tablero de HN lee de una cache durable del dataset: sin esto los
        // estados nuevos no se ven hasta la proxima reconstruccion.
        await refreshFinanceDatasetCache(store).catch((err) =>
          console.warn(`[cron/forza cache] ${store.code}:`, err)
        );
      }
      results.push({
        store: store.code,
        candidates: guides.length,
        checked: sync.checked,
        delivered: sync.delivered,
        incidents: sync.incidents,
        failed_lookups: sync.failedLookups,
        not_started: sync.notStarted,
        saved: sync.saved,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error";
      console.error(`[cron/forza] ${store.code}:`, err);
      results.push({ store: store.code, error: message });
    }
  }

  // Encadena la deteccion de novedades sobre el tracking recien leido, igual
  // que el cron de Moovin: las incidencias de HN entran sin esperar otra corrida.
  let detected: Awaited<ReturnType<typeof detectIncidents>> | null = null;
  if (chainDetect && anyChecked) {
    try {
      detected = await detectIncidents(false);
    } catch (err) {
      console.warn("[cron/forza detect]", err);
    }
  }

  // Un error por tienda se responde 500: si el tracking deja de actualizarse
  // tiene que verse en los logs, no quedar tapado por un 200.
  const failed = results.some((r) => "error" in r);
  return NextResponse.json({ results, detected }, { status: failed ? 500 : 200 });
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run(true);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run(false);
}
