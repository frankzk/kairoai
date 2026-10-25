// Permisos que Kairo le pide a la app de Shopify de cada tienda
// (/api/shopify/auth).
//
// Las tiendas de Kairo necesitan escribir (notas y borradores de pedidos desde
// Leads). Las de solo respaldo (lib/stores.ts) solo leen: es lo unico que
// hacen hasta que Shopify cierre. Todas con read_all_orders: sin el, el API
// solo da los ultimos 60 dias de pedidos (en el Dev Dashboard hay que
// escribirlo a mano en los alcances; no esta en la lista).
//
// Lo de "respaldo" es lo que pide lib/shopify-archivo.ts ademas de pedidos,
// clientes y productos: contenido (paginas, blog, redirecciones), descuentos,
// inventario y bodegas, tema, menus, envios, traducciones y metaobjetos.

import { esSoloRespaldo, type TiendaShopify } from "@/lib/stores";

const LECTURA_BASE = [
  "read_products",
  "read_orders",
  "read_all_orders",
  "read_draft_orders",
  "read_customers",
  "read_checkouts",
  // Fulfillments/tracking: sin estos scopes, order.fulfillments vuelve vacio
  // para pedidos despachados por apps/3PL (bot, Boxful) y NO se captura la guia
  // aunque Shopify marque el pedido como "fulfilled".
  "read_fulfillments",
  "read_merchant_managed_fulfillment_orders",
  "read_assigned_fulfillment_orders",
  "read_third_party_fulfillment_orders",
];

export const SCOPES_RESPALDO = [
  "read_inventory",
  "read_locations",
  "read_price_rules",
  "read_content",
  "read_online_store_pages",
  "read_online_store_navigation",
  "read_themes",
  "read_shipping",
  "read_translations",
  "read_metaobjects",
];

const ESCRITURA_KAIRO = ["write_orders", "write_draft_orders"];

export function scopesParaTienda(store: Pick<TiendaShopify, "code">): string[] {
  return esSoloRespaldo(store)
    ? [...LECTURA_BASE, ...SCOPES_RESPALDO]
    : [...LECTURA_BASE, ...ESCRITURA_KAIRO, ...SCOPES_RESPALDO];
}
