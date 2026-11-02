// Una reconstruccion del dataset de Gestion a la vez.
//
// POR QUE ESTE TEST EXISTE: el 02/11/2026 a las 15:52 UTC Postgres (2 GB) se
// reinicio por memoria. Se juntaron varias reconstrucciones completas del
// dataset (crons y "Actualizar Moovin", que reconstruia una vez por cada lote
// de 50 guias); cada una lee todas las tablas. Ese minuto cayeron Gestion,
// Finanzas, Leads y el telefono de las asesoras. Ahora hay un solo turno: quien
// llega mientras otra corre deja la tienda pendiente y no lee nada.

import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  ocupadoHasta: 0,
  pendientes: new Set<number>(),
  rpcRota: false,
  baseRota: false,
  lecturas: 0,
};

vi.mock("@/lib/db", () => {
  const cadena = (tabla: string): unknown => {
    const api: Record<string, unknown> = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") {
            if (tabla !== "finance_dataset_turno") estado.lecturas += 1;
            const data =
              tabla === "finance_dataset_turno" ? Array.from(estado.pendientes).map((store_id) => ({ store_id })) : [];
            const r = estado.baseRota && tabla !== "finance_dataset_turno" ? { data: null, error: { message: "base caida" } } : { data, error: null };
            return (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok);
          }
          return () => api;
        },
      }
    );
    return api;
  };
  const rpc = async (nombre: string, args: { p_store?: number; p_segundos?: number }) => {
    if (estado.rpcRota) return { data: null, error: { message: "function does not exist" } };
    if (nombre === "finance_dataset_tomar_turno") {
      if (estado.ocupadoHasta > Date.now()) {
        estado.pendientes.add(Number(args.p_store));
        return { data: false, error: null };
      }
      estado.ocupadoHasta = Date.now() + Number(args.p_segundos) * 1000;
      estado.pendientes.delete(Number(args.p_store));
      return { data: true, error: null };
    }
    if (nombre === "finance_dataset_soltar_turno") {
      estado.ocupadoHasta = 0;
      return { data: null, error: null };
    }
    if (nombre === "finance_dataset_marcar_pendiente") {
      estado.pendientes.add(Number(args.p_store));
      return { data: null, error: null };
    }
    return { data: null, error: { message: `rpc ${nombre}` } };
  };
  return { getDB: () => ({ from: (t: string) => cadena(t), rpc }) };
});

const CR = { id: 1, code: "mireva-cr", currency: "CRC", logisticsProvider: "moovin" } as never;

beforeEach(() => {
  estado.ocupadoHasta = 0;
  estado.pendientes.clear();
  estado.rpcRota = false;
  estado.baseRota = false;
  estado.lecturas = 0;
});

describe("turno de reconstrucción del dataset", () => {
  it("si llegan dos a la vez, reconstruye una y la otra queda pendiente sin leer nada", async () => {
    const { refreshFinanceDatasetCache, EN_COLA } = await import("../app/api/finance/_shared/orders-dataset");
    const [a, b] = await Promise.all([refreshFinanceDatasetCache(CR), refreshFinanceDatasetCache(CR)]);
    expect([a, b].filter((r) => r === EN_COLA)).toHaveLength(1);
    expect([a, b].filter((r) => r === 0)).toHaveLength(1); // la que reconstruyo (dataset vacio)
    expect(estado.pendientes.has(1)).toBe(true);
    expect(estado.ocupadoHasta).toBe(0); // soltado al terminar
  });

  it("con el turno ocupado no toca las tablas del dataset", async () => {
    const { refreshFinanceDatasetCache, EN_COLA } = await import("../app/api/finance/_shared/orders-dataset");
    estado.ocupadoHasta = Date.now() + 60_000;
    expect(await refreshFinanceDatasetCache(CR)).toBe(EN_COLA);
    expect(estado.lecturas).toBe(0);
  });

  it("el cron hace las pendientes y las limpia", async () => {
    const { tiendasConDatasetPendiente, refreshFinanceDatasetCache } = await import("../app/api/finance/_shared/orders-dataset");
    estado.pendientes.add(1);
    expect(await tiendasConDatasetPendiente()).toEqual([1]);
    expect(await refreshFinanceDatasetCache(CR)).toBe(0);
    expect(estado.pendientes.has(1)).toBe(false);
  });

  it("si la reconstrucción falla, suelta el turno y la tienda vuelve a quedar pendiente", async () => {
    const { refreshFinanceDatasetCache } = await import("../app/api/finance/_shared/orders-dataset");
    estado.baseRota = true;
    await expect(refreshFinanceDatasetCache(CR)).rejects.toThrow();
    expect(estado.ocupadoHasta).toBe(0);
    expect(estado.pendientes.has(1)).toBe(true);
  });

  it("si no se puede consultar el turno, reconstruye como antes (no deja la cache sin hacer)", async () => {
    const { refreshFinanceDatasetCache } = await import("../app/api/finance/_shared/orders-dataset");
    estado.rpcRota = true;
    expect(await refreshFinanceDatasetCache(CR)).toBe(0);
    expect(estado.lecturas).toBeGreaterThan(0);
  });
});
