// Reparto automatico de leads (lado base): sin migracion o apagado no hace
// nada ni rompe el tablero; encendido pide turno, reparte y suelta el turno.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: { data: null as unknown, error: null as null | { code?: string; message: string } },
  rpc: vi.fn(),
  users: [] as Array<Record<string, unknown>>,
  presence: [] as Array<Record<string, unknown>>,
  tabs: [] as Array<Record<string, unknown>>,
  leads: [] as Array<Record<string, unknown>>,
}));

vi.mock("../lib/db", () => ({
  getDB: () => ({
    rpc: (...args: unknown[]) => state.rpc(...args),
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "contains", "overlaps", "order", "in", "gt", "or", "not", "range", "upsert"]) {
        chain[m] = () => chain;
      }
      const result = () => {
        if (table === "lead_assignment_settings") return state.settings;
        if (table === "kairo_users") return { data: state.users, error: null };
        if (table === "lead_presence") return { data: state.presence, error: null };
        if (table === "lead_presence_tabs") return { data: state.tabs, error: null };
        if (table === "leads") return { data: state.leads, error: null };
        return { data: [], error: null };
      };
      chain.maybeSingle = async () => result();
      chain.then = (resolve: (v: unknown) => void) => resolve(result());
      return chain;
    },
  }),
}));

import { readAssignmentBoardInfo, runLeadAssignment } from "../lib/leads-assignment-server";

const STORE = { id: 1, code: "mireva-cr" };
const NOW = new Date("2026-11-07T18:00:00Z");

function lead(id: number, claimed_by: number | null = null) {
  return {
    id,
    store_id: 1,
    phone: `5068${String(id).padStart(7, "0")}`,
    status: "conversando",
    status_source: "auto",
    category: "open",
    shopify_cart_open: false,
    shopify_draft_cart_count: 0,
    has_cart_signal: false,
    cart_item_count: 0,
    inbound_count: 3,
    has_order: false,
    next_followup_at: null,
    needs_attention: false,
    last_interaction_at: new Date(NOW.getTime() - id * 60_000).toISOString(),
    claimed_by,
    claimed_at: null,
  };
}

beforeEach(() => {
  state.settings = { data: { store_id: 1, enabled: true }, error: null };
  state.users = [];
  state.presence = [];
  state.tabs = [];
  state.leads = [];
  state.rpc.mockReset();
});

describe("sin la migracion o apagado", () => {
  it("sin la tabla: el cron no hace nada y el tablero lo ve apagado", async () => {
    state.settings = { data: null, error: { code: "42P01", message: 'relation "lead_assignment_settings" does not exist' } };
    expect(await runLeadAssignment(STORE, NOW)).toEqual({ store: "mireva-cr", skipped: "sin_migracion" });
    expect(await readAssignmentBoardInfo(1, "mireva-cr")).toEqual({ enabled: false, users: [] });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("apagado: no pide turno ni toca leads", async () => {
    state.settings = { data: { store_id: 1, enabled: false }, error: null };
    expect(await runLeadAssignment(STORE, NOW)).toEqual({ store: "mireva-cr", skipped: "apagado" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("otra corrida en curso: no hace nada", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect((await runLeadAssignment(STORE, NOW)).skipped).toBe("en_curso");
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("encendido", () => {
  it("reparte entre las activas, aplica en lote y suelta el turno", async () => {
    const visible = { last_seen_at: new Date(NOW.getTime() - 5_000).toISOString(), last_activity_at: new Date(NOW.getTime() - 10_000).toISOString(), visible: true, closed: false };
    state.users = [
      { id: 10, nombre: "Ana", staff_id: 1, permisos: ["leads"] },
      { id: 11, nombre: "Bea", staff_id: 2, permisos: ["leads"] },
      { id: 12, nombre: "Jefa", staff_id: null, permisos: ["leads", "leads_equipo"] },
    ];
    state.tabs = [{ user_id: 10, ...visible }, { user_id: 11, ...visible }, { user_id: 12, ...visible }];
    state.presence = state.tabs.map((t) => ({ user_id: t.user_id, last_seen_at: t.last_seen_at, last_activity_at: t.last_activity_at }));
    state.leads = [lead(1), lead(2), lead(3), lead(4)];
    state.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "lead_assignment_lease") return { data: "token-1", error: null };
      if (name === "lead_assignment_activity") return { data: { protected: [], recent: [] }, error: null };
      if (name === "lead_assignment_apply") return { data: (args.p_changes as unknown[]).length, error: null };
      return { data: null, error: null };
    });

    const r = await runLeadAssignment(STORE, NOW);
    expect(r).toMatchObject({ skipped: null, abiertos: 4, activas: ["Ana", "Bea"], planeados: 4, aplicados: 4 });
    const apply = state.rpc.mock.calls.find((c) => c[0] === "lead_assignment_apply");
    const cambios = (apply?.[1] as { p_changes: Array<{ to_user: number }> }).p_changes;
    expect(cambios.map((c) => c.to_user).sort()).toEqual([10, 10, 11, 11]);
    expect(apply?.[1]).toMatchObject({ p_store: 1, p_token: "token-1" });
    const release = state.rpc.mock.calls.find((c) => c[0] === "lead_assignment_release");
    expect(release?.[1]).toMatchObject({ p_store: 1, p_token: "token-1" });
  });

  it("si el turno se perdio (o se apago a mitad), lo dice y suelta igual", async () => {
    state.users = [{ id: 10, nombre: "Ana", staff_id: 1, permisos: ["leads"] }];
    const t = { user_id: 10, last_seen_at: NOW.toISOString(), last_activity_at: NOW.toISOString(), visible: true, closed: false };
    state.tabs = [t];
    state.leads = [lead(1)];
    state.rpc.mockImplementation(async (name: string) => {
      if (name === "lead_assignment_lease") return { data: "token-2", error: null };
      if (name === "lead_assignment_activity") return { data: { protected: [], recent: [] }, error: null };
      if (name === "lead_assignment_apply") return { data: -1, error: null };
      return { data: null, error: null };
    });
    expect((await runLeadAssignment(STORE, NOW)).skipped).toBe("turno_perdido");
    expect(state.rpc.mock.calls.some((c) => c[0] === "lead_assignment_release")).toBe(true);
  });
});
