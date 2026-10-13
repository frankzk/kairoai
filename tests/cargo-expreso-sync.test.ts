import { describe, expect, it } from "vitest";
import { syncCargoExpresoGuides, type CargoExpresoSyncDeps } from "../lib/cargo-expreso-sync";
import type { CargoExpresoTracking } from "../lib/cargo-expreso";

function tracking(guide: string, over: Partial<CargoExpresoTracking> = {}): CargoExpresoTracking {
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

describe("syncCargoExpresoGuides", () => {
  it("guarda lo que responde; una guia que falla no frena la tanda ni se guarda", async () => {
    const saved: string[] = [];
    const deps: CargoExpresoSyncDeps = {
      fetch: async (g) => {
        if (g === "BH000000002-1") throw new Error("Cargo Expreso no encontro informacion para esta guia.");
        return tracking(g, { latestGroup: "failed", hasIncident: true });
      },
      save: async (rows) => {
        saved.push(...rows.map((r) => r.guideNumber));
      },
    };
    const r = await syncCargoExpresoGuides(["BH000000001-1", "BH000000002-1"], 2, {}, deps);
    expect(r).toMatchObject({ requested: 2, checked: 1, incidents: 1, failedLookups: 1, saved: 1 });
    expect(saved).toEqual(["BH000000001-1"]);
  });

  it("si falla el guardado, el error sale", async () => {
    const deps: CargoExpresoSyncDeps = {
      fetch: async (g) => tracking(g),
      save: async () => {
        throw new Error("upsertCargoExpresoTracking: 503");
      },
    };
    await expect(syncCargoExpresoGuides(["BH000000001-1"], 2, {}, deps)).rejects.toThrow(/503/);
  });

  it("con el plazo vencido no arranca consultas", async () => {
    let calls = 0;
    const deps: CargoExpresoSyncDeps = {
      fetch: async (g) => {
        calls += 1;
        return tracking(g);
      },
      save: async () => undefined,
    };
    const r = await syncCargoExpresoGuides(["BH000000001-1", "BH000000002-1"], 2, { deadlineMs: Date.now() - 1 }, deps);
    expect(calls).toBe(0);
    expect(r).toMatchObject({ notStarted: 2, checked: 0, saved: 0 });
  });
});
