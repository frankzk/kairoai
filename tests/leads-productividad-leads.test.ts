import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Identidad } from "../lib/auth";
import { supabaseEnMemoria } from "./helpers/supabase-memoria";
import {
  acumularGestiones,
  etiquetaVerLeads,
  leadsOrdenados,
  periodoExacto,
  resumenTipos,
  type GestionDeProductividad,
  type ResumenAsesora,
} from "../lib/leads-productividad-leads";

const state = vi.hoisted(() => ({
  yo: null as Identidad | null,
  db: null as unknown,
  presence: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDB: () => state.db }));
vi.mock("@/lib/identidad", () => ({ identidadActual: () => state.yo, autorDeGestion: () => null }));
vi.mock("@/lib/stores", () => ({
  getRequiredStoreFromSearchParams: (sp: URLSearchParams) => {
    const code = sp.get("store") || "";
    if (!state.yo?.tiendas.includes(code)) return null;
    return code === "mireva-cr" ? { id: 1, code } : code === "mireva-hn" ? { id: 2, code } : null;
  },
}));
vi.mock("@/lib/leads-presence-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/leads-presence-server")>()),
  readPresence: (...args: unknown[]) => state.presence(...args),
}));

import { getLeadsDeAsesora, getProductivity } from "../lib/leads";
import { GET as productividad } from "../app/api/leads/productivity/route";
import { GET as listaDeLeads } from "../app/api/leads/productivity/leads/route";

// "Hoy" 28/11/2026 en Costa Rica: [06:00Z del 28, 06:00Z del 29).
const FROM = "2026-11-28T06:00:00.000Z";
const TO = "2026-11-29T06:00:00.000Z";
const en = (min: number) => new Date(Date.parse(FROM) + min * 60_000).toISOString();
const KINDS = ["state_change", "note", "sale", "undo"];

function sembrar() {
  const lead_calls: Array<Record<string, unknown>> = [];
  let id = 0;
  const gestion = (vendedora: number | null, lead_id: number, occurred_at: string, kind = "state_change", store_id = 1) =>
    lead_calls.push({ id: ++id, store_id, vendedora, lead_id, kind, occurred_at, note: "texto privado" });
  // Ana (24): 1.500 gestiones sobre 300 leads (mas de una pagina de PostgREST).
  for (let i = 0; i < 1500; i++) gestion(24, 1 + (i % 300), en(10 + (i % 1000)), KINDS[i % KINDS.length]);
  gestion(24, 301, FROM); // justo en el borde de abajo: cuenta
  gestion(24, 302, TO); // justo en el borde de arriba: NO cuenta
  gestion(24, 303, "2026-11-28T05:59:59.000Z"); // el dia anterior: NO cuenta
  gestion(24, 900, en(30), "sale", 2); // otra tienda: NO cuenta
  // Bea (25): comparte leads con Ana; su numero es solo de ella.
  for (let i = 0; i < 10; i++) gestion(25, i < 9 ? 1 + (i % 5) : 400, en(100 + i));
  // Sin asesora (sistema): no cuenta para nadie.
  gestion(null, 500, en(50), "system");
  const leads: Array<Record<string, unknown>> = [];
  for (const lid of [...Array.from({ length: 303 }, (_, i) => i + 1), 400, 500]) {
    leads.push({
      id: lid, store_id: 1, phone: `5068${String(lid).padStart(7, "0")}`, name: `Cliente ${lid}`,
      status: lid % 2 ? "no_responde" : "pedido_generado", category: "open", status_source: "manual",
      labels: lid === 1 ? ["VIP"] : null, has_order: lid % 2 === 0, shopify_cart_open: false,
      shopify_draft_cart_count: 0, has_cart_signal: false, inbound_count: 3, cart_item_count: 0,
      first_inbound_text: "no se debe leer",
    });
  }
  leads.push({ id: 900, store_id: 2, phone: "50499999999", name: "Otra tienda", status: "nuevo", labels: [] });
  return { lead_calls, leads, payroll_staff: [{ id: 24, name: "Ana" }, { id: 25, name: "Bea" }] };
}

let mem: ReturnType<typeof supabaseEnMemoria>;
const ANA: Identidad = { id: 5, nombre: "Ana", staffId: 24, tiendas: ["mireva-cr"], permisos: ["leads"] };
const SUPERVISORA: Identidad = { id: 9, nombre: "Sup", staffId: null, tiendas: ["mireva-cr"], permisos: ["leads", "leads_productividad"] };
const lista = (q: Record<string, string>) =>
  listaDeLeads(new NextRequest(`https://kairo.test/api/leads/productivity/leads?${new URLSearchParams(q)}`));
const base = { store: "mireva-cr", from: FROM, to: TO };

beforeEach(() => {
  mem = supabaseEnMemoria(sembrar());
  state.db = mem.db;
  state.yo = SUPERVISORA;
  state.presence.mockReset().mockResolvedValue([
    { user_id: 5, staff_id: 24, name: "Ana", active_until: null, connected_until: null, last_activity_at: null, last_seen_at: null },
    { user_id: 6, staff_id: 25, name: "Bea", active_until: null, connected_until: null, last_activity_at: null, last_seen_at: null },
  ]);
});

