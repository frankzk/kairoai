// En qué punto de la venta está un pedido según su estado en iComfly
// (04/11/2026), para la tasa de confirmación de Gestión.
//
// La tasa de confirmación es CONFIRMADOS ÷ GENERADOS. Confirmar no es
// despachar: un pedido confirmado puede quedarse sin guía por falta de stock,
// error de almacén o retraso. Por eso no se mide con la guía, sino con el
// estado que tiene hoy en iComfly. Se lee el estado y no confirmed_at porque
// iComfly no registra siempre quién confirmó: en octubre, solo 198 de 433
// confirmados tenían confirmed_at.
//
// iComfly guarda un solo estado por pedido, que mezcla venta y transporte:
//   - confirmado: Confirmada, y todo lo que viene después (Enviada, Guia_Generada,
//     En_Transito, En_Reparto, Entregado, Novedad, Devolucion, Devuelto, Reclame_Oficina) y Pedido Pagado.
//     "Enviada" es "mandado a Boxful": puede no tener guía todavía.
//   - en gestión: Pendiente, Comprar Después, Modificar Dirección/Pedido,
//     desea pago tarjeta, quiere coordinar entrega... La asesora sigue trabajando.
//   - no cuenta: Testeos y Producto Agotado. No eran ventas que se pudieran
//     confirmar; quedan fuera de la base, igual que los anulados por duplicado,
//     lista negra, etc. (lib/anulacion-motivos.ts).
//   - anulado: Cancelado.
// Es el estado de hoy: si un pedido se confirmó y después se anuló, cuenta como
// anulado. Así se cumple confirmados + anulados + en gestión = generados.
//
// Puro: se prueba en tests/icomfly-estado-venta.test.ts.

export type EtapaVenta = "confirmado" | "en_gestion" | "no_cuenta" | "anulado";

/** "Guía Generada", "guia_generada", "En reparto" -> "guia_generada", "en_reparto". */
export function claveEstado(estado: string | null | undefined): string {
  return String(estado ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}

const CONFIRMADO = new Set([
  "confirmada",
  "confirmado",
  "enviada",
  "enviado",
  "guia_generada",
  "en_transito",
  "en_reparto",
  "entregado",
  "entregada",
  "novedad",
  "novedad_operativa",
  "devolucion",
  "devuelto",
  "devuelta",
  "reclame_oficina",
  // Pagado por adelantado: venta confirmada aunque no tenga guia todavia.
  "pedido_pagado",
]);
const NO_CUENTA = new Set(["testeos", "testeo", "producto_agotado"]);
const ANULADO = new Set(["cancelado", "cancelada", "anulado", "anulada"]);

/** La etapa de venta del pedido según su estado en iComfly. Sin estado: null. */
export function etapaVentaIcomfly(estado: string | null | undefined): EtapaVenta | null {
  const clave = claveEstado(estado);
  if (!clave) return null;
  if (CONFIRMADO.has(clave)) return "confirmado";
  if (ANULADO.has(clave)) return "anulado";
  if (NO_CUENTA.has(clave)) return "no_cuenta";
  return "en_gestion";
}

/** "Enviada" (mandado a Boxful): confirmado, pero la guía puede no haber llegado. */
export function esEnviadaIcomfly(estado: string | null | undefined): boolean {
  const clave = claveEstado(estado);
  return clave === "enviada" || clave === "enviado";
}

/** Venta confirmada que aun no acredita envio a Boxful ni transporte. */
export function esConfirmadaIcomfly(estado: string | null | undefined): boolean {
  return ["confirmada", "confirmado", "pedido_pagado"].includes(claveEstado(estado));
}
