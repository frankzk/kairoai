// La cola del cron de Moovin: a quien le toca cuando el presupuesto por corrida
// es menor que la cantidad de guias vivas.
//
// El caso que la origino: la guia 2620536 se entrego el 18/08 y el tablero la
// seguia mostrando "Recolectado" (el estado del 11/08), porque la cola tenia un
// orden fijo y esa guia nunca alcanzaba el tope de la corrida.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRow {
  [key: string]: unknown;
}

// Filas por tabla que devuelve el doble de Supabase en cada test.
const tables: Record<string, FakeRow[]> = {
  logistics_rows: [],
  shopify_orders: [],
  moovin_tracking: [],
};

// Doble encadenable: los filtros que usa la consulta real (ilike/eq/neq/is/gte/
// order/range) no cambian el resultado; el test controla las filas por tabla.
// Solo `gte("checked_at", ...)` filtra de verdad, que es la ventana fresca.
function fakeQuery(table: string) {
  let rows = [...(tables[table] ?? [])];
  const chain: Record<string, unknown> = {
    select: () => chain,
    ilike: () => chain,
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    order: () => chain,
    in: () => chain,
    gte: (column: string, value: string) => {
      if (column === "checked_at") {
        rows = rows.filter((row) => String(row.checked_at ?? "") >= value);
      }
      return chain;
    },
    range: (from: number, to: number) =>
      Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDB: () => ({ from: (table: string) => fakeQuery(table) }),
}));

import { listMoovinSyncCandidates } from "@/lib/finance";

const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString();

function guiaDeBoxful(guide: string) {
  return { guide_number: guide, last_name: "Perez", customer_name: "Ana Perez", courier: "Moovin" };
}

function lectura(guide: string, opts: { horas: number; group?: string; entregadaHace?: number }) {
  return {
    id_package: guide,
    latest_group: opts.group ?? "in_progress",
    latest_at: opts.entregadaHace === undefined ? null : hace(opts.entregadaHace),
    checked_at: hace(opts.horas),
  };
}

beforeEach(() => {
  tables.logistics_rows = [];
  tables.shopify_orders = [];
  tables.moovin_tracking = [];
});

describe("listMoovinSyncCandidates", () => {
  it("atiende primero la guia que lleva mas tiempo sin leerse", async () => {
    tables.logistics_rows = [guiaDeBoxful("A"), guiaDeBoxful("B"), guiaDeBoxful("C")];
    tables.moovin_tracking = [
      lectura("A", { horas: 5 }),
      lectura("B", { horas: 120 }), // 5 dias sin leerse
      lectura("C", { horas: 30 }),
    ];

    const candidatos = await listMoovinSyncCandidates(3, 20);

    expect(candidatos.map((c) => c.idPackage)).toEqual(["B", "C", "A"]);
  });

  it("con presupuesto corto, la vieja entra y la recien leida espera", async () => {
    // El bug: el tope por corrida se lo llevaban siempre las mismas y la cola
    // de atras se quedaba dias sin actualizar.
    tables.logistics_rows = [guiaDeBoxful("RECIEN"), guiaDeBoxful("VIEJA")];
    tables.moovin_tracking = [
      lectura("RECIEN", { horas: 2 }),
      lectura("VIEJA", { horas: 144 }),
    ];

    const candidatos = await listMoovinSyncCandidates(1, 20);

    expect(candidatos.map((c) => c.idPackage)).toEqual(["VIEJA"]);
  });

  it("la guia que nunca se leyo va antes que cualquier relectura", async () => {
    // Punto ciego original: despachada en Shopify, sin fila en moovin_tracking.
    tables.logistics_rows = [guiaDeBoxful("YA_LEIDA")];
    tables.shopify_orders = [
      { tracking_number: "NUNCA_LEIDA", last_name: "Solis", customer_name: "Luis Solis" },
    ];
    tables.moovin_tracking = [lectura("YA_LEIDA", { horas: 200 })];

    const candidatos = await listMoovinSyncCandidates(2, 20);

    expect(candidatos[0].idPackage).toBe("NUNCA_LEIDA");
    expect(candidatos.map((c) => c.idPackage)).toContain("YA_LEIDA");
  });

  it("no vuelve a consultar devoluciones ni entregas ya verificadas", async () => {
    tables.logistics_rows = [
      guiaDeBoxful("VERIFICADA"),
      guiaDeBoxful("VIEJA"),
      guiaDeBoxful("DEVUELTA"),
      guiaDeBoxful("VIVA"),
    ];
    tables.moovin_tracking = [
      // Leida 90 horas despues de entregar: la segunda lectura ya se hizo.
      lectura("VERIFICADA", { horas: 10, group: "delivered", entregadaHace: 100 }),
      // Entregada hace 60 dias: fuera de la ventana de segunda lectura.
      lectura("VIEJA", { horas: 1439, group: "delivered", entregadaHace: 1440 }),
      lectura("DEVUELTA", { horas: 500, group: "returned", entregadaHace: 501 }),
      lectura("VIVA", { horas: 1 }),
    ];

    const candidatos = await listMoovinSyncCandidates(10, 20);

    expect(candidatos.map((c) => c.idPackage)).toEqual(["VIVA"]);
  });

  it("relee una vez la entrega de hace mas de 48 horas, antes que las guias en camino", async () => {
    // Moovin revierte entregas: marca "Entregado" y horas despues el paquete
    // vuelve a la sede y termina "Cancelado" (migracion 0037).
    tables.logistics_rows = [guiaDeBoxful("RELEER"), guiaDeBoxful("RECIENTE"), guiaDeBoxful("VIVA")];
    tables.moovin_tracking = [
      lectura("RELEER", { horas: 49, group: "delivered", entregadaHace: 50 }),
      lectura("RECIENTE", { horas: 9, group: "delivered", entregadaHace: 10 }),
      lectura("VIVA", { horas: 3 }),
    ];

    const candidatos = await listMoovinSyncCandidates(10, 20);

    expect(candidatos.map((c) => c.idPackage)).toEqual(["RELEER", "VIVA"]);
  });

  it("respeta la ventana fresca: lo leido hace un momento no se repite", async () => {
    tables.logistics_rows = [guiaDeBoxful("FRESCA"), guiaDeBoxful("VIEJA")];
    tables.moovin_tracking = [
      lectura("FRESCA", { horas: 0.1 }), // 6 minutos
      lectura("VIEJA", { horas: 48 }),
    ];

    const candidatos = await listMoovinSyncCandidates(10, 20);

    expect(candidatos.map((c) => c.idPackage)).toEqual(["VIEJA"]);
  });
});