describe("la regla de la columna Leads", () => {
  it("cuenta leads distintos por asesora, con primera/ultima gestion y tipos; sin asesora no cuenta", () => {
    const filas: GestionDeProductividad[] = [
      { vendedora: 24, kind: "state_change", lead_id: 1, occurred_at: "2026-11-28T15:00:00Z" },
      { vendedora: 24, kind: "note", lead_id: 1, occurred_at: "2026-11-28T14:00:00Z" },
      { vendedora: 24, kind: "sale", lead_id: 2, occurred_at: "2026-11-28T16:00:00Z" },
      { vendedora: 25, kind: "state_change", lead_id: 1, occurred_at: "2026-11-28T13:00:00Z" },
      { vendedora: null, kind: "system", lead_id: 3, occurred_at: "2026-11-28T13:00:00Z" },
    ];
    const acc = new Map<number, ResumenAsesora>();
    acumularGestiones(acc, filas.slice(0, 2));
    acumularGestiones(acc, filas.slice(2)); // por paginas da lo mismo
    expect(Array.from(acc.keys()).sort()).toEqual([24, 25]);
    const ana = acc.get(24)!;
    expect({ gestiones: ana.gestiones, pedidos: ana.pedidos, leads: ana.leads.size }).toEqual({ gestiones: 3, pedidos: 1, leads: 2 });
    expect(leadsOrdenados(ana).map((l) => l.lead_id)).toEqual([2, 1]);
    expect(ana.leads.get(1)).toMatchObject({ gestiones: 2, primera: "2026-11-28T14:00:00Z", ultima: "2026-11-28T15:00:00Z", tipos: { state_change: 1, note: 1 } });
    expect(resumenTipos({ note: 1, state_change: 2, sale: 1 })).toBe("1 pedido · 2 resultados · 1 WhatsApp");
    expect(etiquetaVerLeads(25, "Ana")).toBe("Ver los 25 leads que gestionó Ana");
    expect(etiquetaVerLeads(1, "Ana")).toBe("Ver el lead que gestionó Ana");
  });

  it("el periodo exacto: ordenado, ISO de verdad y de a lo sumo un año", () => {
    expect(periodoExacto(FROM, TO)).toEqual({ fromIso: FROM, toIso: TO });
    expect(periodoExacto(TO, FROM)).toBeNull();
    expect(periodoExacto(FROM, FROM)).toBeNull();
    expect(periodoExacto("2026-11-28", TO)).toBeNull();
    expect(periodoExacto(FROM, null)).toBeNull();
    expect(periodoExacto("2025-01-01T06:00:00.000Z", TO)).toBeNull();
    expect(periodoExacto("2025-11-28T06:00:00.000Z", TO)).not.toBeNull();
  });
});

describe("conteo de la tabla == lista de la asesora (misma regla, mismo filtro)", () => {
  it("con paginas, bordes del periodo, otra tienda y gestiones compartidas", async () => {
    const tabla = await getProductivity(1, FROM, TO);
    const porAsesora = new Map(tabla.map((r) => [r.vendedora_id, r]));
    expect(porAsesora.get(24)?.leads).toBe(301);
    expect(porAsesora.get(25)?.leads).toBe(6);
    for (const fila of tabla) {
      const r = await getLeadsDeAsesora(1, fila.vendedora_id, FROM, TO);
      expect(r.total).toBe(fila.leads);
      expect(r.leads).toHaveLength(fila.leads);
      expect(r.gestiones).toBe(fila.gestiones);
      expect(new Set(r.leads.map((l) => l.lead_id)).size).toBe(fila.leads);
      expect(r.incompleto).toBe(false);
    }
    const ana = await getLeadsDeAsesora(1, 24, FROM, TO);
    const ids = ana.leads.map((l) => l.lead_id);
    expect(ids).toContain(301);
    expect(ids).not.toContain(302);
    expect(ids).not.toContain(303);
    expect(ids).not.toContain(900);
    expect(ana.leads.every((l) => l.lead && l.lead.store_id === 1)).toBe(true);
  });

  it("consultas acotadas e indexadas: vendedora + fecha ordenada por pagina, fichas por id en tandas y sin textos de mas", async () => {
    await getLeadsDeAsesora(1, 24, FROM, TO);
    const gestiones = mem.consultas.filter((c) => c.tabla === "lead_calls");
    expect(gestiones).toHaveLength(2); // 1.503 filas: dos paginas
    for (const c of gestiones) {
      expect(c.ops).toEqual(expect.arrayContaining([
        ["eq", "store_id", 1], ["gte", "occurred_at", FROM], ["lt", "occurred_at", TO],
        ["not", "vendedora", "is", null], ["eq", "vendedora", 24],
        ["order", "occurred_at", { ascending: false }],
      ]));
      expect(c.ops.find((o) => o[0] === "select")?.[1]).toBe("vendedora,kind,lead_id,occurred_at");
    }
    expect(gestiones.map((c) => c.ops.find((o) => o[0] === "range"))).toEqual([["range", 0, 999], ["range", 1000, 1999]]);
    const fichas = mem.consultas.filter((c) => c.tabla === "leads");
    expect(fichas).toHaveLength(3); // 301 leads en tandas de 125
    for (const c of fichas) {
      expect(c.ops).toContainEqual(["eq", "store_id", 1]);
      expect((c.ops.find((o) => o[0] === "in")?.[2] as unknown[]).length).toBeLessThanOrEqual(125);
      expect(String(c.ops.find((o) => o[0] === "select")?.[1])).not.toMatch(/first_inbound_text|\*/);
    }
  });

  it("con mas de 500 leads trae la ficha de los 500 mas recientes, pero el total sigue siendo el de la tabla", async () => {
    const t = sembrar();
    for (let i = 0; i < 520; i++) {
      t.lead_calls.push({ id: 10_000 + i, store_id: 1, vendedora: 26, lead_id: 2000 + i, kind: "state_change", occurred_at: en(i) });
      t.leads.push({ id: 2000 + i, store_id: 1, phone: "50600000000", name: `L${i}`, status: "nuevo", labels: [] });
    }
    state.db = supabaseEnMemoria(t).db;
    const tabla = await getProductivity(1, FROM, TO);
    const r = await getLeadsDeAsesora(1, 26, FROM, TO);
    expect(r.total).toBe(tabla.find((x) => x.vendedora_id === 26)?.leads);
    expect(r.total).toBe(520);
    expect(r.leads).toHaveLength(500);
    expect(r.leads[0].lead_id).toBe(2519); // la mas reciente primero
  });
});

