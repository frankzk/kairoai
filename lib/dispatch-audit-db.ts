// Consulta de la auditoria de despacho. Las reglas viven en dispatch-audit.ts.
//
// Cruza tres fuentes por tienda:
//   courier_shipments  -> estado REAL segun el courier (se consulta su API)
//   shopify_orders     -> puente pedido<->guia, cliente y monto
//   icomfly_orders     -> lo que muestra el CRM
//
// El enlace es el mismo que usa la busqueda del tablero: la guia vive en
// shopify_orders.tracking_number y el pedido visible casa con
// icomfly_orders.shopify_display_number.

import { getDB } from "./db";
import { auditRows, type AuditFinding, type AuditInput, type AuditSummary } from "./dispatch-audit";

const MAX_ROWS = 2000;

interface ShipmentRow {
  guide_number: string | null;
  normalized_status: string | null;
  latest_at: string | null;
  raw_payload: { events?: Array<{ code?: string; description?: string; title?: string }> } | null;
}

interface ShopifyRow {
  name: string | null;
  tracking_number: string | null;
  customer_name: string | null;
  phone: string | null;
  total_price: number | string | null;
}

interface CrmRow {
  shopify_display_number: string | null;
  status: string | null;
  synced_at: string | null;
}

export interface DispatchAuditResult {
  findings: AuditFinding[];
  summary: AuditSummary;
  /** Guias del courier revisadas (denominador de la auditoria). */
  reviewed: number;
  /** Guias sin pedido de Shopify o sin fila en el CRM: no se pueden cruzar. */
  unmatched: number;
  /** Lectura mas reciente de cada fuente, para saber contra que foto se juzga. */
  courier_checked_at: string | null;
  crm_synced_at: string | null;
}

export async function runDispatchAudit(opts: {
  storeId: number;
  now?: number;
}): Promise<DispatchAuditResult> {
  const db = getDB();
  const { storeId } = opts;

  const [shipmentsRes, crmFreshnessRes] = await Promise.all([
    db
      .from("courier_shipments")
      .select("guide_number,normalized_status,latest_at,raw_payload,checked_at")
      .eq("store_id", storeId)
      .order("latest_at", { ascending: false, nullsFirst: false })
      .limit(MAX_ROWS),
    db
      .from("icomfly_orders")
      .select("synced_at")
      .eq("store_id", storeId)
      .order("synced_at", { ascending: false })
      .limit(1),
  ]);

  if (shipmentsRes.error) throw new Error(`runDispatchAudit (courier): ${shipmentsRes.error.message}`);
  if (crmFreshnessRes.error) throw new Error(`runDispatchAudit (CRM): ${crmFreshnessRes.error.message}`);

  const shipments = (shipmentsRes.data ?? []) as Array<ShipmentRow & { checked_at: string | null }>;
  if (!shipments.length) {
    return {
      findings: [],
      summary: {
        desfase_entregado: 0,
        desfase_devuelto: 0,
        monto_devuelto_mal_contado: 0,
        estancados: 0,
        total: 0,
      },
      reviewed: 0,
      unmatched: 0,
      courier_checked_at: null,
      crm_synced_at: null,
    };
  }

  const guides = Array.from(
    new Set(shipments.map((s) => String(s.guide_number ?? "").trim()).filter(Boolean))
  );

  // Pedidos de Shopify que llevan esas guias.
  const shopifyByGuide = new Map<string, ShopifyRow>();
  for (const chunk of chunked(guides, 300)) {
    const { data, error } = await db
      .from("shopify_orders")
      .select("name,tracking_number,customer_name,phone,total_price")
      .eq("store_id", storeId)
      .in("tracking_number", chunk);
    if (error) throw new Error(`runDispatchAudit (Shopify): ${error.message}`);
    for (const row of (data ?? []) as ShopifyRow[]) {
      const key = String(row.tracking_number ?? "").trim().toUpperCase();
      if (key) shopifyByGuide.set(key, row);
    }
  }

  // Estado del CRM para esos pedidos.
  const names = Array.from(
    new Set(
      Array.from(shopifyByGuide.values())
        .map((r) => String(r.name ?? "").trim())
        .filter(Boolean)
    )
  );
  const crmByName = new Map<string, CrmRow>();
  for (const chunk of chunked(names, 300)) {
    const { data, error } = await db
      .from("icomfly_orders")
      .select("shopify_display_number,status,synced_at")
      .eq("store_id", storeId)
      .in("shopify_display_number", chunk);
    if (error) throw new Error(`runDispatchAudit (CRM por pedido): ${error.message}`);
    for (const row of (data ?? []) as CrmRow[]) {
      const key = String(row.shopify_display_number ?? "").trim().toUpperCase();
      if (key) crmByName.set(key, row);
    }
  }

  const inputs: AuditInput[] = [];
  let unmatched = 0;
  for (const shipment of shipments) {
    const guide = String(shipment.guide_number ?? "").trim();
    if (!guide) continue;
    const shopify = shopifyByGuide.get(guide.toUpperCase());
    const crm = shopify ? crmByName.get(String(shopify.name ?? "").trim().toUpperCase()) : undefined;
    if (!shopify || !crm) {
      unmatched += 1;
      continue;
    }
    const latestEvent = shipment.raw_payload?.events?.[0];
    inputs.push({
      guide_number: guide,
      order_name: String(shopify.name ?? ""),
      customer_name: String(shopify.customer_name ?? ""),
      customer_phone: String(shopify.phone ?? ""),
      amount: Number(shopify.total_price ?? 0) || 0,
      courier_status: String(shipment.normalized_status ?? ""),
      courier_code: String(latestEvent?.code ?? ""),
      courier_event: String(latestEvent?.description || latestEvent?.title || ""),
      latest_at: shipment.latest_at,
      crm_status: String(crm.status ?? ""),
      crm_synced_at: crm.synced_at,
    });
  }

  const { findings, summary } = auditRows(inputs, opts.now);
  const courierCheckedAt = shipments
    .map((s) => s.checked_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  return {
    findings,
    summary,
    reviewed: inputs.length,
    unmatched,
    courier_checked_at: courierCheckedAt,
    crm_synced_at: ((crmFreshnessRes.data ?? [])[0] as { synced_at?: string } | undefined)?.synced_at ?? null,
  };
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
