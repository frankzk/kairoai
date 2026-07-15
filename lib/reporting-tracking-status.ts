export interface ReportingTrackingRow {
  tracking_status: string;
  tracking_badge_status: string;
  tracking_label: string;
}

function getFinalTrackingStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "annulled" || normalized.includes("anulad") || normalized.includes("cancelad")) {
    return "annulled";
  }
  if (normalized.includes("no entregado") || normalized.includes("devuelto") || normalized === "returned") {
    return "not_delivered";
  }
  if (normalized.includes("entregado") || normalized === "delivered") {
    return "delivered";
  }
  return "";
}

/**
 * Estado canonico para reportes y filtros. Un resultado final consolidado
 * prevalece sobre estados operativos pendientes que hayan quedado en cache.
 */
export function getReportingTrackingStatus(row: ReportingTrackingRow): string {
  // El badge es la clasificacion consolidada. La etiqueta es el respaldo para
  // datasets cacheados donde el texto final ya se actualizo, pero el codigo de
  // filtro aun conserva "pending".
  const badgeFinal = getFinalTrackingStatus(row.tracking_badge_status);
  if (badgeFinal) return badgeFinal;
  const labelFinal = getFinalTrackingStatus(row.tracking_label);
  if (labelFinal) return labelFinal;
  const statusFinal = getFinalTrackingStatus(row.tracking_status);
  if (statusFinal) return statusFinal;
  return row.tracking_status || row.tracking_badge_status || "pending";
}
