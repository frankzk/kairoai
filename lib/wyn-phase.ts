// Fase de transito de una guia de WYN (MailAmericas), como la de Moovin
// (lib/moovin-status.ts), para el "Estado de seguimiento" de Gestion:
//   - despacho_solicitado: "Orden creada" (OC-1). La guia existe pero el
//     paquete sigue en la bodega de Boxful: Despacho solicitado › Esperando
//     recoleccion.
//   - recolectado: ya en la red de WYN, antes de salir a repartir ("En almacen
//     intermedio" WI-3/WI-4, "Recibido en centro de distribucion" RC-0/RC-4).
//   - en_route: ultima milla en reparto ("En camino a entrega", LM-0..LM-12
//     sin incidencia).
// null cuando no es transito (entregado, devuelto, incidencia) o no hay dato:
// eso lo decide getEffectiveTrackingStatus.
//
// Antes, una guia en "Orden creada" caia en "En ruta" (225 guias el 17/11/2026)
// aunque no habia salido de la bodega.
//
// Modulo PURO (sin imports): se usa en lib/dispatch.ts y en los tests.

export type WynTransitPhase = "despacho_solicitado" | "recolectado" | "en_route";

const PHASE_BY_CODE: Record<string, WynTransitPhase> = {
  "OC-1": "despacho_solicitado",
  "WI-3": "recolectado",
  "WI-4": "recolectado",
  "RC-0": "recolectado",
  "RC-4": "recolectado",
};

export function wynTransitPhase(code: string | null | undefined, group: string | null | undefined): WynTransitPhase | null {
  const c = String(code ?? "").trim().toUpperCase();
  const g = String(group ?? "");
  if (g === "pending") return "despacho_solicitado";
  if (g !== "en_route") return null;
  const byCode = PHASE_BY_CODE[c];
  if (byCode) return byCode;
  if (c.startsWith("LM-")) return "en_route";
  return null;
}
