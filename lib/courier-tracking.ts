// Lo comun a los couriers que Kairo lee de su pagina publica de rastreo y
// guarda en courier_shipments (Cargo Expreso y c807 Xpress, en Honduras): la
// forma del rastreo y como se decide el estado vigente de una guia.

export type ShipmentGroup = "delivered" | "failed" | "returned" | "in_progress" | "pending";

export interface ShipmentEvent {
  code: string;
  group: ShipmentGroup;
  title: string;
  description: string;
  date: string | null;
  note: string;
}

export interface ShipmentTracking {
  guideNumber: string;
  latestStatus: string;
  latestCode: string;
  latestGroup: ShipmentGroup;
  latestAt: string | null;
  hasIncident: boolean;
  incidentReason: string;
  deliveryAddress: string;
  receiverName: string;
  /** Del mas reciente al mas viejo. */
  events: ShipmentEvent[];
}

/** "2026-10-05 11:23:51" en hora de Honduras (UTC-6, sin horario de verano) a ISO. */
export function fechaHonduras(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value.trim());
  return m ? new Date(`${m[1]}T${m[2]}-06:00`).toISOString() : null;
}

export function delMasReciente(eventos: ShipmentEvent[]): ShipmentEvent[] {
  return [...eventos].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

/**
 * Estado vigente de una guia a partir de sus eventos (del mas reciente al mas
 * viejo):
 * - Entregada o devuelta: lo dice un evento de entrega o de devolucion.
 * - Intento fallido activo: el ultimo intento fallo y el paquete no volvio a
 *   salir a reparto (`salidas`: los codigos de salida a reparto del courier).
 * - Si volvio a salir despues de la falla, es un reintento en curso.
 * - Pendiente: solo eventos previos a la recoleccion.
 */
export function estadoVigente(
  eventos: ShipmentEvent[],
  salidas: ReadonlySet<string>,
  entregadaSegunCourier = false
): { group: ShipmentGroup; ultimaFalla: ShipmentEvent | null } {
  if (entregadaSegunCourier || eventos.some((e) => e.group === "delivered")) return { group: "delivered", ultimaFalla: null };
  if (eventos.some((e) => e.group === "returned")) return { group: "returned", ultimaFalla: null };
  let ultimaFalla: ShipmentEvent | null = null;
  let salioDespues = false;
  for (const e of [...eventos].reverse()) {
    if (e.group === "failed") {
      ultimaFalla = e;
      salioDespues = false;
    } else if (ultimaFalla && salidas.has(e.code)) {
      salioDespues = true;
    }
  }
  if (ultimaFalla && !salioDespues) return { group: "failed", ultimaFalla };
  if (eventos.every((e) => e.group === "pending")) return { group: "pending", ultimaFalla: null };
  return { group: "in_progress", ultimaFalla: null };
}

/** Arma el rastreo guardado a partir de los eventos y el estado vigente. */
export function armarRastreo(
  guideNumber: string,
  eventos: ShipmentEvent[],
  estado: { group: ShipmentGroup; ultimaFalla: ShipmentEvent | null },
  extra: { enCurso?: string; deliveryAddress?: string; receiverName?: string } = {}
): ShipmentTracking {
  const { group, ultimaFalla } = estado;
  const latest = eventos[0] ?? null;
  const falla = group === "failed" ? ultimaFalla : null;
  return {
    guideNumber,
    latestStatus:
      group === "delivered" ? "Entregado"
      : group === "returned" ? "Devuelto"
      : falla ? falla.title
      : extra.enCurso || latest?.title || "Sin movimientos",
    latestCode: falla ? falla.code : latest?.code ?? "",
    latestGroup: group,
    // La fecha de la novedad es la del intento, no la del ingreso a bodega.
    latestAt: (falla ? falla.date : latest?.date) ?? null,
    hasIncident: group === "failed",
    incidentReason: falla ? falla.description : "",
    deliveryAddress: extra.deliveryAddress ?? "",
    receiverName: extra.receiverName ?? "",
    events: eventos,
  };
}
