// Reserva de leads en el servidor: ruta /hold, 409 en las escrituras y falla
// suave sin la migración (lib/lead-holds-server.ts). Base simulada en memoria
// con las reglas de lead_hold_acquire (la SQL real se probó aparte).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decideAcquire, LEAD_HOLD_MS, type LeadHold } from "../lib/lead-holds";

const mocks = vi.hoisted(() => ({
  yo: null as null | { id: number; nombre: string; permisos: string[]; tiendas: string[]; staffId: number | null },
  holds: new Map<number, LeadHold & { store_id: number }>(),
  error: null as null | { code: string; message: string },
  rpcCalls: [] as Array<Record<string, unknown>>,
  dbCalls: 0,
  applyDisposition: vi.fn(),
  undoDisposition: vi.fn(),
  getLead: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: () => ({ get: () => (mocks.yo ? encodeURIComponent(JSON.stringify(mocks.yo)) : null) }),
}));

type Filter = [op: "eq" | "gt", col: string, val: unknown];
function query(table: string) {
  let op: "select" | "delete" = "select";
  const filters: Filter[] = [];
  const run = () => {
    mocks.dbCalls++;
    if (mocks.error) return { data: null, error: mocks.error };
    if (table !== "lead_holds") return { data: [], error: null };
    const match = (row: Record<string, unknown>) =>
      filters.every(([o, c, v]) => (o === "eq" ? row[c] === v : String(row[c]) > String(v)));
    const rows = Array.from(mocks.holds.values()).filter((r) => match(r as unknown as Record<string, unknown>));
    if (op === "delete") for (const r of rows) mocks.holds.delete(r.lead_id);
    return { data: rows, error: null };
  };
  const api = {
    select: () => api,
    delete: () => ((op = "delete"), api),
    eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), api),
    gt: (c: string, v: unknown) => (filters.push(["gt", c, v]), api),
    limit: () => api,
    maybeSingle: async () => {
      const r = run();
      return { data: r.data?.[0] ?? null, error: r.error };
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
  };
  return api;
}
const db = {
  from: (t: string) => query(t),
  rpc: async (name: string, args: Record<string, unknown>) => {
    mocks.dbCalls++;
    mocks.rpcCalls.push({ name, ...args });
    if (mocks.error) return { data: null, error: mocks.error };
    const leadId = Number(args.p_lead_id);
    if (leadId === 404) return { data: null, error: { code: "P0001", message: "Lead not found in store" } };
    const now = Date.now();
    const d = decideAcquire(
      mocks.holds.get(leadId) ?? null,
      { id: Number(args.p_user_id), name: String(args.p_user_name) },
      leadId,
      now,
      Boolean(args.p_takeover)
    );
    if (d.kind !== "blocked" && d.kind !== "kept") mocks.holds.set(leadId, { ...d.hold, store_id: Number(args.p_store_id) });
    return { data: [{ ...mocks.holds.get(leadId), server_now: new Date(now).toISOString() }], error: null };
  },
};
vi.mock("@/lib/db", () => ({ getDB: () => db }));
vi.mock("../lib/db", () => ({ getDB: () => db }));

vi.mock("@/lib/leads", () => ({
  getLead: mocks.getLead,
  applyDisposition: mocks.applyDisposition,
  undoDisposition: mocks.undoDisposition,
  insertLeadCall: vi.fn(),
  markLeadWonByAdvisor: vi.fn(),
}));
vi.mock("@/lib/icomfly-receipts", () => ({
  findReceipt: vi.fn(async () => null),
  reserveReceipt: vi.fn(),
  saveReceiptId: vi.fn(),
  confirmReceipt: vi.fn(),
}));
vi.mock("@/lib/llamada-destino", () => ({
  destinoDeLlamada: vi.fn(async () => ({ ok: true, phone: "50688887777", leadId: 41, orderName: null })),
}));
vi.mock("@/lib/zadarma", () => ({ isZadarmaConfigured: () => true }));
vi.mock("@/lib/telnyx", () => ({
  getTelnyxConfig: () => ({ config: { ok: true }, faltan: [] }),
  callerIdDeTienda: () => "+50640000000",
  variableCallerId: () => "TELNYX_CALLER_ID_CR",
  codificarEstadoCliente: () => "estado",
}));
vi.mock("@/lib/telnyx-calls", () => ({ crearLlamadaTelnyx: vi.fn(async () => 1) }));
vi.mock("@/lib/telnyx-buzon", () => ({ buzonHoyDeNumero: vi.fn(async () => null), mensajeBuzon: () => "" }));

