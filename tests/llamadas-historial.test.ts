// Llamadas en el historial de un pedido (Gestion) y de una novedad.
//
// POR QUE ESTE TEST EXISTE: las llamadas hechas desde Gestion y Novedades se
// guardaban pero no se veian en ninguna ficha. Se buscan por el telefono del
// cliente, normalizado como lo guarda la centralita, con el nombre de la
// asesora, y sin la pata de timbrado de Zadarma que ya contesto (duplicaria
// cada llamada).

import { beforeEach, describe, expect, it, vi } from "vitest";

const pedidos: Array<{ tabla: string; eq: Array<[string, unknown]> }> = [];
let filas: Record<string, Record<string, unknown>[]> = {};

vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (tabla: string) => {
      const q = { tabla, eq: [] as Array<[string, unknown]> };
      pedidos.push(q);
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (c: string, v: unknown) => (q.eq.push([c, v]), api),
        in: () => api,
        order: () => api,
        limit: () => api,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas[tabla] ?? [], error: null }).then(ok),
      };
      return api;
    },
  }),
}));

beforeEach(() => {
  pedidos.length = 0;
  filas = {};
});

describe("llamadas de un telefono", () => {
  it("busca por el telefono normalizado y arma la descripcion con la asesora", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    filas.zadarma_calls = [
      { id: 2, direction: "outgoing", status: "answered", duration_seconds: 80, started_at: "2026-11-01T15:00:00Z", vendedora: 1, provider: "telnyx" },
      { id: 1, direction: "outgoing", status: "agent_answered", duration_seconds: 5, started_at: "2026-11-01T14:00:00Z", vendedora: 1, provider: "zadarma" },
      { id: 0, direction: "outgoing", status: "no answer", duration_seconds: 0, started_at: "2026-10-31T14:00:00Z", vendedora: null, provider: "zadarma" },
      // Preparada y nunca marcada (doble clic del 01/11/2026): no va.
      { id: -1, direction: "outgoing", status: "not_dialed", duration_seconds: 0, started_at: "2026-10-31T13:00:00Z", vendedora: 1, provider: "telnyx" },
    ];
    filas.payroll_staff = [{ id: 1, name: "Daleska Urbina" }];
    const r = await llamadasDelTelefono({ storeCode: "mireva-cr", phone: "6120-4473" });
    expect(pedidos[0]).toMatchObject({ tabla: "zadarma_calls", eq: [["phone", "50661204473"]] });
    expect(r).toEqual([
      { id: 2, at: "2026-11-01T15:00:00Z", descripcion: "Saliente · contestada · 1m 20s", asesora: "Daleska Urbina", proveedor: "telnyx" },
      { id: 0, at: "2026-10-31T14:00:00Z", descripcion: "Saliente · sin respuesta", asesora: null, proveedor: "zadarma" },
    ]);
  });

  it("sin telefono valido no consulta nada", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    expect(await llamadasDelTelefono({ storeCode: "mireva-cr", phone: "abc" })).toEqual([]);
    expect(pedidos).toEqual([]);
  });
});
