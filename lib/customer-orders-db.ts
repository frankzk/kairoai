// Historial de pedidos de un cliente por TELEFONO, con el estado en vivo del
// courier. Lo usan el drawer de Leads (via /api/leads/[leadId]/orders) y el
// drawer de gestion de pedidos: los dos hacen la misma pregunta ("que le paso
// antes a este cliente"), asi que la consulta vive una sola vez.
//
// El match es por sufijo de 8 digitos del telefono, el mismo criterio de
// normalizacion que el RPC match_leads_to_shopify_orders (migracion 0025).

import { getDB } from "./db";
import {
  COLUMNAS_PEDIDO_ICOMFLY,
  CORTE_PEDIDOS_ICOMFLY,
  direccionIcomfly,
  pedidosDeIcomfly,
  type PedidoIcomflyCrudo,
} from "./icomfly-pedidos";
import {
  buildCustomerSummary,
  resolveOrderState,
  resolveOrderStateLabel,
  type CustomerOrder,
  type CustomerOrderItem,
  type CustomerSummary,
} from "./customer-history";

const MAX_ORDERS = 20;

interface OrderRow {
  name: string;
  shopify_created_at: string | null;
  total_price: string | number | null;
  currency: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  tracking_number: string | null;
  line_items: unknown;
  raw_order: unknown;
  /** Ya resuelta (pedidos de iComfly): no hay raw_order de Shopify. */
  address?: string;
}

interface MoovinRow {
  id_package: string;
  latest_status: string | null;
  latest_group: string | null;
  latest_at: string | null;
  has_incident: boolean | null;
  incident_reason: string | null;
}

export interface CustomerOrdersResult {
  orders: CustomerOrder[];
  summary: CustomerSummary;
  /** Direccion del pedido mas reciente que tenga una. */
  last_address: string;
}

// line_items es JSONB con la forma de Shopify; solo necesitamos titulo+cantidad
// y toleramos formas viejas/incompletas.
function summarizeItems(raw: unknown): CustomerOrderItem[] {
  if (!Array.isArray(raw)) return [];
  const items: CustomerOrderItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const title = String(o.title ?? o.name ?? "").trim();
    if (!title) continue;
    items.push({ title, quantity: Number(o.quantity ?? 1) || 1 });
  }
  return items;
}

