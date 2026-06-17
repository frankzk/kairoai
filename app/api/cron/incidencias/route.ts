import { NextResponse } from "next/server";
import { listForzaTracking, listLogisticsRows, listMoovinTracking } from "@/lib/finance";
import { FINANCE_STORES } from "@/lib/store-config";
import type { LogisticsRow } from "@/lib/finance-types";
import { detectForzaIncident, detectMoovinIncident } from "@/lib/incidents-detect";
import {
  getIncidentWatermark,
  listIncidentKeys,
  setIncidentWatermark,
  upsertDetectedIncident,
} from "@/lib/incidents";

export const runtime = "nodejs";
// Holgado para el backfill de la primera corrida (watermark vacio). En regimen
// incremental cada corrida procesa poco y termina mucho antes.
export const maxDuration = 300;

// Indexa las filas de logistica de una tienda por su guia, para enriquecer la
// novedad (pedido, telefono, COD) al cruzar con el tracking del courier.
function indexByGuide(rows: LogisticsRow[]): Map<string, LogisticsRow> {
  const byGuide = new Map<string, LogisticsRow>();
  for (const row of rows) {
    if (row.guide_number && !byGuide.has(row.guide_number)) byGuide.set(row.guide_number, row);
  }
  return byGuide;
}

// Maximo checked_at de un lote. Viene en ISO-UTC consistente desde Supabase, asi
// que el maximo lexicografico coincide con el maximo temporal.
function maxChecked(rows: Array<{ checked_at: string }>, seed: string): string {
  return rows.reduce((m, r) => (r.checked_at && r.checked_at > m ? r.checked_at : m), seed);
}

// Arma/actualiza la bandeja de novedades POR TIENDA, de forma INCREMENTAL: por
// cada fuente de tracking (Moovin global en Costa Rica; Forza por tienda en
// Honduras) procesa solo las guias con checked_at posterior al ultimo watermark
// guardado, en vez de reescanear todo el historico. Asi el trabajo por corrida
// es proporcional a lo que se movio, no al total acumulado. Idempotente por
// (store_id, clave de envio): reejecutar no duplica ni pisa la gestion manual.
async function run() {
  let scanned = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const bump = (outcome: "created" | "updated" | "skipped") => {
    if (outcome === "created") created += 1;
    else if (outcome === "updated") updated += 1;
    else skipped += 1;
  };

  try {
    // ----- Costa Rica (Moovin): tracking global, anclado a la tienda por guia.
    const moovinStores = FINANCE_STORES.filter((s) => s.logisticsProvider === "moovin");
    if (moovinStores.length) {
      const since = await getIncidentWatermark("moovin");
      const tracking = await listMoovinTracking({ since });
      if (tracking.length) {
        for (const store of moovinStores) {
          const [rows, existingKeys] = await Promise.all([
            listLogisticsRows(undefined, store.id),
            listIncidentKeys(store.id),
          ]);
          const byGuide = indexByGuide(rows);
          for (const t of tracking) {
            const candidate = detectMoovinIncident(t, byGuide.get(t.id_package), store.id);
            if (!candidate) continue;
            // Una entrega solo importa si ya existe una novedad para ese envio.
            if (candidate.last_tracking_group === "delivered" && !existingKeys.has(candidate.incident_key)) {
              continue;
            }
            scanned += 1;
            const { outcome } = await upsertDetectedIncident(candidate);
            bump(outcome);
          }
        }
        const next = maxChecked(tracking, since ?? "");
        if (next) await setIncidentWatermark("moovin", next);
      }
    }

    // ----- Honduras (Forza): tracking ya particionado por tienda (store_id).
    const forzaStores = FINANCE_STORES.filter((s) => s.logisticsProvider === "forza");
    for (const store of forzaStores) {
      const sourceKey = `forza:${store.id}`;
      const since = await getIncidentWatermark(sourceKey);
      const tracking = await listForzaTracking(store.id, { since });
      if (!tracking.length) continue;

      const [rows, existingKeys] = await Promise.all([
        listLogisticsRows(undefined, store.id),
        listIncidentKeys(store.id),
      ]);
      const byGuide = indexByGuide(rows);
      for (const t of tracking) {
        const candidate = detectForzaIncident(t, byGuide.get(t.guide_number));
        if (!candidate) continue;
        if (candidate.last_tracking_group === "delivered" && !existingKeys.has(candidate.incident_key)) {
          continue;
        }
        scanned += 1;
        const { outcome } = await upsertDetectedIncident(candidate);
        bump(outcome);
      }
      const next = maxChecked(tracking, since ?? "");
      if (next) await setIncidentWatermark(sourceKey, next);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta una tabla requerida (migraciones 0014_incidencias / 0015_incident_sync_state, moovin_tracking, forza_tracking o logistics_rows)."
      : message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }

  return NextResponse.json({ scanned, created, updated, skipped });
}

export async function GET() {
  return run();
}

export async function POST() {
  return run();
}
