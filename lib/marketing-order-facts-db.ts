// Lectura de los pedidos de iComfly para los hechos anónimos de Marketing y de
// las recompras (RPC marketing_repeat_orders). Solo servidor.
//
// Se piden solo las rutas JSON necesarias: nunca teléfono, nombre, correo ni
// dirección (la provincia y la ciudad sí, para la segmentación).
import { getDB } from "./db";
import { isMissingRelation } from "./marketing-inventory-db";
import type { RepeatOrdersDay } from "./marketing-insights-types";
import type { RawOrderFact } from "./marketing-order-facts";

const COLUMNS = [
  "created_at:payload->>created_at",
  "status:payload->>status",
  "cancelled_at:payload->>cancelled_at",
  "reason:payload->>cancellation_reason",
  "sales_channel:payload->>sales_channel",
  "labels:payload->labels",
  "creator:payload->atribucion->creo->>nombre",
  "department:payload->>shipping_department",
  "city:payload->>shipping_city",
  "shopify_number:payload->>shopify_display_number",
  "product_name:payload->>product_name",
  "items:payload->items",
].join(",");

const PAGE = 1000;
/** About 100k orders; past this the payload says `truncated`. */
export const ORDER_FACTS_MAX_PAGES = 100;

/**
 * iComfly orders created in `[fromIso, toIso)` (ISO instants). The raw
 * `created_at` is an ISO string in UTC, so the bounds are padded one day and
 * the caller keeps the exact CR dates.
 */
export async function listOrderFactRows(
  storeId: number,
  fromIso: string,
  toIso: string,
): Promise<{ rows: RawOrderFact[]; truncated: boolean }> {
  const lower = new Date(Date.parse(fromIso) - 86_400_000).toISOString();
  const upper = new Date(Date.parse(toIso) + 86_400_000).toISOString();
  const rows: RawOrderFact[] = [];
  for (let page = 0; page < ORDER_FACTS_MAX_PAGES; page++) {
    const { data, error } = await getDB()
      .from("icomfly_order_payloads")
      .select(COLUMNS)
      .eq("store_id", storeId)
      .gte("payload->>created_at", lower)
      .lt("payload->>created_at", upper)
      .order("icomfly_order_id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error("No se pudieron leer los pedidos de iComfly.");
    const list = (data ?? []) as unknown as RawOrderFact[];
    rows.push(...list);
    if (list.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Repeat purchases per CR day (RPC). Missing function → pending migration. */
export async function readRepeatOrders(
  storeId: number,
  fromIso: string,
  toIso: string,
  minDays: number,
): Promise<{
  status: "ok" | "pending_migration" | "error";
  days: RepeatOrdersDay[];
}> {
  try {
    const { data, error } = await getDB().rpc("marketing_repeat_orders", {
      p_store: storeId,
      p_from: fromIso,
      p_to: toIso,
      p_min_days: minDays,
    });
    if (error)
      return {
        status: isMissingRelation(error) ? "pending_migration" : "error",
        days: [],
      };
    const days = ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({
        date: String(row.day ?? "").slice(0, 10),
        orders: Number(row.orders),
        repeat: Number(row.repeat_orders),
      }))
      .filter(
        (row) =>
          /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
          Number.isFinite(row.orders) &&
          Number.isFinite(row.repeat),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    return { status: "ok", days };
  } catch {
    return { status: "error", days: [] };
  }
}
