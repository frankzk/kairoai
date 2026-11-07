// Reparto automatico de leads: el interruptor (permiso), el cron registrado y
// que sin la migracion todo quede apagado sin romper.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  identity: null as null | { id: number; nombre: string; permisos: string[]; tiendas: string[] },
  setEnabled: vi.fn(),
  readSettings: vi.fn(),
}));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => mocks.identity }));
vi.mock("@/lib/stores", () => ({
  FINANCE_STORES: [
    { id: 1, code: "mireva-cr", label: "Mireva Costa Rica" },
    { id: 2, code: "mireva-hn", label: "Mireva Honduras" },
  ],
  storeAllowed: (code: string) => mocks.identity?.tiendas.includes(code) ?? false,
  getRequiredStoreFromBody: (body: unknown) => {
    const code = (body as { store?: string } | null)?.store;
    if (!code || !mocks.identity?.tiendas.includes(code)) return null;
    return code === "mireva-cr" ? { id: 1, code, label: "Mireva Costa Rica" } : { id: 2, code, label: "Mireva Honduras" };
  },
}));
vi.mock("@/lib/leads-assignment-server", () => ({
  readAssignmentSettings: (...args: unknown[]) => mocks.readSettings(...args),
  setAssignmentEnabled: (...args: unknown[]) => mocks.setEnabled(...args),
  listRepartibleAdvisors: async () => ["Ana", "Bea"],
}));

import { GET, POST } from "../app/api/leads/assignment-settings/route";
import { exigenciaDe } from "../lib/permisos";
import { CRON_JOBS } from "../lib/cron-jobs";

const ROOT = path.resolve(__dirname, "..");
const settings = (store_id: number, enabled: boolean) => ({
  store_id,
  available: true,
  enabled,
  updated_by: "Dueño",
  updated_at: "2026-11-07T18:00:00Z",
  last_run_at: null,
  last_run_summary: null,
});
const post = (body: unknown) =>
  POST(
    new NextRequest("https://kairo.test/api/leads/assignment-settings", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  mocks.identity = { id: 1, nombre: "Dueño", permisos: ["config", "usuarios", "leads"], tiendas: ["mireva-cr", "mireva-hn"] };
  mocks.setEnabled.mockReset().mockImplementation(async (id: number, enabled: boolean) => settings(id, enabled));
  mocks.readSettings.mockReset().mockImplementation(async (id: number) => settings(id, false));
});

describe("interruptor del reparto: solo administracion", () => {
  it("el middleware pide config o usuarios para la ruta", () => {
    expect(exigenciaDe("/api/leads/assignment-settings", "POST")).toEqual({ tipo: "permiso", alguno: ["config", "usuarios"] });
    expect(exigenciaDe("/api/leads/assignment-settings", "GET")).toEqual({ tipo: "permiso", alguno: ["config", "usuarios"] });
  });

  it("una asesora o la supervision de Leads no lo pueden ver ni cambiar", async () => {
    for (const permisos of [["leads"], ["leads", "leads_equipo"]]) {
      mocks.identity = { id: 5, nombre: "Ana", permisos, tiendas: ["mireva-cr"] };
      expect((await GET()).status).toBe(403);
      expect((await post({ store: "mireva-cr", enabled: true })).status).toBe(403);
    }
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });

  it("sin sesion: 401", async () => {
    mocks.identity = null;
    expect((await GET()).status).toBe(401);
    expect((await post({ store: "mireva-cr", enabled: true })).status).toBe(401);
  });

  it("administracion lo prende por tienda y queda quien lo hizo", async () => {
    const res = await post({ store: "mireva-cr", enabled: true });
    expect(res.status).toBe(200);
    expect(mocks.setEnabled).toHaveBeenCalledWith(1, true, "Dueño");
    expect(await res.json()).toMatchObject({ code: "mireva-cr", enabled: true });
  });

  it("con solo config tambien puede", async () => {
    mocks.identity = { id: 2, nombre: "Ops", permisos: ["config"], tiendas: ["mireva-hn"] };
    expect((await post({ store: "mireva-hn", enabled: false })).status).toBe(200);
    expect(mocks.setEnabled).toHaveBeenCalledWith(2, false, "Ops");
  });

  it("tienda ajena o cuerpo invalido: no guarda nada", async () => {
    mocks.identity = { id: 2, nombre: "Ops", permisos: ["config"], tiendas: ["mireva-hn"] };
    expect((await post({ store: "mireva-cr", enabled: true })).status).toBe(400);
    expect((await post({ store: "mireva-hn", enabled: "si" })).status).toBe(400);
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });

  it("GET lista solo las tiendas de la persona, con quien puede recibir leads", async () => {
    mocks.identity = { id: 2, nombre: "Ops", permisos: ["config"], tiendas: ["mireva-cr"] };
    const body = await (await GET()).json();
    expect(body.stores).toHaveLength(1);
    expect(body.stores[0]).toMatchObject({ code: "mireva-cr", enabled: false, asesoras: ["Ana", "Bea"] });
  });

  it("sin la migracion responde 409 con el aviso", async () => {
    mocks.setEnabled.mockResolvedValue({ ...settings(1, false), available: false });
    const res = await post({ store: "mireva-cr", enabled: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("migración");
  });
});

describe("cron del reparto registrado", () => {
  it("esta en CRON_JOBS cada 5 min y en vercel.json", () => {
    expect(CRON_JOBS.find((j) => j.name === "leads-assignment")?.everyMinutes).toBe(5);
    const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const cron = vercel.crons.find((c) => c.path === "/api/cron/leads-assignment");
    expect(cron?.schedule.split(" ")[0].split(",")).toHaveLength(12);
    expect(exigenciaDe("/api/cron/leads-assignment").tipo).toBe("cron");
  });
});