describe("GET /api/leads/productivity/leads", () => {
  it("cada numero de la tabla abre una lista del mismo largo, con el periodo exacto que devolvio la tabla", async () => {
    const res = await productividad(new NextRequest("https://kairo.test/api/leads/productivity?store=mireva-cr&from=2026-11-28&to=2026-11-28"));
    const tabla = await res.json();
    expect(tabla.from).toBe(FROM);
    expect(tabla.to).toBe(TO);
    expect(tabla.rows.length).toBe(2);
    for (const fila of tabla.rows) {
      const body = await (await lista({ ...base, staff: String(fila.vendedora_id), from: tabla.from, to: tabla.to })).json();
      expect(body.total).toBe(fila.leads);
      expect(body.leads).toHaveLength(fila.leads);
    }
  });

  it("devuelve cada lead con la forma del tablero para abrir su ficha (reserva incluida)", async () => {
    const res = await lista({ ...base, staff: "24" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    const uno = body.leads.find((l: { lead_id: number }) => l.lead_id === 1);
    expect(uno.lead).toMatchObject({ id: 1, store_id: 1, name: "Cliente 1", labels: ["VIP"], board_stage: "seguimiento", work_state: "seguimiento", in_call_queue: true });
    expect(body.leads.find((l: { lead_id: number }) => l.lead_id === 2).lead.labels).toEqual([]);
    expect(uno.lead).not.toHaveProperty("first_inbound_text");
    expect(uno.tipos).toEqual(expect.objectContaining({ state_change: expect.any(Number) }));
  });

  it("exige sesion, tienda permitida, asesora y periodo validos", async () => {
    state.yo = null;
    expect((await lista({ ...base, staff: "24" })).status).toBe(401);
    state.yo = SUPERVISORA;
    expect((await lista({ ...base, store: "mireva-hn", staff: "24" })).status).toBe(400);
    expect((await lista({ ...base, staff: "abc" })).status).toBe(400);
    expect((await lista({ ...base, staff: "0" })).status).toBe(400);
    expect((await lista({ ...base, staff: "24", from: TO, to: FROM })).status).toBe(400);
    expect((await lista({ ...base, staff: "24", from: "2024-01-01T06:00:00.000Z" })).status).toBe(400);
    expect(mem.consultas).toHaveLength(0); // nada llega a la base
  });

  it("permisos de la tabla: supervision ve a cualquiera; la asesora solo su propia lista", async () => {
    expect((await lista({ ...base, staff: "25" })).status).toBe(200);
    state.yo = { ...SUPERVISORA, permisos: ["leads", "leads_equipo"] };
    expect((await lista({ ...base, staff: "25" })).status).toBe(200);
    state.yo = ANA;
    mem.consultas.length = 0;
    const ajena = await lista({ ...base, staff: "25" });
    expect(ajena.status).toBe(403);
    expect(mem.consultas).toHaveLength(0);
    const propia = await (await lista({ ...base, staff: "24" })).json();
    expect(propia.total).toBe(301);
    state.yo = { ...ANA, staffId: null };
    expect((await lista({ ...base, staff: "24" })).status).toBe(403);
  });

  it("la tienda manda: la misma asesora en Honduras ve solo lo de Honduras", async () => {
    state.yo = { ...SUPERVISORA, tiendas: ["mireva-cr", "mireva-hn"] };
    const body = await (await lista({ ...base, store: "mireva-hn", staff: "24" })).json();
    expect(body.total).toBe(1);
    expect(body.leads[0]).toMatchObject({ lead_id: 900, lead: { store_id: 2, name: "Otra tienda" } });
  });
});
