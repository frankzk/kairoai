// Llamadas en el historial de un pedido (Gestion) y de una novedad.
//
// POR QUE ESTE TEST EXISTE: las llamadas hechas desde Gestion y Novedades se
// guardaban pero no se veian en ninguna ficha. Se buscan por el telefono del
// cliente, normalizado como lo guarda la centralita, con el nombre de la
// asesora, y sin la pata de timbrado de Zadarma que ya contesto (duplicaria
// cada llamada). Desde noviembre 2026 tambien por el pedido (order_name), sin
// repetir la que sale en las dos busquedas, y con el estado de su grabacion.

import { beforeEach, describe, expect, it, vi } from "vitest";

const pedidos: Array<{ tabla: string; columnas: string; eq: Array<[string, unknown]> }> = [];
let filas: Record<string, Record<string, unknown>[]> = {};
/** Simula la base sin la migracion de grabaciones. */
let sinMigracion = false;

vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (tabla: string) => {
      const q = { tabla, columnas: "", eq: [] as Array<[string, unknown]> };
      pedidos.push(q);
      const api: Record<string, unknown> = {
        select: (c: string) => ((q.columnas = c), api),
        eq: (c: string, v: unknown) => (q.eq.push([c, v]), api),
        in: () => api,
        order: () => api,
        limit: () => api,
        then: (ok: (v: unknown) => unknown) => {
          const nuevas = /recording_path|order_name/.test(q.columnas) || q.eq.some(([c]) => c === "order_name");
          if (sinMigracion && tabla === "zadarma_calls" && nuevas) {
            return Promise.resolve({ data: null, error: { code: "42703", message: "column zadarma_calls.recording_path does not exist" } }).then(ok);
          }
          const data = (filas[tabla] ?? []).filter((f) => q.eq.every(([c, v]) => f[c] === v));
          return Promise.resolve({ data, error: null }).then(ok);
        },
      };
      return api;
    },
  }),
}));

beforeEach(() => {
  pedidos.length = 0;
  filas = {};
  sinMigracion = false;
});

const base = { direction: "outgoing", duration_seconds: 0, vendedora: null, provider: "telnyx", store_id: 1, order_name: null };

describe("llamadas de un telefono", () => {
  it("busca por el telefono normalizado y arma la descripcion con la asesora", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    filas.zadarma_calls = [
      { ...base, id: 2, phone: "50661204473", status: "answered", duration_seconds: 80, started_at: "2026-11-01T15:00:00Z", vendedora: 1 },
      { ...base, id: 1, phone: "50661204473", status: "agent_answered", duration_seconds: 5, started_at: "2026-11-01T14:00:00Z", vendedora: 1, provider: "zadarma" },
      { ...base, id: 0, phone: "50661204473", status: "no answer", started_at: "2026-10-31T14:00:00Z", provider: "zadarma" },
      // Preparada y nunca marcada (doble clic del 01/11/2026): no va.
      { ...base, id: -1, phone: "50661204473", status: "not_dialed", started_at: "2026-10-31T13:00:00Z", vendedora: 1 },
    ];
    filas.payroll_staff = [{ id: 1, name: "Daleska Urbina" }];
    const r = await llamadasDelTelefono({ storeCode: "mireva-cr", phone: "6120-4473" });
    expect(pedidos[0]).toMatchObject({ tabla: "zadarma_calls", eq: [["phone", "50661204473"]] });
    expect(r).toEqual([
      { id: 2, at: "2026-11-01T15:00:00Z", descripcion: "Saliente · contestada · 1m 20s", asesora: "Daleska Urbina", proveedor: "telnyx", has_recording: false, grabacion: null },
      { id: 0, at: "2026-10-31T14:00:00Z", descripcion: "Saliente · sin respuesta", asesora: null, proveedor: "zadarma", has_recording: false, grabacion: null },
    ]);
  });

  it("sin telefono valido ni pedido no consulta nada", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    expect(await llamadasDelTelefono({ storeCode: "mireva-cr", phone: "abc" })).toEqual([]);
    expect(pedidos).toEqual([]);
  });
});

