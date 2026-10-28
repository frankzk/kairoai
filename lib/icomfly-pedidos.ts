// Pedidos que existen solo en iComfly, como pedidos de Kairo.
//
// Desde el 28/10/2026 Shopify se suspende y la venta sigue por las paginas de
// iComfly: esos pedidos no llegan a shopify_orders y Pedidos, la cola de
// confirmacion y los KPI no los verian. Aca el pedido completo de iComfly
// (icomfly_order_payloads, migracion 0050) se vuelve un ShopifyOrderSummary y
// el dataset lo trata como cualquier pedido sin fila logistica.
//
// Cuando NO se agrega, para no contar dos veces:
//   - Si Shopify ya tiene el pedido: por su numero (#MCRC...) o por la guia.
//     iComfly no guardo el numero de Shopify en ~2.200 pedidos de junio a
//     septiembre, pero 1.591 de los 1.600 con guia estan en Shopify con esa
//     misma guia (medido el 24/10/2026).
//   - Si es anterior al CORTE: desde la semana del 05/10/2026 todo pedido de
//     iComfly trae su numero de Shopify (solo 5 cancelados no), asi que lo de
//     antes ya esta en Shopify aunque no se pueda cruzar.
//   - Los "Testeos" de iComfly.
//
// Nombre: el numero de Shopify si iComfly lo trae (y Shopify todavia no llego
// a la base: la bitacora de la cola sigue en el mismo pedido cuando llega). Si
// no, "IC-" + el numero de iComfly: un numero a secas cruzaria por casualidad
// con los codigos de Boxful (ver getShopifyDirectOrderMatchKeys). Los de la
// pagina web de iComfly llevan el numero que iComfly muestra (#15 -> "IC-W15"):
// su order_number es un codigo de 18 digitos que nadie ve. La "W" los separa
// de los numeros propios de iComfly (de 3.007 a 99.987, medido el 24/10/2026):
// "IC-15" chocaria con el pedido 15 en cuanto la web llegue a esos numeros.
// Los que crea Kairo (Leads, lib/icomfly-pedido-lead.ts) traen un codigo
// interno: "EXCEL-MVMPVFBE-1UNUD" hasta el 25/10/2026 y "MANUAL-1792993355514-
// C6KQC" desde el 26/10 (el panel los muestra "Manual #746359"). Van con el id
// de iComfly ("IC-746359"), que es el numero que se ve y se busca en iComfly.
//
// Puro: se prueba en tests/icomfly-pedidos.test.ts.

import type { ProductLineItem, ShopifyOrderSummary } from "@/lib/finance-orders";
import { normalizeMatchKey } from "@/lib/order-matching";
import { getFinanceStoreById } from "@/lib/store-config";

export const CORTE_PEDIDOS_ICOMFLY = "2026-10-05";

/** Desde cuando una tienda toma los pedidos que estan solo en iComfly. */
export function corteIcomflyDe(storeId: number): string {
  return getFinanceStoreById(storeId)?.pedidosIcomflyDesde ?? CORTE_PEDIDOS_ICOMFLY;
}

/** Lo que el dataset lee de cada pedido completo (columnas JSON, no el objeto entero). */
export interface PedidoIcomflyCrudo {
  id?: unknown;
  order_number?: unknown;
  shopify_display_number?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  cancelled_at?: unknown;
  total?: unknown;
  customer?: unknown;
  shipping?: unknown;
  shipping_name?: unknown;
  shipping_phone?: unknown;
  items?: unknown;
  product_name?: unknown;
  quantity?: unknown;
  product_price?: unknown;
  carrier_name?: unknown;
  tracking_number?: unknown;
  store_web_seq?: unknown;
}

/** Las columnas JSON de icomfly_order_payloads que llenan PedidoIcomflyCrudo (el objeto entero pesa ~5 KB). */
export const COLUMNAS_PEDIDO_ICOMFLY = [
  "id:payload->>id",
  "order_number:payload->>order_number",
  "shopify_display_number:payload->>shopify_display_number",
  "status:payload->>status",
  "created_at:payload->>created_at",
  "updated_at:payload->>updated_at",
  "cancelled_at:payload->>cancelled_at",
  "total:payload->>total",
  "customer:payload->customer",
  "shipping:payload->shipping",
  "shipping_name:payload->>shipping_name",
  "shipping_phone:payload->>shipping_phone",
  "items:payload->items",
  "product_name:payload->>product_name",
  "quantity:payload->>quantity",
  "product_price:payload->>product_price",
  "carrier_name:payload->>carrier_name",
  "tracking_number:payload->>tracking_number",
  "store_web_seq:payload->>store_web_seq",
].join(",");

