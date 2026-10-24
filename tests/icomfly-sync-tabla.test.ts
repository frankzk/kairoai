// La sincronizacion de iComfly rearma la tabla de Gestion.
//
// POR QUE ESTE TEST EXISTE: los pedidos nuevos de iComfly llegaban a la base
// cada 30 minutos, pero la tabla de Gestion solo se rearmaba cada hora
// (finance-index): un pedido podia tardar hasta una hora en verse (24/10/2026,
// los #24 y Daly Ramos de Honduras). Ahora el cron la rearma despues de
// sincronizar, y el boton "Sync iComfly" lo hace en el momento.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rearmadas: string[] = [];
let fallaHonduras = false;

vi.mock("@/lib/cron-runs", () => ({ withCronRun: (_nombre: string, fn: () => Promise<Response>) => fn }));
vi.mock("@/lib/icomfly", () => ({
  listConfiguredIcomflyStoreContexts: () => [
    { store: { code: "mireva-cr" }, externalStoreId: 71 },
    { store: { code: "mireva-hn" }, externalStoreId: 90 },
  ],
}));
vi.mock("@/lib/icomfly-sync", () => ({
  runIcomflySync: async () => ({ synced: 100, pages_fetched: 1 }),
  errorDeTienda: () => null,
  summarizeRows: () => null,
}));
vi.mock("@/app/api/finance/_shared/orders-dataset", () => ({
  refreshFinanceDatasetCache: async (store: { code: string }) => {
    rearmadas.push(store.code);
    if (fallaHonduras && store.code === "mireva-hn") throw new Error("timeout");
    return 20121;
  },
}));

beforeEach(() => {
  rearmadas.length = 0;
  fallaHonduras = false;
});

describe("el cron de iComfly", () => {
  it("rearma la tabla de cada tienda después de sincronizar", async () => {
    const { GET } = await import("../app/api/cron/icomfly/route");
    const res = await GET();
    const json = await res.json();
    expect(rearmadas).toEqual(["mireva-cr", "mireva-hn"]);
    expect(json.tablas).toEqual({ "mireva-cr": "20121 filas", "mireva-hn": "20121 filas" });
  });

  it("si la tabla de una tienda falla, la sincronización no falla", async () => {
    fallaHonduras = true;
    const { GET } = await import("../app/api/cron/icomfly/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tablas["mireva-hn"]).toBe("error: timeout");
    expect(json).not.toHaveProperty("error");
  });
});

describe("el botón Sync iComfly", () => {
  const sincronizar = async (body: Record<string, unknown>) => {
    const { POST } = await import("../app/api/icomfly/sync/route");
    return POST(new NextRequest("http://localhost/api/icomfly/sync", { method: "POST", body: JSON.stringify(body) }));
  };

  it("con refrescar rearma la tabla de esa tienda", async () => {
    const res = await sincronizar({ store: "mireva-hn", max_pages: 2, refrescar: true });
    expect(await res.json()).toMatchObject({ synced: 100, tabla: { ok: true, filas: 20121 } });
    expect(rearmadas).toEqual(["mireva-hn"]);
  });

  it("sin refrescar, como antes: solo sincroniza", async () => {
    await sincronizar({ store: "mireva-cr" });
    expect(rearmadas).toEqual([]);
  });
});
