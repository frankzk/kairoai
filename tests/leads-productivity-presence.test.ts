import { describe, expect, it } from "vitest";
import { connectedProductivityRows } from "../lib/leads-productivity-presence";
import type { PresenceRow } from "../lib/leads-presence";

const person = (id: number, staff: number | null): PresenceRow => ({ user_id: id, staff_id: staff, name: `Persona ${id}`, active_until: null, connected_until: null, last_activity_at: null, last_seen_at: null, period_last_seen_at: "2026-10-31T17:00:00Z" });
describe("Productividad de personas conectadas en el período", () => {
  it("excluye a quien tenga gestiones pero no conexión en el rango", () => {
    const rows = connectedProductivityRows([person(1, 7)], [
      { vendedora_id: 7, name: "Asesora 7", gestiones: 3, leads: 2, pedidos: 1 },
      { vendedora_id: 8, name: "Asesora 8", gestiones: 50, leads: 40, pedidos: 20 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 1, name: "Persona 1", gestiones: 3, leads: 2, pedidos: 1 });
  });
  it("incluye conexiones sin gestiones con ceros, sin inventar métricas para usuarios sin asesora", () => {
    const rows = connectedProductivityRows([person(1, 7), person(2, null)], []);
    expect(rows.find((r) => r.user_id === 1)).toMatchObject({ gestiones: 0, leads: 0, pedidos: 0 });
    expect(rows.find((r) => r.user_id === 2)).toMatchObject({ vendedora_id: null, gestiones: null, leads: null, pedidos: null });
  });
  it("mantiene usuarios distintos y respeta el vínculo real de cada asesora", () => {
    const rows = connectedProductivityRows([person(1, 7), person(2, 8)], [
      { vendedora_id: 7, name: "Otro nombre", gestiones: 3, leads: 2, pedidos: 1 },
      { vendedora_id: 8, name: "Otro nombre", gestiones: 8, leads: 6, pedidos: 3 },
    ]);
    expect(rows.map((r) => [r.user_id, r.pedidos])).toEqual([[2, 3], [1, 1]]);
    expect(rows[1].connected_until).toBeNull();
    expect(rows[1].period_last_seen_at).toBe("2026-10-31T17:00:00Z");
  });
});
