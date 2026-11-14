// Historial de entrega por cliente (como el globo "Entregas por transportadora"
// de iComfly): de los OTROS pedidos con el mismo telefono, cuantos se
// entregaron, se devolvieron, siguen en camino, no se despacharon o se
// cancelaron, y como le fue con cada transportadora. Sirve para decidir si se
// le despacha a un cliente que ya devolvio.
//
// Puro: se prueba en tests/cliente-historial.test.ts.

import { isDispatchedStatus, resolveCourierFamily, type TrackableOrderRow } from "./finance-orders";
import { etapaVentaIcomfly } from "./icomfly-estado-venta";

export interface ClienteHistorialCourier {
  id: string;
  label: string;
  entregados: number;
  devueltos: number;
}

export type ClienteRiesgo = "nuevo" | "confiable" | "atencion" | "riesgo";

export interface ClienteHistorial {
  /** Otros pedidos del cliente (sin contar el de la fila). */
  total: number;
  entregados: number;
  devueltos: number;
  enCamino: number;
  sinDespachar: number;
  cancelados: number;
  /** Entregados / (entregados + devueltos) en %, null si nada se resolvio. */
  tasa: number | null;
  riesgo: ClienteRiesgo;
  couriers: ClienteHistorialCourier[];
}

type Fila = Pick<TrackableOrderRow, "row_key" | "guide_number" | "courier" | "icomfly_estado" | "anulacion_excluida">;
export type Estado = "entregado" | "devuelto" | "en_camino" | "sin_despachar" | "cancelado" | null;

/** En que cubeta cae un pedido segun su estado de hoy. null = no cuenta (duplicado, testeo...). */
export function estadoParaHistorial(row: Fila, status: string): Estado {
  if (status === "delivered") return "entregado";
  if (status === "not_delivered" || status === "returned") return "devuelto";
  const courierAnnulled = status === "annulled";
  const despachado = !courierAnnulled && (Boolean(row.guide_number) || isDispatchedStatus(status) || status === "recolectado");
  if (despachado) return "en_camino";
  const etapa = etapaVentaIcomfly(row.icomfly_estado);
  if (courierAnnulled || etapa === "anulado") return row.anulacion_excluida ? null : "cancelado";
  if (etapa === "no_cuenta") return null;
  return "sin_despachar";
}

export function riesgoCliente(entregados: number, devueltos: number): ClienteRiesgo {
  if (entregados + devueltos === 0) return "nuevo";
  if (devueltos === 0) return "confiable";
  if (devueltos >= 2 && devueltos >= entregados) return "riesgo";
  return devueltos > entregados ? "riesgo" : "atencion";
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Resume el historial de un cliente con sus pedidos (ya sin el de la fila). */
export function resumirHistorial(pedidos: Array<{ row: Fila; status: string }>): ClienteHistorial {
  const out: ClienteHistorial = { total: 0, entregados: 0, devueltos: 0, enCamino: 0, sinDespachar: 0, cancelados: 0, tasa: null, riesgo: "nuevo", couriers: [] };
  const porCourier = new Map<string, ClienteHistorialCourier>();
  for (const { row, status } of pedidos) {
    const estado = estadoParaHistorial(row, status);
    if (!estado) continue;
    out.total += 1;
    if (estado === "entregado") out.entregados += 1;
    else if (estado === "devuelto") out.devueltos += 1;
    else if (estado === "en_camino") out.enCamino += 1;
    else if (estado === "sin_despachar") out.sinDespachar += 1;
    else out.cancelados += 1;
    if (estado === "entregado" || estado === "devuelto") {
      const family = resolveCourierFamily(row.courier, String(row.guide_number ?? "")) ?? { id: "otro", label: "Sin transportadora" };
      const c = porCourier.get(family.id) ?? { id: family.id, label: family.label, entregados: 0, devueltos: 0 };
      if (estado === "entregado") c.entregados += 1;
      else c.devueltos += 1;
      porCourier.set(family.id, c);
    }
  }
  out.tasa = pct(out.entregados, out.entregados + out.devueltos);
  out.riesgo = riesgoCliente(out.entregados, out.devueltos);
  out.couriers = Array.from(porCourier.values()).sort((a, b) => b.entregados + b.devueltos - (a.entregados + a.devueltos) || a.label.localeCompare(b.label));
  return out;
}

/**
 * Historial de cada fila pedida (por row_key), buscando en `todas` los otros
 * pedidos con el mismo telefono normalizado. `resolver` da el estado de hoy de
 * cada pedido; solo se llama para los pedidos de esos clientes.
 */
export function historialPorFila<R extends Fila & { phone?: string | null }>(
  filas: R[],
  todas: R[],
  normalizar: (phone: string | null | undefined) => string | null,
  resolver: (rows: R[]) => Array<{ row: R; status: string }>
): Map<string, ClienteHistorial> {
  const telefonoDe = new Map<string, string>();
  for (const f of filas) {
    const tel = normalizar(f.phone);
    if (tel) telefonoDe.set(f.row_key, tel);
  }
  const buscados = new Set(telefonoDe.values());
  const out = new Map<string, ClienteHistorial>();
  if (!buscados.size) return out;
  const delCliente = new Map<string, Array<{ row: R; status: string }>>();
  const candidatas = todas.filter((r) => {
    const tel = normalizar(r.phone);
    return tel != null && buscados.has(tel);
  });
  for (const item of resolver(candidatas)) {
    const tel = normalizar(item.row.phone);
    if (!tel) continue;
    const lista = delCliente.get(tel) ?? [];
    lista.push(item);
    delCliente.set(tel, lista);
  }
  for (const [rowKey, tel] of Array.from(telefonoDe.entries())) {
    const otros = (delCliente.get(tel) ?? []).filter((i) => i.row.row_key !== rowKey);
    out.set(rowKey, resumirHistorial(otros));
  }
  return out;
}
