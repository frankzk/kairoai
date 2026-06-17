import { NextResponse } from "next/server";
import { listForzaTracking, listLogisticsRows, listMoovinTracking } from "@/lib/finance";
import { FINANCE_STORES } from "@/lib/store-config";
import type { LogisticsRow } from "@/lib/finance-types";
import { detectForzaIncident, detectMoovinIncident } from "@/lib/incidents-detect";
import { listIncidentKeys, upsertDetectedIncident } from "@/lib/incidents";

export const runtime = "nodejs";
export const maxDuration = 60;

// Arma/actualiza la bandeja de novedades POR TIENDA. Para las tiendas con courier
// Moovin (Costa Rica) cruza la cache de Moovin con las filas de logistica de esa
// tienda. Idempotente por (store_id, clave de envio): reejecutar no duplica ni
// pisa la gestion manual. (Las tiendas con Forza -Honduras- entran en la fase 2.)
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
    // El tracking de Moovin es global (no esta particionado por tienda); las filas
    // de logistica si lo estan, asi que el cruce por guia ancla cada novedad a la
    // tienda correcta. Hoy solo Costa Rica usa Moovin.
    const moovinStores = FINANCE_STORES.filter((s) => s.logisticsProvider === "moovin");
    const moovinTracking = moovinStores.length ? await listMoovinTracking() : [];

    for (const store of moovinStores) {
      const [rows, existingKeys] = await Promise.all([
        listLogisticsRows(undefined, store.id),
        listIncidentKeys(store.id),
      ]);

      // Indice guia -> fila de logistica (de esta tienda) para enriquecer Moovin.
      const byGuide = new Map<string, LogisticsRow>();
      for (const row of rows) {
        if (row.guide_number && !byGuide.has(row.guide_number)) byGuide.set(row.guide_number, row);
      }

      // Solo incidencias activas de Moovin (ultimo evento failed / has_incident),
      // que es lo que la pagina de finanzas marca como "Incidencia". Incluye
      // auto-resolucion cuando el courier confirma la entrega.
      for (const t of moovinTracking) {
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

    // Honduras (courier Forza): el tracking de Forza ya esta particionado por
    // tienda (store_id), asi que se lee por tienda y se cruza con su logistica.
    const forzaStores = FINANCE_STORES.filter((s) => s.logisticsProvider === "forza");
    for (const store of forzaStores) {
      const [tracking, rows, existingKeys] = await Promise.all([
        listForzaTracking(store.id),
        listLogisticsRows(undefined, store.id),
        listIncidentKeys(store.id),
      ]);

      const byGuide = new Map<string, LogisticsRow>();
      for (const row of rows) {
        if (row.guide_number && !byGuide.has(row.guide_number)) byGuide.set(row.guide_number, row);
      }

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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    const friendly = /does not exist|42P01/.test(message)
      ? "Falta una tabla requerida (migracion 0014_incidencias, moovin_tracking, forza_tracking o logistics_rows)."
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
