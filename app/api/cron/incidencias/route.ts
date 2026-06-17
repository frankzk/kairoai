import { NextResponse } from "next/server";
import {
  listForzaTracking,
  listLogisticsRows,
  listMoovinTracking,
  listPersistedShopifyOrders,
} from "@/lib/finance";
import { FINANCE_STORES } from "@/lib/store-config";
import type { LogisticsRow } from "@/lib/finance-types";
import { persistedOrderToSummary, type ShopifyOrderSummary } from "@/lib/finance-orders";
import { detectForzaIncident, detectMoovinIncident } from "@/lib/incidents-detect";
import {
  getIncidentWatermark,
  listIncidentKeys,
  setIncidentWatermark,
  upsertDetectedIncident,
} from "@/lib/incidents";

export const runtime = "nodejs";
// Holgado para el escaneo completo (backfill / boton manual). En regimen
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

// Variantes de una guia para cruzar formatos (crudo, mayusculas, sin prefijo FD
// de Forza). Permite emparejar la guia del tracking con el tracking_number del
// pedido de Shopify aunque difieran en mayusculas o prefijo.
function guideKeys(guide: string | undefined): string[] {
  const t = (guide || "").trim();
  if (!t) return [];
  const up = t.toUpperCase();
  return Array.from(new Set([t, up, up.replace(/^FD/i, "")].filter(Boolean)));
}

// Indexa los pedidos de Shopify por la guia de su fulfillment (tracking_number):
// asi una novedad puede traer cliente/telefono/pedido del pedido de Shopify
// aunque la guia aun no este en un Excel de logistica.
function indexShopifyByGuide(orders: ShopifyOrderSummary[]): Map<string, ShopifyOrderSummary> {
  const map = new Map<string, ShopifyOrderSummary>();
  for (const order of orders) {
    for (const key of guideKeys(order.tracking_number)) {
      if (!map.has(key)) map.set(key, order);
    }
  }
  return map;
}

function lookupShopify(
  map: Map<string, ShopifyOrderSummary>,
  guide: string
): ShopifyOrderSummary | undefined {
  for (const key of guideKeys(guide)) {
    const hit = map.get(key);
    if (hit) return hit;
  }
  return undefined;
}

async function loadShopifyByGuide(storeId: number): Promise<Map<string, ShopifyOrderSummary>> {
  const persisted = await listPersistedShopifyOrders(20000, 0, storeId);
  return indexShopifyByGuide(
    persisted.map((order) => persistedOrderToSummary(order as unknown as Record<string, unknown>))
  );
}

// Maximo checked_at de un lote. Viene en ISO-UTC consistente desde Supabase, asi
// que el maximo lexicografico coincide con el maximo temporal.
function maxChecked(rows: Array<{ checked_at: string }>, seed: string): string {
  return rows.reduce((m, r) => (r.checked_at && r.checked_at > m ? r.checked_at : m), seed);
}

// Arma/actualiza la bandeja de novedades POR TIENDA. Cruza el tracking del
// courier (Moovin en Costa Rica; Forza en Honduras) con la logistica importada y
// con los pedidos de Shopify (por guia). Idempotente por (store_id, clave de
// envio): reejecutar no duplica ni pisa la gestion manual.
//
// full=false (cron programado): incremental, solo el tracking con checked_at
// posterior al ultimo watermark. full=true (boton "Detectar novedades"):
// reescaneo completo, util para rellenar datos faltantes en novedades ya creadas.
async function run(full: boolean) {
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
      const since = full ? null : await getIncidentWatermark("moovin");
      const tracking = await listMoovinTracking({ since });
      if (tracking.length) {
        for (const store of moovinStores) {
          const [rows, shopifyByGuide, existingKeys] = await Promise.all([
            listLogisticsRows(undefined, store.id),
            loadShopifyByGuide(store.id),
            listIncidentKeys(store.id),
          ]);
          const byGuide = indexByGuide(rows);
          for (const t of tracking) {
            const candidate = detectMoovinIncident(
              t,
              byGuide.get(t.id_package),
              store.id,
              lookupShopify(shopifyByGuide, t.id_package)
            );
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
      const since = full ? null : await getIncidentWatermark(sourceKey);
      const tracking = await listForzaTracking(store.id, { since });
      if (!tracking.length) continue;

      const [rows, shopifyByGuide, existingKeys] = await Promise.all([
        listLogisticsRows(undefined, store.id),
        loadShopifyByGuide(store.id),
        listIncidentKeys(store.id),
      ]);
      const byGuide = indexByGuide(rows);
      for (const t of tracking) {
        const candidate = detectForzaIncident(
          t,
          byGuide.get(t.guide_number),
          lookupShopify(shopifyByGuide, t.guide_number)
        );
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

// El cron programado de Vercel (GET) corre en modo incremental.
export async function GET() {
  return run(false);
}

// El boton "Detectar novedades" (POST con ?full=1) reescanea todo, para rellenar
// datos faltantes en novedades ya creadas.
export async function POST(req: Request) {
  const full = new URL(req.url).searchParams.get("full");
  return run(full === "1" || full === "true");
}
