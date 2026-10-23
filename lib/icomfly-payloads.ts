// El pedido de iComfly completo, emparejado con su id (migracion 0050).
//
// listOrdersWithAttribution devuelve `orders` (normalizados) y `raw` (lo que
// dio la API) en el MISMO orden: orders = raw.map(normalize). Aca se arma la
// fila de icomfly_order_payloads con el id ya normalizado y el objeto crudo.

import type { NormalizedIcomflyOrder } from "@/lib/dispatch";

export interface IcomflyPayloadRow {
  store_id: number;
  icomfly_order_id: string;
  payload: Record<string, unknown>;
}

export function filasDePayload(
  storeId: number,
  orders: NormalizedIcomflyOrder[],
  raw: unknown[]
): IcomflyPayloadRow[] {
  const filas = new Map<string, IcomflyPayloadRow>();
  orders.forEach((order, i) => {
    const payload = raw[i];
    if (!order.icomflyOrderId || !payload || typeof payload !== "object" || Array.isArray(payload)) return;
    // Un mismo pedido en dos paginas (la lista se mueve mientras se pagina):
    // queda la ultima version vista.
    filas.set(order.icomflyOrderId, {
      store_id: storeId,
      icomfly_order_id: order.icomflyOrderId,
      payload: payload as Record<string, unknown>,
    });
  });
  return Array.from(filas.values());
}
