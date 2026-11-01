import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Identidad } from "../lib/auth";

const state = vi.hoisted(() => ({ yo: null as Identidad | null, metrics: vi.fn(), presence: vi.fn() }));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => state.yo }));
vi.mock("@/lib/stores", () => ({ getRequiredStoreFromSearchParams: (sp: URLSearchParams) => state.yo?.tiendas.includes(sp.get("store") || "") ? { id: 1, code: "mireva-cr" } : null }));
vi.mock("@/lib/leads", () => ({ getProductivity: (...args: unknown[]) => state.metrics(...args) }));
vi.mock("@/lib/leads-presence-server", () => ({ readPresence: (...args: unknown[]) => state.presence(...args) }));
import { GET } from "../app/api/leads/productivity/route";
const req = (query = "range=hoy") => new NextRequest(`https://kairo.test/api/leads/productivity?store=mireva-cr&${query}`);
beforeEach(() => {
  state.yo = { id: 5, nombre: "Ana", staffId: 24, tiendas: ["mireva-cr"], permisos: ["leads", "leads_equipo"] };
  state.metrics.mockReset().mockResolvedValue([
    { vendedora_id: 24, name: "Ana", gestiones: 2, leads: 1, pedidos: 1 },
    { vendedora_id: 25, name: "No conectada", gestiones: 8, leads: 6, pedidos: 4 },
  ]);
  state.presence.mockReset().mockResolvedValue([{ user_id: 5, staff_id: 24, name: "Ana", active_until: null, connected_until: null, last_activity_at: null, last_seen_at: null, period_last_seen_at: "2026-10-30T17:00:00Z" }]);
});
describe("Rango de conexiones y productividad", () => {
  it("exige sesión y tienda permitida antes de leer datos", async () => {
    state.yo = null;
    expect((await GET(req())).status).toBe(401);
    expect(state.metrics).not.toHaveBeenCalled();
  });
  it("pasa el mismo rango a las conexiones y las métricas, con totales solo de las filas visibles", async () => {
    const res = await GET(req("from=2026-10-30&to=2026-10-30"));
    const body = await res.json();
    expect(state.metrics).toHaveBeenCalledWith(1, "2026-10-30T06:00:00.000Z", "2026-10-31T06:00:00.000Z");
    expect(state.presence).toHaveBeenCalledWith(state.yo, 1, "mireva-cr", expect.any(Number), { fromIso: "2026-10-30T06:00:00.000Z", toIso: "2026-10-31T06:00:00.000Z" });
    expect(body.rows).toHaveLength(1);
    expect(body.totals).toEqual({ gestiones: 2, leads: 1, pedidos: 1 });
    expect(body.server_time).toEqual(expect.any(String));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("un rango sin conexiones no muestra las asesoras de otros períodos", async () => {
    state.presence.mockResolvedValue([]);
    const body = await (await GET(req())).json();
    expect(body.rows).toEqual([]);
    expect(body.totals).toEqual({ gestiones: 0, leads: 0, pedidos: 0 });
  });
  it("actualiza presencia sin volver a leer todo el historial de gestiones", async () => {
    const body = await (await GET(req("range=hoy&presence_only=1"))).json();
    expect(state.metrics).not.toHaveBeenCalled();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].user_id).toBe(5);
    expect(body).not.toHaveProperty("totals");
  });
  it("rechaza fechas inválidas y no convierte un fallo de historial en cero conexiones", async () => {
    expect((await GET(req("from=2026-10-31&to=2026-10-30"))).status).toBe(400);
    expect(state.presence).not.toHaveBeenCalled();
    state.presence.mockRejectedValue(new Error("Historial no disponible"));
    expect((await GET(req())).status).toBe(500);
  });
});
