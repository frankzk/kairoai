// Gestion lee TODOS los pedidos de la tienda, los mas nuevos primero.
//
// POR QUE ESTE TEST EXISTE: el dataset de Gestion leia 20.000 pedidos de
// Shopify y 5.000 de iComfly. Costa Rica tiene 25.935 y 24.337 (25/10/2026):
// faltaban los 5.935 pedidos mas viejos y el estado de despacho de la mayoria.
// Y los 5.000 de iComfly ni siquiera eran los ultimos: se ordenaban por
// requested_at, que iComfly dejo de mandar (null en todos), asi que el orden lo
// decidia Postgres y las paginas se pisaban.

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const llamadas: string[] = [];
let totalFilas = 0;
vi.mock("@/lib/db", () => {
  const cadena = (): unknown => {
    let rango: [number, number] = [0, 0];
    const api: Record<string, unknown> = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") {
            const filas = Array.from({ length: Math.max(0, Math.min(rango[1], totalFilas - 1) - rango[0] + 1) }, (_, i) => ({
              icomfly_order_id: String(rango[0] + i),
            }));
            return (ok: (v: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok);
          }
          return (...args: unknown[]) => {
            if (prop === "range") rango = [Number(args[0]), Number(args[1])];
            if (prop === "order") llamadas.push(`order:${String(args[0])}:${JSON.stringify(args[1])}`);
            return api;
          };
        },
      }
    );
    return api;
  };
  return { getDB: () => ({ from: () => cadena() }) };
});

beforeEach(() => {
  llamadas.length = 0;
  totalFilas = 24_337;
});

describe("pedidos de iComfly", () => {
  it("los más nuevos primero, en un orden total (no por requested_at, que viene vacío)", async () => {
    const { listIcomflyOrders } = await import("../lib/finance");
    await listIcomflyOrders({ storeId: 1 });
    expect(llamadas.slice(0, 2)).toEqual([
      'order:icomfly_created_at:{"ascending":false,"nullsFirst":false}',
      'order:icomfly_order_id:{"ascending":false}',
    ]);
    expect(llamadas.some((l) => l.includes("requested_at"))).toBe(false);
  });

  it("con el tope del dataset trae los 24.337 de Costa Rica, sin repetir", async () => {
    const { listIcomflyOrders } = await import("../lib/finance");
    const { MAX_PEDIDOS_DATASET } = await import("../app/api/finance/_shared/orders-dataset");
    const todos = await listIcomflyOrders({ storeId: 1, limit: MAX_PEDIDOS_DATASET });
    expect(todos).toHaveLength(24_337);
    expect(new Set(todos.map((o) => o.icomfly_order_id)).size).toBe(24_337);
  });
});

describe("el dataset de Gestión", () => {
  it("pide todos los pedidos de Shopify y de iComfly, con margen sobre lo que hay hoy", async () => {
    const { MAX_PEDIDOS_DATASET } = await import("../app/api/finance/_shared/orders-dataset");
    expect(MAX_PEDIDOS_DATASET).toBeGreaterThan(25_935 * 2);
    const src = readFileSync("app/api/finance/_shared/orders-dataset.ts", "utf8");
    expect(src).toContain("listPersistedShopifyOrders(MAX_PEDIDOS_DATASET, 0, store.id)");
    expect(src).toContain("listIcomflyOrders({ storeId: store.id, limit: MAX_PEDIDOS_DATASET })");
  });
});