import { GET as holdGET, POST as holdPOST } from "../app/api/leads/[leadId]/hold/route";
import { POST as dispositionPOST } from "../app/api/leads/[leadId]/disposition/route";
import { POST as undoPOST } from "../app/api/leads/[leadId]/disposition/undo/route";
import { POST as sendPOST } from "../app/api/leads/[leadId]/send/route";
import { POST as orderPOST } from "../app/api/leads/[leadId]/order/route";
import { POST as cartCompletePOST } from "../app/api/leads/[leadId]/carts/complete/route";
import { POST as zadarmaPOST } from "../app/api/zadarma/llamada/route";
import { POST as telnyxPOST } from "../app/api/telnyx/llamada/route";
import {
  acquireLeadHold,
  activeBoardHolds,
  leadHoldConflict,
  resetLeadHoldsAvailabilityForTests,
} from "../lib/lead-holds-server";

type Yo = { id: number; nombre: string; permisos: string[]; tiendas: string[]; staffId: number | null };
const ANA: Yo = { id: 7, nombre: "Ana Pérez", permisos: ["leads"], tiendas: ["mireva-cr"], staffId: 21 };
const BEA: Yo = { id: 9, nombre: "Beatriz Mora", permisos: ["leads"], tiendas: ["mireva-cr"], staffId: 22 };
const SUP: Yo = { id: 3, nombre: "Sofía Supervisora", permisos: ["leads", "leads_equipo"], tiendas: ["mireva-cr"], staffId: null };
const ctx = (leadId: number | string = 41) => ({ params: { leadId: String(leadId) } });
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://kairo.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const acquire = (as: Yo, extra: Record<string, unknown> = {}, leadId = 41) => {
  mocks.yo = as;
  return holdPOST(post(`/api/leads/${leadId}/hold`, { store: "mireva-cr", ...extra }), ctx(leadId));
};

beforeEach(() => {
  mocks.yo = null;
  mocks.holds.clear();
  mocks.error = null;
  mocks.rpcCalls.length = 0;
  mocks.dbCalls = 0;
  mocks.getLead.mockReset().mockResolvedValue({ id: 41, store_id: 1, status: "nuevo" });
  mocks.applyDisposition.mockReset().mockResolvedValue({ status: "no_responde", category: "open", callId: 5 });
  mocks.undoDisposition.mockReset().mockResolvedValue({ ok: true, status: "nuevo", category: "open" });
  resetLeadHoldsAvailabilityForTests();
  vi.restoreAllMocks();
});