describe("llamadas de un pedido (order_name o telefono)", () => {
  it("junta las del pedido y las del telefono, sin repetir, de la mas nueva a la mas vieja", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    filas.zadarma_calls = [
      // Por el pedido Y por el telefono: sale una sola vez.
      { ...base, id: 10, phone: "50661204473", order_name: "#MCRC20388", status: "answered", duration_seconds: 30, started_at: "2026-11-05T15:00:00Z" },
      // Solo por el pedido (el cliente dio otro numero).
      { ...base, id: 11, phone: "50688887777", order_name: "#MCRC20388", status: "busy", started_at: "2026-11-06T15:00:00Z" },
      // Solo por el telefono (desde Leads).
      { ...base, id: 12, phone: "50661204473", status: "no answer", started_at: "2026-11-04T15:00:00Z" },
      // Mismo nombre de pedido en OTRA tienda: no va.
      { ...base, id: 13, phone: "50499998888", order_name: "#MCRC20388", store_id: 2, status: "answered", started_at: "2026-11-07T15:00:00Z" },
    ];
    const r = await llamadasDelTelefono({ storeCode: "mireva-cr", storeId: 1, phone: "6120-4473", orderName: " #MCRC20388 " });
    expect(r.map((l) => l.id)).toEqual([11, 10, 12]);
    const porPedido = pedidos.find((p) => p.eq.some(([c]) => c === "order_name"));
    expect(porPedido?.eq).toEqual([["store_id", 1], ["order_name", "#MCRC20388"]]);
  });

  it("sin telefono, igual encuentra las del pedido", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    filas.zadarma_calls = [{ ...base, id: 11, phone: "50688887777", order_name: "IC-W55", status: "busy", started_at: "2026-11-06T15:00:00Z" }];
    const r = await llamadasDelTelefono({ storeCode: "mireva-cr", storeId: 1, phone: null, orderName: "IC-W55" });
    expect(r.map((l) => l.id)).toEqual([11]);
  });

  it("dice si la grabacion se puede escuchar, se esta procesando o se perdio", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    const t = (id: number, extra: Record<string, unknown>) => ({
      ...base, id, phone: "50661204473", status: "answered", duration_seconds: 10, started_at: `2026-11-0${id}T15:00:00Z`, ...extra,
    });
    filas.zadarma_calls = [
      t(1, { is_recorded: true, recording_path: "1/2026/11/1.mp3", recording_attempts: 0 }),
      t(2, { is_recorded: true, recording_path: null, recording_attempts: 1 }),
      t(3, { is_recorded: true, recording_path: null, recording_attempts: 6 }),
      t(4, { is_recorded: false, recording_path: null, recording_attempts: 0 }),
    ];
    const r = await llamadasDelTelefono({ storeCode: "mireva-cr", phone: "61204473" });
    const porId = Object.fromEntries(r.map((l) => [l.id, [l.has_recording, l.grabacion]]));
    expect(porId).toEqual({ 1: [true, "lista"], 2: [true, "procesando"], 3: [true, "no_disponible"], 4: [false, null] });
    // Ni la ruta del archivo ni el enlace del proveedor salen al navegador.
    expect(JSON.stringify(r)).not.toContain("mp3");
  });

  it("sin la migracion aplicada: las llamadas del telefono igual, sin grabacion ni pedido", async () => {
    const { llamadasDelTelefono } = await import("../lib/llamadas-historial");
    sinMigracion = true;
    filas.zadarma_calls = [{ ...base, id: 5, phone: "50661204473", status: "answered", duration_seconds: 10, started_at: "2026-11-01T15:00:00Z" }];
    const r = await llamadasDelTelefono({ storeCode: "mireva-cr", storeId: 1, phone: "61204473", orderName: "#MCRC1" });
    expect(r).toEqual([expect.objectContaining({ id: 5, grabacion: null, has_recording: false })]);
  });
});
