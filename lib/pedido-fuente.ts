// De donde llego cada pedido, segun iComfly (icomfly_order_payloads):
// - Web: compra en la tienda web ("#179...", o "SHOP-..." que venia de Shopify).
// - WhatsApp: sales_channel "whatsapp" (venta en el chat / bot).
// - Llamadas (Leads): "MANUAL-..." creado por el "Conector IA", que es el boton
//   "Crear en iComfly" de Leads en Kairo (lib/icomfly-manual-order.ts).
// - Manual: "MANUAL-..." que una asesora creo a mano en iComfly.
// Los pedidos de Shopify sin pareja en iComfly (antes del 28/10) son de la web.
//
// Puro: se prueba en tests/pedido-fuente.test.ts.

export const FUENTES = [
  { key: "web", label: "Web", color: "var(--mk-series-1)" },
  { key: "whatsapp", label: "WhatsApp", color: "var(--mk-series-2)" },
  { key: "leads", label: "Llamadas (Leads)", color: "var(--mk-series-3)" },
  { key: "manual", label: "Manual en iComfly", color: "var(--mk-series-4)" },
] as const;

export type Fuente = (typeof FUENTES)[number]["key"];

export const CONECTOR_KAIRO = "Conector IA";

export function fuenteDePedido(p: { orderNumber?: string | null; salesChannel?: string | null; creo?: string | null }): Fuente {
  if (String(p.salesChannel ?? "").trim().toLowerCase() === "whatsapp") return "whatsapp";
  const numero = String(p.orderNumber ?? "").trim().toUpperCase();
  if (numero.startsWith("MANUAL")) return String(p.creo ?? "").trim() === CONECTOR_KAIRO ? "leads" : "manual";
  if (numero.startsWith("#") || numero.startsWith("SHOP-")) return "web";
  // Sin canal ni prefijo conocido: lo creo una persona en iComfly.
  return "manual";
}

export const fuentesVacias = (): Record<Fuente, number> => ({ web: 0, whatsapp: 0, leads: 0, manual: 0 });
