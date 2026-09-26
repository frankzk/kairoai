import { describe, expect, it } from "vitest";
import { syncForzaGuides, type ForzaSyncDeps } from "../lib/forza-sync";
import type { ForzaTracking } from "../lib/forza";

function tracking(guide: string, over: Partial<ForzaTracking> = {}): ForzaTracking {
  return {
    ok: true,
    http_status: 200,
    guide_number: guide,
    tracking_number: guide,
    latest_status: "En Ruta",
    latest_status_code: "",
    latest_group: "in_progress",
    latest_at: "2026-09-25T10:00:00.000Z",
    delivery_address: "",
    receiver_name: "",
    has_incident: false,
    incident_reason: "",
    events: [],
    ...over,
  };
}

describe("syncForzaGuides", () => {
  it("guarda lo que Forza responde y cuenta entregas e incidencias", async () => {
    const saved: string[] = [];
    const deps: ForzaSyncDeps = {
      fetch: async (g) =>
        g === "FD1"
          ? tracking(g, { latest_group: "delivered", latest_status: "Entregado" })
          : g === "FD2"
            ? tracking(g, { latest_group: "failed", has_incident: true })
            : tracking(g),
      save: async (rows) => {
        saved.push(...rows.map((r) => r.guide_number));
      },
    };
    const r = await syncForzaGuides(["FD1", "FD2", "FD3"], 2, {}, deps);
    expect(r).toMatchObject({ requested: 3, checked: 3, delivered: 1, incidents: 1, failedLookups: 0, notStarted: 0, saved: 3 });
    expect(saved.sort()).toEqual(["FD1", "FD2", "FD3"]);
  });

  it("una guia sin respuesta o que tira error no frena la tanda y no se guarda", async () => {
    const saved: string[] = [];
    const deps: ForzaSyncDeps = {
      fetch: async (g) => {
        if (g === "FD2") throw new Error("timeout");
        if (g === "FD3") return tracking(g, { ok: false, latest_status: null });
        return tracking(g);
      },
      save: async (rows) => {
        saved.push(...rows.map((r) => r.guide_number));
      },
    };
    const r = await syncForzaGuides(["FD1", "FD2", "FD3"], 2, {}, deps);
    expect(r).toMatchObject({ checked: 1, failedLookups: 2, saved: 1 });
    expect(saved).toEqual(["FD1"]);
  });

  // Antes el boton lo tragaba con un warn y mostraba "Forza actualizado: N
  // consultados" aunque no se hubiera guardado nada.
  it("si falla el guardado, el error sale", async () => {
    const deps: ForzaSyncDeps = {
      fetch: async (g) => tracking(g),
      save: async () => {
        throw new Error("upsertForzaTracking: 503 Service Unavailable");
      },
    };
    await expect(syncForzaGuides(["FD1"], 2, {}, deps)).rejects.toThrow(/503/);
  });

  it("con el plazo vencido no arranca consultas nuevas", async () => {
    let calls = 0;
    const deps: ForzaSyncDeps = {
      fetch: async (g) => {
        calls += 1;
        return tracking(g);
      },
      save: async () => undefined,
    };
    const r = await syncForzaGuides(["FD1", "FD2", "FD3"], 2, { deadlineMs: Date.now() - 1 }, deps);
    expect(calls).toBe(0);
    expect(r).toMatchObject({ notStarted: 3, checked: 0, saved: 0 });
  });
});
