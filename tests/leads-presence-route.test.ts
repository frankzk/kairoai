import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Identidad } from "../lib/auth";

const state = vi.hoisted(() => ({
  yo: null as Identidad | null,
  read: vi.fn(), write: vi.fn(),
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => state.yo }));
vi.mock("@/lib/stores", () => ({ getRequiredStoreFromSearchParams: (p: URLSearchParams) => {
  const code = p.get("store");
  return code === "mireva-cr" && state.yo?.tiendas.includes(code) ? { id: 1, code } : null;
} }));
vi.mock("@/lib/leads-presence-server", () => ({
  canSeePresenceTeam: (yo: Identidad) => yo.permisos.includes("leads_equipo"),
  readPresence: (...args: unknown[]) => state.read(...args),
  recordPresence: (...args: unknown[]) => state.write(...args),
}));
import { GET, POST } from "../app/api/leads/presence/route";
const valid = { tab_id: "7f1b3893-81d3-4893-8344-00c5164d8050", sequence: 1, visible: true, closed: false, activity_age_ms: 0 };
const req = (body?: unknown, store = "mireva-cr", origin = "https://kairo.test") => new NextRequest(`https://kairo.test/api/leads/presence?store=${store}`, body === undefined ? undefined : { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  state.yo = { id: 5, nombre: "Asesora", staffId: 24, permisos: ["leads"], tiendas: ["mireva-cr"] };
  state.read.mockReset().mockResolvedValue([]);
  state.write.mockReset().mockResolvedValue(undefined);
});
describe("API de presencia autenticada", () => {
  it("sin usuario no lee ni escribe datos", async () => {
    state.yo = null;
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req(valid))).status).toBe(401);
    expect(state.read).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled();
  });
  it("impide cambiar identidad de usuario mediante el cuerpo", async () => {
    expect((await POST(req({ ...valid, user_id: 100, vendedora: 3 }))).status).toBe(204);
    expect(state.write).toHaveBeenCalledWith(5, 1, valid);
  });
  it("no acepta otra tienda ni origen externo ni señales inválidas", async () => {
    expect((await POST(req(valid, "mireva-hn"))).status).toBe(400);
    expect((await GET(req(undefined, "mireva-hn"))).status).toBe(400);
    expect((await POST(req(valid, "mireva-cr", "https://externo.test"))).status).toBe(403);
    expect((await POST(req({ ...valid, activity_age_ms: -1 }))).status).toBe(400);
    expect(state.write).not.toHaveBeenCalled();
  });
  it("devuelve hora del servidor y nunca permite cachear presencia", async () => {
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ rows: [], team: false, server_time: expect.any(String) });
    expect(state.read).toHaveBeenCalledWith(state.yo, 1, "mireva-cr", expect.any(Number));
  });
  it("un error de base no se presenta como desconexión confirmada", async () => {
    state.read.mockRejectedValue(new Error("database unavailable"));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty("rows");
    state.write.mockRejectedValue(new Error("database unavailable"));
    expect((await POST(req(valid))).status).toBe(503);
  });
});
