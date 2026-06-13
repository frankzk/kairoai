// Reconciliacion pura entre el estado del sistema (Boxful/Shopify) y el de
// Moovin. Sin dependencias: se prueba con fixtures. Detecta los desfases que
// importan en auditoria COD.

export type MoovinDiscrepancyType =
  | "moovin_delivered_unrecorded"
  | "moovin_returned"
  | "moovin_incident"
  | "system_delivered_moovin_pending";

export interface MoovinDiscrepancy {
  type: MoovinDiscrepancyType;
  severity: "high" | "medium";
  message: string;
}

export interface ReconcilableMoovin {
  latest_group: string;
  latest_status: string;
  has_incident: boolean;
}

// systemStatus: estado de seguimiento efectivo del pedido
// (delivered | not_delivered | returned | annulled | en_route | pending).
export function reconcileMoovin(
  systemStatus: string,
  moovin: ReconcilableMoovin | undefined
): MoovinDiscrepancy | null {
  if (!moovin || !moovin.latest_group) return null;
  const systemDelivered = systemStatus === "delivered";
  const systemNotDelivered = systemStatus === "not_delivered" || systemStatus === "returned";
  const systemAnnulled = systemStatus === "annulled";

  // Moovin entrego pero el sistema todavia no lo registra: caja cobrable que
  // el archivo de Boxful aun no refleja.
  if (moovin.latest_group === "delivered" && !systemDelivered) {
    return {
      type: "moovin_delivered_unrecorded",
      severity: "medium",
      message: "Moovin confirma entrega; el sistema aun no lo marca como entregado.",
    };
  }

  // Moovin devolvio al remitente y el sistema no lo refleja: riesgo de
  // contabilizar como entregado/en ruta algo que volvio.
  if (moovin.latest_group === "returned" && !systemNotDelivered && !systemAnnulled) {
    return {
      type: "moovin_returned",
      severity: "high",
      message: "Moovin marco devolucion al remitente; el sistema no lo refleja.",
    };
  }

  // Incidencia activa en un pedido que el sistema da por en ruta/entregado:
  // entrega en riesgo que conviene gestionar (llamar, corregir direccion).
  if (moovin.has_incident && !systemNotDelivered && !systemAnnulled) {
    return {
      type: "moovin_incident",
      severity: "high",
      message: `Moovin reporto incidencia sin resolver: ${moovin.latest_status}.`,
    };
  }

  // El sistema dice entregado pero Moovin no confirma entrega: posible entrega
  // falsa o estado desactualizado.
  if (systemDelivered && moovin.latest_group !== "delivered") {
    return {
      type: "system_delivered_moovin_pending",
      severity: "medium",
      message: "El sistema dice entregado pero Moovin no confirma la entrega.",
    };
  }

  return null;
}
