import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identidad } from "../lib/auth";

const state = vi.hoisted(() => ({ queries: [] as Array<{ table: string; filters: Array<[string, ...unknown[]]> }>, rpc: vi.fn() }));
vi.mock("../lib/db", () => ({ getDB: () => ({
  rpc: (...args: unknown[]) => state.rpc(...args),
  from: (table: string) => {
    const query = { table, filters: [] as Array<[string, ...unknown[]]> };
    state.queries.push(query);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "contains", "overlaps", "order", "in", "gt"]) {
      chain[method] = (...args: unknown[]) => { query.filters.push([method, ...args]); return chain; };
    }
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: table === "kairo_users" ? [{ id: 5, nombre: "Ana", staff_id: 24 }] : [], error: null });
    return chain;
  },
}) }));
import { canSeePresenceTeam, readPresence, recordPresence } from "../lib/leads-presence-server";
const yo: Identidad = { id: 5, nombre: "Ana", staffId: 24, permisos: ["leads"], tiendas: ["mireva-cr"] };
beforeEach(() => { state.queries = []; state.rpc.mockReset().mockResolvedValue({ error: null }); });
describe("Separación de presencia por equipo y tienda", () => {
  it("una asesora solo consulta su usuario, incluso sin vinculación a planilla", async () => {
    await readPresence({ ...yo, staffId: null }, 1, "mireva-cr", Date.now());
    const users = state.queries[0];
    expect(users.filters).toContainEqual(["eq", "id", 5]);
    expect(users.filters).toContainEqual(["eq", "activo", true]);
    expect(users.filters).toContainEqual(["contains", "tiendas", ["mireva-cr"]]);
    expect(users.filters).toContainEqual(["overlaps", "permisos", ["leads", "leads_equipo"]]);
    expect(state.queries.slice(1).every((q) => q.filters.some((f) => f[0] === "eq" && f[1] === "store_id" && f[2] === 1))).toBe(true);
  });
  it("supervisión y productividad del equipo pueden ver a las demás", async () => {
    for (const permiso of ["leads_equipo", "leads_productividad", "usuarios"] as const) {
      const supervisor = { ...yo, permisos: [...yo.permisos, permiso] };
      expect(canSeePresenceTeam(supervisor)).toBe(true);
      state.queries = [];
      const rows = await readPresence(supervisor, 1, "mireva-cr", Date.now());
      expect(state.queries[0].filters).not.toContainEqual(["eq", "id", 5]);
      expect(rows[0]).toMatchObject({ user_id: 5, name: "Ana", last_activity_at: null, connected_until: null });
      expect(rows[0]).not.toHaveProperty("password_hash");
    }
  });
  it("el selector de asesora no participa en la escritura ni se inventa un usuario para admin compartido", async () => {
    const signal = { tab_id: "7f1b3893-81d3-4893-8344-00c5164d8050", sequence: 1, visible: true, closed: false, activity_age_ms: 0 };
    await recordPresence(0, 1, signal); expect(state.rpc).not.toHaveBeenCalled();
    await recordPresence(5, 1, signal);
    expect(state.rpc).toHaveBeenCalledWith("record_lead_presence", expect.objectContaining({ p_user_id: 5, p_store_id: 1 }));
    state.rpc.mockResolvedValue({ error: { message: "not allowed" } });
    await expect(recordPresence(5, 1, signal)).rejects.toThrow("No se pudo registrar");
  });
  it("el período se consulta en el historial, no comparando solo la última conexión", async () => {
    const period = { fromIso: "2026-10-30T06:00:00Z", toIso: "2026-10-31T06:00:00Z" };
    state.rpc.mockResolvedValue({ error: null, data: [{ user_id: 5, period_last_seen_at: "2026-10-30T17:00:00Z", period_last_activity_at: "2026-10-30T16:58:00Z" }] });
    const rows = await readPresence(yo, 1, "mireva-cr", Date.now(), period);
    expect(state.rpc).toHaveBeenCalledWith("lead_presence_in_period", { p_store_id: 1, p_from: period.fromIso, p_to: period.toIso });
    expect(rows[0]).toMatchObject({ user_id: 5, period_last_seen_at: "2026-10-30T17:00:00Z" });
    state.rpc.mockResolvedValue({ error: null, data: [{ user_id: 999, period_last_seen_at: "2026-10-30T17:00:00Z" }] });
    expect(await readPresence(yo, 1, "mireva-cr", Date.now(), period)).toEqual([]);
    state.rpc.mockResolvedValue({ error: { message: "missing relation" } });
    await expect(readPresence(yo, 1, "mireva-cr", Date.now(), period)).rejects.toThrow("conexiones del período");
  });
});
