// Pasada completa de iComfly (migracion 0051).
//
// POR QUE ESTE TEST EXISTE: el cron de iComfly lee solo los 500 pedidos mas
// nuevos y desde el 28/10/2026 los pedidos viven solo en iComfly. Si la pasada
// se salteara paginas faltarian pedidos sin que nadie lo note; si recorriera
// Honduras leeria Costa Rica entera; y si no volviera a empezar, un pedido de
// hace dos semanas que se cancela nunca se actualizaria.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HORAS_ENTRE_PASADAS,
  decidirPasada,
  despuesDelTramo,
  estadoInicial,
  type EstadoHistorial,
} from "../lib/icomfly-historial";
import type { SyncResult } from "../lib/icomfly-sync";

const AHORA = new Date("2026-10-24T12:00:00Z");

function tramo(over: Partial<SyncResult>): SyncResult {
  return {
    synced: 2000,
    pages_fetched: 20,
    next_page: 21,
    has_more: true,
    agents_synced: 0,
    summary: { total: 0, pendiente: 0, despacho_solicitado: 0, despachado: 0, standby: 0 },
    otra_tienda: 0,
    tiendas_ajenas: [],
    ...over,
  };
}

describe("qué hace cada corrida", () => {
  it("la primera vez arranca en la página 1", () => {
    const d = decidirPasada(estadoInicial(1), AHORA);
    expect(d).toEqual({ accion: "seguir", estado: expect.objectContaining({ next_page: 1, pasada_iniciada_at: AHORA.toISOString() }) });
  });
  it("una pasada a medias sigue donde quedó", () => {
    const enCurso: EstadoHistorial = { ...estadoInicial(1), next_page: 41, pasada_iniciada_at: "2026-10-24T10:00:00Z" };
    const d = decidirPasada(enCurso, AHORA);
    expect(d).toEqual({ accion: "seguir", estado: enCurso });
  });
  it("terminada hace poco, espera; pasadas las horas, vuelve a empezar desde el principio", () => {
    const hecha: EstadoHistorial = { ...estadoInicial(1), completo: true, pasadas: 1, pedidos: 13600, completado_at: "2026-10-24T06:00:00Z" };
    expect(decidirPasada(hecha, AHORA)).toEqual({ accion: "esperar" });
    const despues = new Date(Date.parse(hecha.completado_at!) + HORAS_ENTRE_PASADAS * 3_600_000);
    const d = decidirPasada(hecha, despues);
    expect(d).toEqual({
      accion: "seguir",
      estado: expect.objectContaining({ next_page: 1, completo: false, pedidos: 0, pasadas: 1 }),
    });
  });
});

describe("después de cada tramo", () => {
  const enCurso: EstadoHistorial = { ...estadoInicial(1), next_page: 21, pedidos: 2000, pasada_iniciada_at: "2026-10-24T10:00:00Z" };
  it("sigue en la página que viene, sin saltear ninguna", () => {
    const e = despuesDelTramo(enCurso, tramo({ next_page: 41 }), AHORA);
    expect(e).toMatchObject({ next_page: 41, pedidos: 4000, completo: false, ultimo_error: null });
  });
  it("la última página cierra la pasada", () => {
    const e = despuesDelTramo(enCurso, tramo({ synced: 650, next_page: null, has_more: false }), AHORA);
    expect(e).toMatchObject({ completo: true, pasadas: 1, pedidos: 2650, next_page: 1, completado_at: AHORA.toISOString() });
  });
  it("una página entera de otra tienda no avanza y queda anotado", () => {
    const e = despuesDelTramo(
      enCurso,
      tramo({ synced: 0, pages_fetched: 1, next_page: 22, otra_tienda: 100, tiendas_ajenas: ["71 (Mireva Costa Rica)"] }),
      AHORA
    );
    expect(e.next_page).toBe(21);
    expect(e.ultimo_error).toBe("iComfly devolvió 100 pedidos de la tienda 71 (Mireva Costa Rica)");
  });
});

// ── La corrida completa, con el sync y la base simulados ─────────────────────

let guardado: EstadoHistorial | null = null;
const tramos: number[] = [];
let respuestas: Array<SyncResult | Error> = [];

vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: guardado, error: null }) }) }),
      upsert: async (fila: EstadoHistorial) => {
        guardado = { ...fila };
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@/lib/icomfly-sync", () => ({
  runIcomflySync: async (opts: { startPage: number }) => {
    tramos.push(opts.startPage);
    const r = respuestas.shift();
    if (!r) throw new Error("sin respuesta preparada");
    if (r instanceof Error) throw r;
    return r;
  },
}));

describe("la corrida", () => {
  beforeEach(() => {
    guardado = null;
    tramos.length = 0;
    respuestas = [];
  });
  it("recorre tramo tras tramo hasta el final y guarda el avance", async () => {
    respuestas = [tramo({ next_page: 21 }), tramo({ next_page: 41 }), tramo({ synced: 300, next_page: null, has_more: false })];
    const { avanzarHistorial } = await import("../lib/icomfly-historial");
    const r = await avanzarHistorial({ id: 1, code: "mireva-cr" }, Date.now() + 60_000, () => AHORA);
    expect(tramos).toEqual([1, 21, 41]);
    expect(r).toMatchObject({ accion: "seguir", pedidos: 4300, completo: true });
    expect(guardado).toMatchObject({ completo: true, pasadas: 1, pedidos: 4300 });
  });
  it("si iComfly falla, anota el error y la próxima corrida retoma la misma página", async () => {
    guardado = { ...estadoInicial(1), next_page: 41, pasada_iniciada_at: "2026-10-24T10:00:00Z" };
    respuestas = [new Error("iComfly API error 502")];
    const { avanzarHistorial } = await import("../lib/icomfly-historial");
    const r = await avanzarHistorial({ id: 1, code: "mireva-cr" }, Date.now() + 60_000, () => AHORA);
    expect(r.error).toBe("iComfly API error 502");
    expect(guardado).toMatchObject({ next_page: 41, ultimo_error: "iComfly API error 502" });
  });
  it("con otra tienda en la respuesta, hace un solo llamado y no avanza", async () => {
    respuestas = [tramo({ synced: 0, pages_fetched: 1, next_page: 2, otra_tienda: 100, tiendas_ajenas: ["71 (Mireva Costa Rica)"] })];
    const { avanzarHistorial } = await import("../lib/icomfly-historial");
    const r = await avanzarHistorial({ id: 2, code: "mireva-hn" }, Date.now() + 60_000, () => AHORA);
    expect(tramos).toEqual([1]);
    expect(r).toMatchObject({ next_page: 1, error: "iComfly devolvió 100 pedidos de la tienda 71 (Mireva Costa Rica)" });
  });
});
