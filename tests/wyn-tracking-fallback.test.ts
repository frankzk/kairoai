// La ventana "Seguimiento WYN" muestra el historial guardado cuando WYN no
// contesta en vivo.
//
// EL CASO REAL (07/10/2026): desde el 06/10 WYN no le responde al servidor. La
// ventana de la guia MLCR000127430SD decia solo "WYN no respondio dentro de 10
// segundos" y nada mas, aunque su historial estaba guardado desde el 05/10 —
// igual que el de las 518 guias de WYN.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fetchWynTracking = vi.fn();
const getWynTrackingByGuide = vi.fn();
const upsertWynTracking = vi.fn();

vi.mock("@/lib/wyn", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/wyn")>();
  return { ...real, fetchWynTracking: (...a: unknown[]) => fetchWynTracking(...a) };
});
vi.mock("@/lib/finance", () => ({
  getWynTrackingByGuide: (...a: unknown[]) => getWynTrackingByGuide(...a),
  upsertWynTracking: (...a: unknown[]) => upsertWynTracking(...a),
}));

async function pedir(guide: string) {
  const { GET } = await import("../app/api/finance/wyn-tracking/route");
  return GET(new NextRequest(`http://localhost/api/finance/wyn-tracking?store=mireva-cr&guide=${guide}`));
}

const guardada = {
  store_id: 1,
  guide_number: "MLCR000127430SD",
  tracking_number: "MLCR000127430SD",
  latest_status: "Orden creada",
  latest_code: "OC-1",
  latest_group: "pending",
  latest_at: "2026-08-12T15:00:00Z",
  has_incident: false,
  incident_reason: "",
  delivery_address: "",
  receiver_name: "",
  events: [{ code: "OC-1", group: "pending", title: "Orden creada", description: "Etiqueta impresa", date: "2026-08-12T15:00:00Z", note: "" }],
  checked_at: "2026-10-05T21:20:23.999Z",
};

beforeEach(() => {
  fetchWynTracking.mockReset();
  getWynTrackingByGuide.mockReset();
  upsertWynTracking.mockReset();
});

describe("/api/finance/wyn-tracking cuando WYN no contesta", () => {
  it("devuelve el historial guardado, marcado como guardado y con su fecha", async () => {
    fetchWynTracking.mockRejectedValue(new Error("WYN no respondio dentro de 10 segundos."));
    getWynTrackingByGuide.mockResolvedValue(guardada);

    const res = await pedir("MLCR000127430SD");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.cached).toBe(true);
    expect(json.cachedAt).toBe("2026-10-05T21:20:23.999Z");
    expect(json.liveError).toContain("10 segundos");
    expect(json.latestStatus).toBe("Orden creada");
    expect(json.events).toHaveLength(1);
    expect(json.events[0].title).toBe("Orden creada");
    expect(getWynTrackingByGuide).toHaveBeenCalledWith(1, "MLCR000127430SD");
  });

  it("sin historial guardado sigue avisando el error, como antes", async () => {
    fetchWynTracking.mockRejectedValue(new Error("WYN no respondio dentro de 10 segundos."));
    getWynTrackingByGuide.mockResolvedValue(null);

    const res = await pedir("MLCR000327904SD");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("10 segundos");
  });

  it("si WYN contesta, manda lo vivo y no lo guardado", async () => {
    fetchWynTracking.mockResolvedValue({
      guideNumber: "MLCR000127430SD", trackingNumber: "MLCR000127430SD", latestStatus: "Entregado",
      latestCode: "LM-5", latestGroup: "delivered", latestAt: null, hasIncident: false, incidentReason: "",
      deliveryAddress: "", receiverName: "", events: [], raw: {},
    });

    const json = await (await pedir("MLCR000127430SD")).json();
    expect(json.latestStatus).toBe("Entregado");
    expect(json.cached).toBeUndefined();
    expect(getWynTrackingByGuide).not.toHaveBeenCalled();
  });
});
