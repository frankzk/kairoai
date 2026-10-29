import { verifyCreatedIcomflyOrder } from "@/lib/icomfly-confirmation";
import { getIcomflyExternalStoreId } from "@/lib/icomfly";
import { llamarHerramientaIcomfly, tiendaDeLaConexion } from "@/lib/icomfly-mcp";
import type { ExpectedIcomflyOrder } from "@/lib/icomfly-manual-order";
import type { FinanceStoreCode } from "@/lib/store-config";

const cents = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? NaN : Math.round(Number(value) * 100);

/** Native cart creation can ignore discountAmount and recalculate the gross total.
 * Reconcile the known receipt only; never create again, dispatch, or overwrite a
 * different amount entered by an operator. A timeout is resolved by reading again.
 */
export async function ensureManualOrderDiscount(store: FinanceStoreCode, id: string, expected: ExpectedIcomflyOrder): Promise<void> {
  const adjustment = expected.discount_adjustment;
  if (!adjustment) return;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || !Number.isFinite(expected.total) ||
    expected.total < 0 || !Number.isFinite(adjustment.subtotal) || adjustment.subtotal <= expected.total) {
    throw new Error("Importes de verificación inválidos.");
  }
  // Confirm store, reference and complete catalog lines with an independent read.
  const connection = await tiendaDeLaConexion(store);
  const externalStore = getIcomflyExternalStoreId(store);
  if (externalStore == null || connection.id == null || connection.id !== externalStore) throw new Error("No se pudo verificar la tienda del descuento.");
  const found = await verifyCreatedIcomflyOrder(store, id, expected) ??
    await verifyCreatedIcomflyOrder(store, id, { ...expected, total: adjustment.subtotal });
  if (!found || found.orderNumber !== adjustment.order_number) throw new Error("El pedido no coincide con el intento original.");
  const read = async () => {
    const detail = await llamarHerramientaIcomfly(store, "detalle_pedido", { identificador: id });
    const order = detail.pedido as Record<string, unknown> | undefined;
    if (!order || String(order.id) !== id || order.order_number !== adjustment.order_number) throw new Error("No se pudo verificar el pedido del descuento.");
    return order;
  };
  const order = await read();
  const target = cents(expected.total);
  const correctCollection = !adjustment.cod || (order.tipo_recaudo === "con_recaudo" && cents(order.valor_a_recaudar) === target);
  if (cents(order.total) === target && correctCollection) return;
  if (order.status !== "Pendiente" || order.tracking_number || order.carrier_name || order.tracking_status ||
    (adjustment.cod && order.tipo_recaudo != null && order.tipo_recaudo !== "con_recaudo") ||
    ![target, cents(adjustment.subtotal)].includes(cents(order.total))) {
    throw new Error("El pedido cambió o ya salió de pendientes; revisa el descuento sin volver a crearlo.");
  }
  if (cents(order.total) !== target) {
    await llamarHerramientaIcomfly(store, "actualizar_pedido", { order_id: Number(id), total: expected.total });
  }
  // Do not mark a transfer as paid. COD reconciliation only applies to COD orders.
  if (adjustment.cod) {
    await llamarHerramientaIcomfly(store, "definir_tipo_recaudo", { order_id: Number(id), tipo_recaudo: "contra_entrega" });
  }
  const after = await read();
  if (cents(after.total) !== target || (adjustment.cod && (after.tipo_recaudo !== "con_recaudo" || cents(after.valor_a_recaudar) !== target))) {
    throw new Error("iComfly todavía no confirma el importe y el recaudo acordados.");
  }
}
