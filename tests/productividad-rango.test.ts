// Productividad con rango de fechas a mano (Desde/Hasta), ademas de las
// ventanas fijas Hoy / Ayer / 7 dias / 30 dias / Este mes.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { crDateRange, MAX_CUSTOM_RANGE_DAYS } from "../lib/leads-metrics";

describe("crDateRange", () => {
  it("Desde y Hasta son dias locales INCLUSIVOS (Costa Rica, UTC-6)", () => {
    // Del 01/10 00:00 local (06:00 UTC) al 07/10 23:59:59 local: el limite de
    // arriba es la medianoche local del 08/10.
    expect(crDateRange("2026-10-01", "2026-10-07")).toEqual({
      fromIso: "2026-10-01T06:00:00.000Z",
      toIso: "2026-10-08T06:00:00.000Z",
    });
  });

  it("una sola fecha es ese dia completo", () => {
    const dia = { fromIso: "2026-10-05T06:00:00.000Z", toIso: "2026-10-06T06:00:00.000Z" };
    expect(crDateRange("2026-10-05", "")).toEqual(dia);
    expect(crDateRange(null, "2026-10-05")).toEqual(dia);
    expect(crDateRange("2026-10-05", "2026-10-05")).toEqual(dia);
  });

  it("rechaza Desde posterior a Hasta", () => {
    expect(crDateRange("2026-10-07", "2026-10-01")).toBeNull();
  });

  it("rechaza fechas que no existen o mal escritas", () => {
    expect(crDateRange("2026-02-31", "2026-03-01")).toBeNull();
    expect(crDateRange("07/10/2026", "")).toBeNull();
    expect(crDateRange("", "")).toBeNull();
  });

  it("acepta hasta un año y rechaza mas", () => {
    expect(MAX_CUSTOM_RANGE_DAYS).toBe(366);
    expect(crDateRange("2025-10-08", "2026-10-08")).not.toBeNull(); // 366 dias
    expect(crDateRange("2025-10-07", "2026-10-08")).toBeNull(); // 367
  });
});

const getProductivity = vi.fn();
vi.mock("@/lib/leads", () => ({ getProductivity: (...a: unknown[]) => getProductivity(...a) }));

// Quien consulta. Los tests de rango usan un administrador autenticado.
let yo: { id: number; nombre: string; permisos: string[]; tiendas: string[]; staffId: number | null } | null = null;
vi.mock("@/lib/identidad", () => ({
  identidadActual: () => yo,
  tiendasPermitidas: () => (yo ? yo.tiendas : null),
}));
// Estas pruebas cubren rangos/permisos. Sus asesoras de ejemplo tienen conexión
// en el período; el filtrado del historial se prueba en leads-presence-server.
vi.mock("@/lib/leads-presence-server", () => ({ readPresence: async () => {
  const metrics = await getProductivity.mock.results.at(-1)?.value ?? [];
  const team = yo?.permisos.some((p) => ["leads_equipo", "leads_productividad", "usuarios"].includes(p));
  return metrics.filter((r: { vendedora_id: number }) => team || r.vendedora_id === yo?.staffId).map((r: { vendedora_id: number; name: string }) => ({
    user_id: r.vendedora_id === yo?.staffId ? yo.id : r.vendedora_id + 1000,
    staff_id: r.vendedora_id, name: r.name, last_activity_at: null, last_seen_at: null,
    active_until: null, connected_until: null, period_last_seen_at: "2026-10-05T12:00:00Z",
  }));
} }));

async function pedir(qs: string) {
  const { GET } = await import("../app/api/leads/productivity/route");
  return GET(new NextRequest(`http://localhost/api/leads/productivity?store=mireva-cr&${qs}`));
}

describe("/api/leads/productivity", () => {
  beforeEach(() => {
    yo = { id: 0, nombre: "Administrador", permisos: ["leads", "leads_equipo"], tiendas: ["mireva-cr"], staffId: null };
    getProductivity.mockReset();
    getProductivity.mockResolvedValue([{ vendedora_id: 1, name: "Susan", gestiones: 10, leads: 8, pedidos: 2 }]);
  });

  describe("que filas ve cada quien", () => {
    const equipo = [
      { vendedora_id: 19, name: "Leonor", gestiones: 2, leads: 2, pedidos: 1 },
      { vendedora_id: 21, name: "Mónica", gestiones: 16, leads: 15, pedidos: 1 },
    ];
    const asesora = (permisos: string[]) => ({ id: 9, nombre: "Mónica", permisos, tiendas: ["mireva-cr"], staffId: 21 });

    it("una asesora sin permisos extra ve solo su fila", async () => {
      getProductivity.mockResolvedValue(equipo);
      yo = asesora(["leads"]);
      const json = await (await pedir("range=hoy")).json();
      expect(json.rows.map((r: { name: string }) => r.name)).toEqual(["Mónica"]);
      expect(json.solo_propia).toBe(true);
    });

    it("con 'ver productividad del equipo' ve a todo el equipo", async () => {
      getProductivity.mockResolvedValue(equipo);
      yo = asesora(["leads", "leads_productividad"]);
      const json = await (await pedir("range=hoy")).json();
      expect(json.rows).toHaveLength(2);
      expect(json.solo_propia).toBe(false);
      expect(json.totals).toEqual({ gestiones: 18, leads: 17, pedidos: 2 });
    });

    it("supervision tambien ve a todo el equipo", async () => {
      getProductivity.mockResolvedValue(equipo);
      yo = asesora(["leads", "leads_equipo"]);
      expect((await (await pedir("range=hoy")).json()).rows).toHaveLength(2);
    });
  });

  it("con from/to consulta exactamente ese rango", async () => {
    const res = await pedir("from=2026-10-01&to=2026-10-07");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(getProductivity).toHaveBeenCalledWith(1, "2026-10-01T06:00:00.000Z", "2026-10-08T06:00:00.000Z");
    expect(json.range).toBe("custom");
    expect(json.totals).toEqual({ gestiones: 10, leads: 8, pedidos: 2 });
  });

  it("las fechas mandan sobre range", async () => {
    await pedir("range=hoy&from=2026-10-01&to=2026-10-07");
    expect(getProductivity).toHaveBeenCalledWith(1, "2026-10-01T06:00:00.000Z", "2026-10-08T06:00:00.000Z");
  });

  it("un rango invalido responde 400 y no consulta", async () => {
    const res = await pedir("from=2026-10-07&to=2026-10-01");
    expect(res.status).toBe(400);
    expect(getProductivity).not.toHaveBeenCalled();
  });

  it("sin fechas sigue funcionando con las ventanas de siempre", async () => {
    const res = await pedir("range=7d");
    expect(res.status).toBe(200);
    expect((await res.json()).range).toBe("7d");
    expect(getProductivity).toHaveBeenCalledTimes(1);
  });
});
