import { describe, expect, it } from "vitest";
import { SHIPMENT_COURIERS, syncShipmentGuides, type ShipmentSyncDeps } from "../lib/courier-shipment-sync";
import type { ShipmentTracking } from "../lib/courier-tracking";

const RAPIDO = { minIntervalMs: 0, concurrency: 1 };

function tracking(guide: string, over: Partial<ShipmentTracking> = {}): ShipmentTracking {
  return {
    guideNumber: guide,
    latestStatus: "Salida de bodega (TGU)",
    latestCode: "E",
    latestGroup: "in_progress",
    latestAt: "2026-10-03T13:45:00.000Z",
    hasIncident: false,
    incidentReason: "",
    deliveryAddress: "",
    receiverName: "",
    events: [],
    ...over,
  };
}

describe("syncShipmentGuides", () => {
  it("guarda lo que responde; una guia que falla no frena la tanda ni se guarda", async () => {
    const saved: string[] = [];
    const deps: ShipmentSyncDeps = {
      fetch: async (g) => {
        if (g === "BH000000002-1") throw new Error("Cargo Expreso no encontro informacion para esta guia.");
        return tracking(g, { latestGroup: "failed", hasIncident: true });
      },
      save: async (rows) => {
        saved.push(...rows.map((r) => r.guideNumber));
      },
    };
    const r = await syncShipmentGuides(["BH000000001-1", "BH000000002-1"], 2, RAPIDO, deps);
    expect(r).toMatchObject({ requested: 2, checked: 1, incidents: 1, failedLookups: 1, saved: 1 });
    expect(saved).toEqual(["BH000000001-1"]);
  });

  it("si falla el guardado, el error sale", async () => {
    const deps: ShipmentSyncDeps = {
      fetch: async (g) => tracking(g),
      save: async () => {
        throw new Error("upsertShipmentTracking(cargoexpreso): 503");
      },
    };
    await expect(syncShipmentGuides(["BH000000001-1"], 2, RAPIDO, deps)).rejects.toThrow(/503/);
  });

  it("con el plazo vencido no arranca consultas", async () => {
    let calls = 0;
    const deps: ShipmentSyncDeps = {
      fetch: async (g) => {
        calls += 1;
        return tracking(g);
      },
      save: async () => undefined,
    };
    const r = await syncShipmentGuides(["BH000000001-1", "BH000000002-1"], 2, { ...RAPIDO, deadlineMs: Date.now() - 1 }, deps);
    expect(calls).toBe(0);
    expect(r).toMatchObject({ notStarted: 2, checked: 0, saved: 0 });
  });

  // c807 corto 3 de 44 conexiones a una consulta por segundo.
  it("c807 se consulta de a una y mas despacio que Cargo Expreso", () => {
    expect(SHIPMENT_COURIERS.c807.concurrency).toBe(1);
    expect(SHIPMENT_COURIERS.c807.minIntervalMs).toBeGreaterThan(SHIPMENT_COURIERS.cargoexpreso.minIntervalMs);
  });
});