function texto(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function numero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Los pedidos de la pagina web de iComfly traen un cliente generico ("Cliente
// Shopify"); el nombre real es el del envio, el que se escribio en ese pedido.
const NOMBRES_GENERICOS = /^(cliente shopify|sin nombre|cliente)$/i;

/** El nombre del envio primero (el de ESTE pedido); el del cliente si no hay. Sin genericos. */
export function nombreCliente(...candidatos: unknown[]): string {
  return candidatos.map(texto).find((n) => n && !NOMBRES_GENERICOS.test(n)) ?? "";
}

export function nombrePedidoIcomfly(orderNumber: unknown, id: unknown, webSeq?: unknown): string {
  const web = texto(webSeq);
  if (/^\d+$/.test(web)) return `IC-W${web}`;
  const propio = texto(orderNumber).replace(/^#/, "");
  return `IC-${(propio && !/^(EXCEL|MANUAL)-/i.test(propio) ? propio : "") || texto(id)}`;
}

/** El estado final que iComfly ya conoce. Vacio si no es final: lo decide el courier. */
export function estadoFinalIcomfly(status: string): "delivered" | "not_delivered" | "" {
  const s = status.trim().toLowerCase();
  if (s === "entregado") return "delivered";
  if (s === "devolucion" || s === "devolución") return "not_delivered";
  return "";
}

function claveProducto(nombre: unknown): string {
  return texto(nombre)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function itemsCrudos(p: PedidoIcomflyCrudo): Array<Record<string, unknown>> {
  return Array.isArray(p.items) ? (p.items as Array<Record<string, unknown>>).filter((i) => i && typeof i === "object") : [];
}

/**
 * El SKU de Shopify de cada producto de iComfly, aprendido de los pedidos que
 * estan en los dos con un solo producto de cada lado (gana el SKU mas visto).
 * iComfly no trae SKU y los costos se cargaron por SKU: sin esto el margen de
 * los pedidos de iComfly tenia costo para el 41% de las unidades, contra el
 * 50% de los de Shopify; con esto, 49% (Costa Rica desde el 05/10, medido el
 * 24/10/2026). Un producto nuevo despues del 28/10 no tiene par: su costo se
 * busca por nombre, como hasta ahora.
 */
export function skusPorProducto(
  crudos: PedidoIcomflyCrudo[],
  shopifyOrders: Pick<ShopifyOrderSummary, "name" | "line_items">[]
): Map<string, string> {
  const porNombre = new Map(shopifyOrders.map((o) => [normalizeMatchKey(o.name), o]));
  const conteo = new Map<string, Map<string, number>>();
  for (const p of crudos) {
    const shopify = porNombre.get(normalizeMatchKey(texto(p.shopify_display_number)));
    const items = itemsCrudos(p);
    if (!shopify || items.length !== 1 || shopify.line_items.length !== 1) continue;
    const sku = texto(shopify.line_items[0].sku).toLowerCase();
    const producto = claveProducto(items[0].product_name || items[0].name);
    if (!sku || !producto) continue;
    const skus = conteo.get(producto) ?? new Map<string, number>();
    skus.set(sku, (skus.get(sku) ?? 0) + 1);
    conteo.set(producto, skus);
  }
  const out = new Map<string, string>();
  conteo.forEach((skus, producto) => {
    out.set(producto, Array.from(skus.entries()).sort((a, b) => b[1] - a[1])[0][0]);
  });
  return out;
}

function lineas(p: PedidoIcomflyCrudo, skus?: Map<string, string>): ProductLineItem[] {
  const desdeItems = itemsCrudos(p)
    .map((item) => {
      const variante = texto(item.variant_label) || texto(item.variant_name);
      const nombre = texto(item.product_name) || texto(item.name);
      return {
        sku: skus?.get(claveProducto(nombre)) ?? "",
        title: variante ? `${nombre} - ${variante}` : nombre,
        quantity: numero(item.quantity) || 1,
        price: numero(item.product_price),
      };
    })
    .filter((item) => item.title);
  if (desdeItems.length) return desdeItems;
  const nombre = texto(p.product_name);
  return nombre
    ? [{ sku: skus?.get(claveProducto(nombre)) ?? "", title: nombre, quantity: numero(p.quantity) || 1, price: numero(p.product_price) }]
    : [];
}

export function pedidosDeIcomfly(
  crudos: PedidoIcomflyCrudo[],
  shopifyOrders: Pick<ShopifyOrderSummary, "name" | "order_number" | "tracking_number">[],
  opts: { currency: string; corte?: string; skus?: Map<string, string> }
): ShopifyOrderSummary[] {
  const corte = opts.corte ?? CORTE_PEDIDOS_ICOMFLY;
  const enShopify = new Set<string>();
  const guiasShopify = new Set<string>();
  for (const order of shopifyOrders) {
    enShopify.add(normalizeMatchKey(order.name));
    if (order.order_number) enShopify.add(normalizeMatchKey(`#MCRC${order.order_number}`));
    const guia = texto(order.tracking_number).toUpperCase();
    if (guia) guiasShopify.add(guia);
  }

  const vistos = new Set<string>();
  const out: ShopifyOrderSummary[] = [];
  for (const p of crudos) {
    const id = texto(p.id);
    const creado = texto(p.created_at);
    const estado = texto(p.status);
    if (!id || vistos.has(id) || !creado || creado < corte) continue;
    if (estado.toLowerCase().includes("testeo")) continue;
    const shopify = texto(p.shopify_display_number);
    if (shopify && enShopify.has(normalizeMatchKey(shopify))) continue;
    const guia = texto(p.tracking_number);
    if (guia && guiasShopify.has(guia.toUpperCase())) continue;
    vistos.add(id);

    const cliente = p.customer && typeof p.customer === "object" ? (p.customer as Record<string, unknown>) : {};
    const items = lineas(p, opts.skus);
    const total = numero(p.total);
    const cancelado =
      texto(p.cancelled_at) || (estado.toLowerCase() === "cancelado" ? texto(p.updated_at) || creado : "");
    out.push({
      id: `icomfly-${id}`,
      order_number: 0,
      name: shopify || nombrePedidoIcomfly(p.order_number, id, p.store_web_seq),
      customer_name: nombreCliente(p.shipping_name, cliente.fullName) || "Sin nombre",
      last_name: "",
      phone: texto(cliente.phone) || texto(p.shipping_phone) || texto(cliente.whatsapp) || null,
      products: items.map((item) => `${item.quantity}x ${item.title}`).join(", "),
      total: `${total} ${opts.currency}`,
      total_price: total,
      currency: opts.currency,
      financial_status: "pending",
      fulfillment_status: guia ? "fulfilled" : null,
      cancelled_at: cancelado || null,
      // Las notas de iComfly NO van a `note`: 17 de cada 520 traen "pedido
      // NNN" y el emparejamiento toma eso como alias explicito de otro pedido.
      note: "",
      note_attributes: [],
      tracking_number: guia,
      tracking_company: texto(p.carrier_name),
      created_at: creado,
      line_items: items,
      icomfly: { id, estado },
    });
  }
  return out;
}

/** Direccion de entrega en una linea, como la de Shopify en el historial del cliente. */
export function direccionIcomfly(p: Pick<PedidoIcomflyCrudo, "shipping" | "customer">): string {
  const envio = p.shipping && typeof p.shipping === "object" ? (p.shipping as Record<string, unknown>) : {};
  const cliente = p.customer && typeof p.customer === "object" ? (p.customer as Record<string, unknown>) : {};
  const de = (key: string, ...alt: string[]) =>
    [key, ...alt].map((k) => texto(envio[k]) || texto(cliente[k])).find(Boolean) ?? "";
  return [de("address"), de("district"), de("city"), de("province", "department")].filter(Boolean).join(", ");
}

/** El id que lleva un pedido de iComfly en lugar del de Shopify ("icomfly-<id>"). */
export function esPedidoIcomfly(shopifyOrderId: string | null | undefined): boolean {
  return String(shopifyOrderId ?? "").startsWith("icomfly-");
}
