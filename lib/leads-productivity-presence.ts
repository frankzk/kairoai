import type { ProductivityRow } from "./leads";
import type { PresenceRow } from "./leads-presence";

export interface ConnectedProductivityRow extends PresenceRow {
  vendedora_id: number | null;
  gestiones: number | null;
  leads: number | null;
  pedidos: number | null;
}

/** The roster comes from observed connections in the selected period. */
export function connectedProductivityRows(presence: PresenceRow[], metrics: ProductivityRow[]): ConnectedProductivityRow[] {
  const byStaff = new Map(metrics.map((row) => [row.vendedora_id, row]));
  return presence.map((person) => {
    const values = person.staff_id === null ? null : byStaff.get(person.staff_id);
    return {
      ...person, vendedora_id: person.staff_id,
      gestiones: person.staff_id === null ? null : values?.gestiones ?? 0,
      leads: person.staff_id === null ? null : values?.leads ?? 0,
      pedidos: person.staff_id === null ? null : values?.pedidos ?? 0,
    };
  }).sort((a, b) => (b.pedidos ?? 0) - (a.pedidos ?? 0) || (b.gestiones ?? 0) - (a.gestiones ?? 0) || a.name.localeCompare(b.name, "es"));
}
