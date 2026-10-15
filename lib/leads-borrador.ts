// Cuando se puede convertir el borrador de un cliente en pedido.
//
// Accion hacia afuera: crea un pedido REAL que va a despacho. Las reglas viven
// aca, sin base ni Shopify, y se prueban en tests/leads-borrador.test.ts.

import type { ShopifyDraftOrderDetail } from "./shopify";

export interface LeadParaBorrador {
  has_order: boolean;
  shopify_order_name: string | null;
}

/** null si se puede generar; si no, por que no (para mostrarle a la asesora). */
export function problemaParaGenerar(lead: LeadParaBorrador, draft: ShopifyDraftOrderDetail): string | null {
  if (draft.status === "completed" || draft.order_id) {
    return `El borrador ${draft.name} ya se convirtió en pedido.`;
  }
  if (lead.has_order) {
    const cual = lead.shopify_order_name ? ` (${lead.shopify_order_name})` : "";
    return `Este cliente ya tiene un pedido${cual}. Si quiere otro, créalo con «Crear pedido».`;
  }
  if (!draft.line_items?.length) {
    return `El borrador ${draft.name} no tiene productos.`;
  }
  if (!String(draft.shipping_address?.address1 ?? "").trim()) {
    return `El borrador ${draft.name} no tiene dirección de envío. Complétala en Shopify o crea el pedido con «Crear pedido».`;
  }
  return null;
}

/** La nota del borrador mas la linea de Kairo (sin perder lo que ya tenia). */
export function notaDelPedido(notaPrevia: string | null, quien: string, fecha: Date): string {
  const dia = fecha.toLocaleDateString("es-CR", { timeZone: "America/Costa_Rica", day: "2-digit", month: "2-digit", year: "numeric" });
  const linea = `Generado desde el borrador por ${quien || "la asesora"} en Kairo (tablero de Leads) el ${dia}: el cliente confirmó por WhatsApp. Pago contra entrega.`;
  const previa = String(notaPrevia ?? "").trim();
  return previa ? `${previa}\n${linea}` : linea;
}

/** Las etiquetas del borrador mas las de Kairo, sin repetir. */
export function etiquetasDelPedido(previas: string | null | undefined): string {
  const set = new Set(
    String(previas ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  );
  for (const t of ["cerrado_por_asesora", "kairo_leads", "desde_borrador"]) set.add(t);
  return Array.from(set).join(", ");
}
