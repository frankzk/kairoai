import { PERMISOS } from "./permisos";

export const MENSAJE_UPSELL_SIN_PERMISO = "No tienes permiso para esta acción.";

/** Match the active permission model without granting new powers to existing users. */
export function canManageOrderUpsell(permisos: readonly string[]): boolean {
  if (!permisos.includes("pedidos") || permisos.includes("solo_lectura")) return false;
  if ((PERMISOS as readonly string[]).includes("pedidos_anular")) {
    return permisos.includes("pedidos_anular") && permisos.includes("leads_crear_pedido");
  }
  // The published model bundles cancellation in pedidos and creation in Leads.
  return permisos.includes("leads") || permisos.includes("leads_equipo");
}