describe("POST /api/leads/[leadId]/hold", () => {
  it("la primera en abrir lo toma; la segunda queda bloqueada con el nombre de la primera", async () => {
    const a = await (await acquire(ANA)).json();
    expect(a.status).toBe("held");
    expect(a.hold).toMatchObject({ holder_user_id: 7, holder_name: "Ana Pérez" });
    const b = await (await acquire(BEA)).json();
    expect(b).toMatchObject({ status: "blocked", can_take_over: false, hold: { holder_name: "Ana Pérez" } });
    expect(typeof b.server_now).toBe("string");
  });

  it("identidad del servidor, nunca la del navegador", async () => {
    await acquire(BEA, { user_id: 7, holder_name: "Ana Pérez" });
    expect(mocks.rpcCalls[0]).toMatchObject({ p_user_id: 9, p_user_name: "Beatriz Mora", p_ttl_seconds: 600, p_store_id: 1 });
  });

  it("una asesora no puede quitarla aunque mande takeover; supervisión sí", async () => {
    await acquire(ANA);
    const b = await (await acquire(BEA, { takeover: true })).json();
    expect(b.status).toBe("blocked");
    expect(mocks.rpcCalls[1]).toMatchObject({ p_takeover: false });
    const s = await (await acquire(SUP, { takeover: true })).json();
    expect(s).toMatchObject({ status: "held", hold: { holder_user_id: 3 } });
    expect(mocks.rpcCalls[2]).toMatchObject({ p_takeover: true });
  });

  it("supervisión ve el botón (can_take_over) antes de usarlo", async () => {
    await acquire(ANA);
    expect((await (await acquire(SUP)).json()).can_take_over).toBe(true);
  });

  it("release suelta solo la propia", async () => {
    await acquire(ANA);
    const r1 = await acquire(BEA, { action: "release" });
    expect(r1.status).toBe(204);
    expect(mocks.holds.has(41)).toBe(true);
    await acquire(ANA, { action: "release" });
    expect(mocks.holds.has(41)).toBe(false);
  });

  it("sin sesión 401; otro origen 403; lead de otra tienda 404", async () => {
    mocks.yo = null;
    expect((await holdPOST(post("/api/leads/41/hold", { store: "mireva-cr" }), ctx())).status).toBe(401);
    mocks.yo = ANA;
    const cross = post("/api/leads/41/hold", { store: "mireva-cr" }, { origin: "https://evil.test" });
    expect((await holdPOST(cross, ctx())).status).toBe(403);
    expect((await acquire(ANA, {}, 404)).status).toBe(404);
  });

  it("GET dice libre, mía u otra sin tomarla", async () => {
    const get = async (as: Yo) => {
      mocks.yo = as;
      return (await holdGET(new NextRequest("http://kairo.test/api/leads/41/hold?store=mireva-cr"), ctx())).json();
    };
    expect((await get(BEA)).status).toBe("free");
    await acquire(ANA);
    expect((await get(ANA)).status).toBe("mine");
    expect(await get(BEA)).toMatchObject({ status: "other", hold: { holder_name: "Ana Pérez" } });
    expect(mocks.rpcCalls).toHaveLength(1);
  });
});

