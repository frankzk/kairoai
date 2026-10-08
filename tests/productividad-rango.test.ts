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

async function pedir(qs: string) {
  const { GET } = await import("../app/api/leads/productivity/route");
  return GET(new NextRequest(`http://localhost/api/leads/productivity?store=mireva-cr&${qs}`));
}

describe("/api/leads/productivity", () => {
  beforeEach(() => {
    getProductivity.mockReset();
    getProductivity.mockResolvedValue([{ vendedora_id: 1, name: "Susan", gestiones: 10, leads: 8, pedidos: 2 }]);
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
