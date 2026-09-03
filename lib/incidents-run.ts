// Deteccion de novedades (incidencias de reparto): cruza el tracking del courier
// (Moovin en CR; Forza en HN) con la logistica importada y los pedidos de Shopify
// (por guia), y arma/actualiza la bandeja. Extraido de la ruta /api/cron/incidencias
// para poder reutilizarlo: lo llaman tanto la ruta (cron + boton) como el cron de
// Moovin (encadena la deteccion justo despues de refrescar el tracking).
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
  backfillIncidentContact,
  getIncidentWatermark,
  listIncidentsByKey,
  listIncidentsMissingContact,
  recordIncidentRun,
  setIncidentWatermark,
  upsertDetectedIncident,
} from "@/lib/incidents";

export interface DetectIncidentsResult {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  filled: number;
}

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

// Repaso de relleno: novedades con nombre/telefono vacio se completan desde el
// pedido de Shopify matcheado por guia. Corre en cada corrida (no solo sobre el
// tracking que cambio), asi se sanan novedades viejas a medida que sus pedidos se
// sincronizan. No pisa la gestion manual (filtra manual_override) ni sobreescribe
// campos ya presentes.
async function backfillMissingContact(): Promise<number> {
  let filled = 0;
  for (const store of FINANCE_STORES) {
    const incompletes = await listIncidentsMissingContact(store.id);
    if (!incompletes.length) continue;
    const shopifyByGuide = await loadShopifyByGuide(store.id);
    for (const inc of incompletes) {
      const shopify = inc.guide_number ? lookupShopify(shopifyByGuide, inc.guide_number) : undefined;
      if (!shopify) continue;
      const patch: { customer_name?: string; customer_phone?: string } = {};
      if (!inc.customer_name) {
        const name = (shopify.customer_name || "").trim();
        if (name && name.toLowerCase() !== "sin nombre") patch.customer_name = name;
      }
      if (!inc.customer_phone && shopify.phone) patch.customer_phone = shopify.phone;
      if (patch.customer_name || patch.customer_phone) {
        await backfillIncidentContact(inc.id, patch);
        filled += 1;
      }
    }
  }
  return filled;
}

// Arma/actualiza la bandeja de novedades POR TIENDA. Idempotente por (store_id,
// clave de envio): reejecutar no duplica ni pisa la gestion manual.
//
// full=false: incremental, solo el tracking con checked_at posterior al ultimo
// watermark. full=true: reescaneo completo (boton "Detectar novedades"). Lanza si
// falta una tabla u otra dependencia (el caller decide como reportarlo).
export async function detectIncidents(full: boolean): Promise<DetectIncidentsResult> {
  let scanned = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const bump = (outcome: "created" | "updated" | "skipped") => {
    if (outcome === "created") created += 1;
    else if (outcome === "updated") updated += 1;
    else skipped += 1;
  };

  // ----- Costa Rica (Moovin): tracking global, anclado a la tienda por guia.
  const moovinStores = FINANCE_STORES.filter((s) => s.logisticsProvider === "moovin");
  if (moovinStores.length) {
    const since = full ? null : await getIncidentWatermark("moovin");
    const tracking = await listMoovinTracking({ since });
    if (tracking.length) {
      for (const store of moovinStores) {
        const [rows, shopifyByGuide, existentes] = await Promise.all([
          listLogisticsRows(undefined, store.id),
          loadShopifyByGuide(store.id),
          listIncidentsByKey(store.id),
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
          // Un cierre del courier (entrega/devolucion) solo importa si ya existe
          // una novedad para ese envio: sirve para cerrarla, no para crear una.
          if (
            (candidate.last_tracking_group === "delivered" || candidate.last_tracking_group === "returned") &&
            !existentes.has(candidate.incident_key)
          ) {
            continue;
          }
          scanned += 1;
          const { outcome } = await upsertDetectedIncident(candidate, {
            existing: existentes.get(candidate.incident_key) ?? null,
          });
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

    const [rows, shopifyByGuide, existentes] = await Promise.all([
      listLogisticsRows(undefined, store.id),
      loadShopifyByGuide(store.id),
      listIncidentsByKey(store.id),
    ]);
    const byGuide = indexByGuide(rows);
    for (const t of tracking) {
      const candidate = detectForzaIncident(
        t,
        byGuide.get(t.guide_number),
        lookupShopify(shopifyByGuide, t.guide_number)
      );
      if (!candidate) continue;
      if (
        (candidate.last_tracking_group === "delivered" || candidate.last_tracking_group === "returned") &&
        !existentes.has(candidate.incident_key)
      ) {
        continue;
      }
      scanned += 1;
      const { outcome } = await upsertDetectedIncident(candidate, {
        existing: existentes.get(candidate.incident_key) ?? null,
      });
      bump(outcome);
    }
    const next = maxChecked(tracking, since ?? "");
    if (next) await setIncidentWatermark(sourceKey, next);
  }

  // Repaso de relleno de nombre/telefono faltantes (best-effort).
  let filled = 0;
  try { filled = await backfillMissingContact(); } catch { /* backfill best-effort */ }

  // Marca la ultima corrida exitosa para la UI ("ultima actualizacion").
  try { await recordIncidentRun(); } catch { /* timestamp opcional */ }

  return { scanned, created, updated, skipped, filled };
}