describe("Las escrituras del lead respetan la reserva (409)", () => {
  const body = { store: "mireva-cr", vendedora_id: 22 };
  const writes: Array<[string, () => Promise<Response>]> = [
    ["gestión", () => dispositionPOST(post("/api/leads/41/disposition", { ...body, status: "no_responde" }), ctx())],
    ["deshacer", () => undoPOST(post("/api/leads/41/disposition/undo", { ...body, call_id: 5 }), ctx())],
    ["WhatsApp", () => sendPOST(post("/api/leads/41/send", { ...body, message: "Hola", origen: "leads" }), ctx())],
    [
      "crear en iComfly",
      () =>
        orderPOST(
          post("/api/leads/41/order", {
            ...body,
            destino: "icomfly",
            request_id: "7f1b3893-81d3-4893-8344-00c5164d8050",
            items: [{ title: "Crema", quantity: 1 }],
          }),
          ctx()
        ),
    ],
    ["generar pedido del carrito", () => cartCompletePOST(post("/api/leads/41/carts/complete", { ...body, draft_id: "123" }), ctx())],
    ["llamada Zadarma", () => zadarmaPOST(post("/api/zadarma/llamada", { ...body, lead_id: 41 }))],
    ["llamada Telnyx", () => telnyxPOST(post("/api/telnyx/llamada", { ...body, lead_id: 41 }))],
  ];

  it.each(writes)("%s: 409 con el nombre de quien lo tiene abierto", async (_name, call) => {
    await acquire(ANA);
    mocks.yo = BEA;
    const res = await call();
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("lead_hold");
    expect(data.hold.holder_name).toBe("Ana Pérez");
    expect(data.error).toMatch(/^Este lead lo tiene abierto Ana Pérez desde las \d\d:\d\d\. Se libera a las \d\d:\d\d \(en 10 min\)\. No se guardó tu cambio\.$/);
    expect(mocks.applyDisposition).not.toHaveBeenCalled();
    expect(mocks.undoDisposition).not.toHaveBeenCalled();
  });

  it("WhatsApp desde Novedades o Gestión (sin origen «leads») no espera la reserva", async () => {
    await acquire(ANA);
    mocks.yo = BEA;
    const res = await sendPOST(post("/api/leads/41/send", { ...body, message: "Hola" }), ctx());
    expect(res.status).not.toBe(409);
  });

  it("quien tiene la reserva escribe normal", async () => {
    await acquire(BEA);
    const res = await writes[0][1]();
    expect(res.status).toBe(200);
    expect(mocks.applyDisposition).toHaveBeenCalledTimes(1);
  });

  it("sin fila (la reserva falló o venció y nadie la tomó): se escribe", async () => {
    mocks.yo = BEA;
    expect((await writes[0][1]()).status).toBe(200);
    mocks.holds.set(41, {
      lead_id: 41,
      store_id: 1,
      holder_user_id: 7,
      holder_name: "Ana Pérez",
      acquired_at: new Date(Date.now() - LEAD_HOLD_MS - 60_000).toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect((await writes[0][1]()).status).toBe(200);
  });

  it("supervisión le quita el lead a Ana: la próxima escritura de Ana es 409 con el nombre de supervisión", async () => {
    await acquire(ANA);
    await acquire(SUP, { takeover: true });
    mocks.yo = ANA;
    const res = await dispositionPOST(post("/api/leads/41/disposition", { ...body, status: "no_responde" }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).hold.holder_name).toBe("Sofía Supervisora");
  });

  it("procesos del sistema (sin persona) nunca quedan bloqueados", async () => {
    await acquire(ANA);
    expect(await leadHoldConflict({ leadId: 41, timeZone: "America/Costa_Rica", yo: null })).toBeNull();
    mocks.yo = null;
    expect(await leadHoldConflict({ leadId: 41, timeZone: "America/Costa_Rica" })).toBeNull();
  });
});

describe("Falla suave: sin la migración o con la base caída, todo sigue como hoy", () => {
  it("tabla faltante: el lead se abre sin reserva, las escrituras pasan, y no se insiste", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.error = { code: "PGRST205", message: "Could not find the table 'public.lead_holds' in the schema cache" };
    const a = await (await acquire(ANA)).json();
    expect(a.status).toBe("unavailable");
    mocks.yo = BEA;
    const res = await dispositionPOST(
      post("/api/leads/41/disposition", { store: "mireva-cr", vendedora_id: 22, status: "no_responde" }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(mocks.applyDisposition).toHaveBeenCalledTimes(1);
    // Tras ver que falta, no vuelve a preguntar por un rato.
    const before = mocks.dbCalls;
    expect((await acquireLeadHold({ leadId: 41, storeId: 1, yo: ANA as never })).status).toBe("unavailable");
    expect(mocks.dbCalls).toBe(before);
    // El aviso del log no lleva nombres ni teléfonos.
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("migración pendiente");
    expect(logged).not.toMatch(/Ana|Beatriz|506/);
  });

  it("función faltante o error cualquiera: se abre sin reserva", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.error = { code: "PGRST202", message: "Could not find the function" };
    expect((await acquireLeadHold({ leadId: 41, storeId: 1, yo: ANA as never })).status).toBe("unavailable");
    resetLeadHoldsAvailabilityForTests();
    mocks.error = { code: "57014", message: "canceling statement due to statement timeout" };
    expect((await acquireLeadHold({ leadId: 41, storeId: 1, yo: ANA as never })).status).toBe("unavailable");
    expect(await leadHoldConflict({ leadId: 41, timeZone: "America/Costa_Rica", yo: BEA as never })).toBeNull();
    expect(await activeBoardHolds(1, 9)).toEqual([]);
  });
});

describe("Candado del tablero", () => {
  it("solo reservas vigentes de OTRAS personas, de esa tienda", async () => {
    await acquire(ANA, {}, 41);
    await acquire(BEA, {}, 42);
    mocks.holds.set(43, {
      lead_id: 43,
      store_id: 1,
      holder_user_id: 7,
      holder_name: "Ana Pérez",
      acquired_at: new Date(Date.now() - LEAD_HOLD_MS - 1).toISOString(),
      expires_at: new Date(Date.now() - 1).toISOString(),
    });
    mocks.holds.set(44, { ...mocks.holds.get(41)!, lead_id: 44, store_id: 2 });
    const holds = await activeBoardHolds(1, 9);
    expect(holds).toEqual([{ lead_id: 41, holder_name: "Ana Pérez", expires_at: mocks.holds.get(41)!.expires_at }]);
  });
});
