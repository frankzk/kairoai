import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getDB } from "@/lib/db";
import {
  buildCustomerSummary,
  resolveOrderState,
  resolveOrderStateLabel,
  type CustomerOrder,
  type CustomerOrderItem,
} from "@/lib/customer-history";

export const runtime = "nodejs";
export const maxDuration = 20;

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
}

interface MoovinRow {
  id_package: string;
  latest_status: string | null;
  latest_group: string | null;
  latest_at: string | null;
  has_incident: boolean | null;
  incident_reason: string | null;
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

// Historial del cliente: pedidos de shopify_orders (local, sin pegarle a la API
// de Shopify) enriquecidos con el estado EN VIVO del courier. La llave del
// tracking es shopify_orders.tracking_number = moovin_tracking.id_package.
// Match por sufijo de 8 digitos del telefono, igual criterio de normalizacion
// que el RPC match_leads_to_shopify_orders (0025).
export async function GET(req: NextRequest, ctx: { params: { leadId: string } }) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  const leadId = Number(ctx.params.leadId);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: "leadId invalido" }, { status: 400 });
  }

  const empty = {
    orders: [] as CustomerOrder[],
    summary: buildCustomerSummary([], store.currency),
    last_address: "",
  };

  try {
    const db = getDB();
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("id,phone")
      .eq("store_id", store.id)
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });

    const digits = String((lead as { phone: string }).phone).replace(/\D/g, "");
    const tail = digits.slice(-8);
    if (tail.length < 7) return NextResponse.json(empty);

    const { data, error } = await db
      .from("shopify_orders")
      .select(
        "name,shopify_created_at,total_price,currency,fulfillment_status,cancelled_at,tracking_number,line_items,raw_order"
      )
      .eq("store_id", store.id)
      .ilike("phone", `%${tail}`)
      .order("shopify_created_at", { ascending: false })
      .limit(MAX_ORDERS);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as OrderRow[];
    if (rows.length === 0) return NextResponse.json(empty);

    // Tracking en vivo en UNA consulta para todos los pedidos con guia.
    const guides = rows
      .map((r) => (r.tracking_number ?? "").trim())
      .filter((g) => g.length > 0);
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
        currency: row.currency ?? store.currency,
        items: summarizeItems(row.line_items),
        address: formatAddress(row.raw_order),
        guide,
        courier: guide ? (store.logisticsProvider === "forza" ? "Forza" : "Moovin") : "",
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

    return NextResponse.json({
      orders,
      summary: buildCustomerSummary(orders, store.currency),
      // Direccion del pedido mas reciente que tenga una: se reusa al crear
      // un pedido nuevo sin volver a preguntarla.
      last_address: orders.find((o) => o.address)?.address ?? "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer el historial del cliente";
    return NextResponse.json({ ...empty, error: message }, { status: 500 });
  }
}
