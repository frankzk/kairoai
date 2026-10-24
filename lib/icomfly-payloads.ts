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

// iComfly puede responder con pedidos de OTRA tienda: si el usuario de la API
// no ve la tienda pedida, contesta con la que si ve. Asi Honduras guardo los
// pedidos de Costa Rica (tienda 71) desde julio. Cada pedido crudo trae su
// `store_id`: se queda solo lo de la tienda pedida. Lo que no trae tienda se
// acepta, no hay con que compararlo.
export interface PaginaDeLaTienda {
  orders: NormalizedIcomflyOrder[];
  raw: unknown[];
  ajenos: number;
  /** "71 (Mireva Costa Rica)": de donde vino lo descartado, para el error. */
  tiendasAjenas: string[];
}

export function deLaTienda(
  externalStoreId: number,
  orders: NormalizedIcomflyOrder[],
  raw: unknown[]
): PaginaDeLaTienda {
  const pagina: PaginaDeLaTienda = { orders: [], raw: [], ajenos: 0, tiendasAjenas: [] };
  const ajenas = new Set<string>();
  orders.forEach((order, i) => {
    const crudo = raw[i];
    const datos = crudo && typeof crudo === "object" && !Array.isArray(crudo) ? (crudo as Record<string, unknown>) : {};
    const tienda = datos.store_id == null || datos.store_id === "" ? NaN : Number(datos.store_id);
    if (Number.isFinite(tienda) && tienda !== externalStoreId) {
      pagina.ajenos += 1;
      const nombre = typeof datos.store_name === "string" && datos.store_name ? ` (${datos.store_name})` : "";
      ajenas.add(`${tienda}${nombre}`);
      return;
    }
    pagina.orders.push(order);
    pagina.raw.push(crudo);
  });
  pagina.tiendasAjenas = Array.from(ajenas);
  return pagina;
}