/** Direccion de entrega en una linea, como la dicta la asesora por telefono. */
function formatAddress(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const order = raw as Record<string, unknown>;
  const ship = (order.shipping_address ?? order.billing_address) as
    | Record<string, unknown>
    | undefined;
  if (!ship) return "";
  const parts = [ship.address1, ship.address2, ship.city, ship.province]
    .map((p) => String(p ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

// Desde el 28/10/2026 los pedidos nuevos existen solo en iComfly
// (lib/icomfly-pedidos.ts): tambien son historia del cliente, con las mismas
// reglas para no contar dos veces lo que ya esta en Shopify.
async function pedidosIcomflyDelTelefono(
  storeId: number,
  tail: string,
  deShopify: OrderRow[],
  currency: string
): Promise<OrderRow[]> {
  const { data, error } = await getDB()
    .from("icomfly_order_payloads")
    .select(COLUMNAS_PEDIDO_ICOMFLY)
    .eq("store_id", storeId)
    .gte("payload->>created_at", CORTE_PEDIDOS_ICOMFLY)
    // `tail` son solo digitos: no puede romper el filtro.
    .or(`payload->customer->>phone.ilike.*${tail},payload->>shipping_phone.ilike.*${tail}`)
    .limit(MAX_ORDERS);
  if (error) throw new Error(`pedidosIcomflyDelTelefono: ${error.message}`);
  const crudos = (data ?? []) as unknown as PedidoIcomflyCrudo[];
  const direccion = new Map(crudos.map((c) => [`icomfly-${String(c.id ?? "")}`, direccionIcomfly(c)]));
  return pedidosDeIcomfly(
    crudos,
    deShopify.map((r) => ({ name: r.name, order_number: 0, tracking_number: r.tracking_number ?? "" })),
    { currency }
  ).map((p) => ({
    name: p.name,
    shopify_created_at: p.created_at,
    total_price: p.total_price,
    currency: p.currency,
    fulfillment_status: p.fulfillment_status,
    cancelled_at: p.cancelled_at,
    tracking_number: p.tracking_number ?? "",
    line_items: p.line_items,
    raw_order: null,
    address: direccion.get(p.id) ?? "",
  }));
}

export function emptyCustomerOrders(currency: string): CustomerOrdersResult {
  return { orders: [], summary: buildCustomerSummary([], currency), last_address: "" };
}

export async function loadCustomerOrdersByPhone(opts: {
  storeId: number;
  phone: string;
  currency: string;
  /** Decide la etiqueta del courier cuando el pedido tiene guia. */
  logisticsProvider: string;
}): Promise<CustomerOrdersResult> {
  const empty = emptyCustomerOrders(opts.currency);

  const digits = String(opts.phone ?? "").replace(/\D/g, "");
  const tail = digits.slice(-8);
  if (tail.length < 7) return empty;

  const db = getDB();
  const { data, error } = await db
    .from("shopify_orders")
    .select(
      "name,shopify_created_at,total_price,currency,fulfillment_status,cancelled_at,tracking_number,line_items,raw_order"
    )
    .eq("store_id", opts.storeId)
    .ilike("phone", `%${tail}`)
    .order("shopify_created_at", { ascending: false })
    .limit(MAX_ORDERS);
  if (error) throw new Error(`loadCustomerOrdersByPhone: ${error.message}`);

  const deShopify = (data ?? []) as OrderRow[];
  // Best-effort: si iComfly falla, el historial de Shopify sale igual.
  const deIcomfly = await pedidosIcomflyDelTelefono(opts.storeId, tail, deShopify, opts.currency).catch((err) => {
    console.warn("[customer-orders] pedidos de iComfly:", err instanceof Error ? err.message : err);
    return [];
  });
  const rows = [...deShopify, ...deIcomfly]
    .sort((a, b) => String(b.shopify_created_at ?? "").localeCompare(String(a.shopify_created_at ?? "")))
    .slice(0, MAX_ORDERS);
  if (rows.length === 0) return empty;

  // Tracking en vivo en UNA consulta para todos los pedidos con guia.
  const guides = rows.map((r) => (r.tracking_number ?? "").trim()).filter((g) => g.length > 0);
  const trackingByGuide = new Map<string, MoovinRow>();
  if (guides.length > 0) {
    const { data: tracking } = await db
      .from("moovin_tracking")
      .select("id_package,latest_status,latest_group,latest_at,has_incident,incident_reason")
      .in("id_package", guides);
    for (const t of (tracking ?? []) as MoovinRow[]) {
      trackingByGuide.set(String(t.id_package), t);
    }
  }

  const orders: CustomerOrder[] = rows.map((row) => {
    const guide = (row.tracking_number ?? "").trim();
    const live = guide ? trackingByGuide.get(guide) : undefined;
    const cancelled = row.cancelled_at != null;
    const hasIncident = Boolean(live?.has_incident);
    const state = resolveOrderState({
      cancelled,
      moovinGroup: live?.latest_group,
      hasIncident,
      fulfillmentStatus: row.fulfillment_status,
      guide,
    });
    return {
      name: row.name,
      created_at: row.shopify_created_at,
      total: Number(row.total_price ?? 0),
      currency: row.currency ?? opts.currency,
      items: summarizeItems(row.line_items),
      address: row.address ?? formatAddress(row.raw_order),
      guide,
      courier: guide ? (opts.logisticsProvider === "forza" ? "Forza" : "Moovin") : "",
      state,
      state_label: resolveOrderStateLabel({
        state,
        moovinStatus: live?.latest_status,
        hasIncident,
        incidentReason: live?.incident_reason,
      }),
      state_at: live?.latest_at ?? null,
      has_incident: hasIncident,
      incident_reason: live?.incident_reason ?? "",
    };
  });

  return {
    orders,
    summary: buildCustomerSummary(orders, opts.currency),
    last_address: orders.find((o) => o.address)?.address ?? "",
  };
}
