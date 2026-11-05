// Hechos anónimos de los pedidos de iComfly para Marketing (05/11/2026):
// cancelaciones (M7), origen y complementos (M8), referencias del simulador
// (M10) y provincias (M12).
//
// Cada pedido queda como una tupla [día CR, estado, código de motivo, origen,
// provincia, productos]. Nunca sale el texto libre del motivo, ni nombre,
// teléfono, dirección o número del pedido.
//
// Puro: se prueba en tests/marketing-order-facts.test.ts.
import { motivoMarketing } from "./anulacion-motivos";
import { provinceOf } from "./cr-provinces";
import { etapaVentaIcomfly } from "./icomfly-estado-venta";
import { marketingDate } from "./marketing-dates";
import { normalProductName } from "./marketing-product-families";
import { baseProductName } from "./marketing-product-groups-server";
import type {
  FactState,
  OrderFactRow,
  OrderFactsPayload,
  OrderOrigin,
} from "./marketing-insights-types";

/** Selected JSON paths of one iComfly payload (never phone, name or address). */
export interface RawOrderFact {
  created_at: string | null;
  status: string | null;
  cancelled_at: string | null;
  reason: string | null;
  sales_channel: string | null;
  labels: unknown;
  creator: string | null;
  department: string | null;
  city: string | null;
  shopify_number: string | null;
  items: unknown;
  product_name: string | null;
}

const norm = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Label names of the payload (`[{id,name}]`), normalized. */
export function labelNames(labels: unknown): string[] {
  return (Array.isArray(labels) ? labels : [])
    .map((label) =>
      norm(
        label && typeof label === "object"
          ? (label as { name?: unknown }).name
          : label,
      ),
    )
    .filter(Boolean);
}

/**
 * Where the order came from. Precedence: Shopify number → Shopify; label
 * "Carrito abandonado recuperado" → carrito; label "Venta por bot" or channel
 * whatsapp → bot; creator "Conector IA" → ia; any other creator → asesora;
 * else the iComfly web form. Labels by name, not id.
 */
export function orderOrigin(signals: {
  shopifyNumber: string | null;
  labels: string[];
  salesChannel: string | null;
  creator: string | null;
}): OrderOrigin {
  if (String(signals.shopifyNumber ?? "").trim()) return "shopify";
  const labels = signals.labels.map(norm);
  if (labels.some((l) => l.includes("carrito abandonado recuperado")))
    return "carrito";
  if (
    labels.some((l) => l.includes("venta por bot")) ||
    norm(signals.salesChannel) === "whatsapp"
  )
    return "bot";
  const creator = norm(signals.creator);
  if (creator === "conector ia") return "ia";
  if (creator) return "asesora";
  return "formulario";
}

/** Product name without variant suffixes ("- Beige / Talla única", "(Talla única)"). */
export function factProductBase(name: string): string {
  return baseProductName(name)
    .replace(/\s*\((?:talla|color|size)[^)]*\)\s*$/i, "")
    .replace(/\s*[-–—]\s*talla\s*:?\s*talla\s+[úu]nica\s*$/i, "")
    .replace(/\s*[-–—]\s*talla\s+[úu]nica\s*$/i, "")
    .trim();
}

/** Short display name: cut at the first " – ", " - " or " (", max 60 chars. */
export function productDisplayName(name: string): string {
  const full = name.trim();
  const cut = full.split(/\s[-–—]\s|\s\(/)[0].trim() || full;
  return cut.length > 60 ? `${cut.slice(0, 59).trimEnd()}…` : cut;
}

/** Distinct product names in line order; `product_name` ("1x A, 1x B") when items are empty. */
export function orderProductNames(
  items: unknown,
  productName: string | null,
): string[] {
  const names: string[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = String(record.product_name || record.name || "").trim();
    if (name) names.push(name);
  }
  if (!names.length && productName?.trim()) {
    const text = productName.trim();
    const parts = /^\d+\s*x\s/i.test(text)
      ? text.split(/,\s*(?=\d+\s*x\s)/i)
      : [text];
    for (const part of parts) {
      const name = part.replace(/^\d+\s*x\s+/i, "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Today's iComfly status wins, as in Gestión: a Confirmada/Entregado/Devolución
 * order with `cancelled_at` is not annulled, and Testeos/Producto Agotado with
 * `cancelled_at` do not count. `cancelled_at` only decides while the order has
 * no status or is still in gestión.
 */
export function factState(
  row: Pick<RawOrderFact, "status" | "cancelled_at">,
): FactState {
  const etapa = etapaVentaIcomfly(row.status);
  if (etapa === "confirmado") return 0;
  if (etapa === "no_cuenta") return 2;
  if (etapa === "anulado") return 1;
  return String(row.cancelled_at ?? "").trim() ? 1 : 0;
}

/**
 * Encodes the rows of `[loadedFrom, to]` (CR dates). `repeat` and `truncated`
 * are filled by the server.
 */
export function encodeOrderFacts(
  rows: RawOrderFact[],
  range: { from: string; to: string; loadedFrom: string; today: string },
  now: Date,
): Omit<OrderFactsPayload, "repeat" | "truncated"> {
  const products: string[] = [],
    titles: string[] = [];
  const index = new Map<string, number>();
  const productIndex = (name: string) => {
    const base = factProductBase(name) || name.trim();
    const key = normalProductName(base);
    let at = index.get(key);
    if (at === undefined) {
      at = products.length;
      index.set(key, at);
      products.push(productDisplayName(base));
      titles.push(base.slice(0, 300));
    }
    return at;
  };
  const facts: Array<{ time: number; fact: OrderFactRow }> = [];
  for (const row of rows) {
    const time = Date.parse(String(row.created_at ?? ""));
    if (!Number.isFinite(time)) continue;
    const date = marketingDate(new Date(time));
    if (date < range.loadedFrom || date > range.to) continue;
    const state = factState(row);
    const items: number[] = [];
    for (const name of orderProductNames(row.items, row.product_name)) {
      const at = productIndex(name);
      if (!items.includes(at)) items.push(at);
    }
    facts.push({
      time,
      fact: [
        date,
        state,
        state === 1 ? motivoMarketing(row.reason) : "",
        orderOrigin({
          shopifyNumber: row.shopify_number,
          labels: labelNames(row.labels),
          salesChannel: row.sales_channel,
          creator: row.creator,
        }),
        provinceOf(row.department, row.city) ?? "",
        items,
      ],
    });
  }
  facts.sort((a, b) => a.time - b.time);
  return {
    from: range.from,
    to: range.to,
    today: range.today,
    generatedAt: now.toISOString(),
    loadedFrom: range.loadedFrom,
    products,
    titles,
    facts: facts.map((entry) => entry.fact),
  };
}
