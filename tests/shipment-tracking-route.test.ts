// La ventana "Seguimiento Cargo Expreso / c807" de la tabla de pedidos: lee en
// vivo, guarda la lectura y, si el courier no contesta, muestra el historial
// guardado.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fetchCargoExpresoTracking = vi.fn();
const fetchC807Tracking = vi.fn();
const getShipmentTrackingByGuide = vi.fn();
const upsertShipmentTracking = vi.fn();

vi.mock("@/lib/cargo-expreso", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/cargo-expreso")>();
  return { ...real, fetchCargoExpresoTracking: (...a: unknown[]) => fetchCargoExpresoTracking(...a) };
});
vi.mock("@/lib/c807", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/c807")>();
  return { ...real, fetchC807Tracking: (...a: unknown[]) => fetchC807Tracking(...a) };
});
vi.mock("@/lib/finance", () => ({
  getShipmentTrackingByGuide: (...a: unknown[]) => getShipmentTrackingByGuide(...a),
  upsertShipmentTracking: (...a: unknown[]) => upsertShipmentTracking(...a),
}));

async function pedir(guide: string, store = "mireva-hn") {
  const { GET } = await import("../app/api/finance/shipment-tracking/route");
  return GET(new NextRequest(`http://localhost/api/finance/shipment-tracking?store=${store}&guide=${guide}`));
}

const vivo = {
  guideNumber: "BH262231336-1",
  latestStatus: "EN RUTA BODEGA DESTINO",
  latestCode: "E",
  latestGroup: "in_progress",
  latestAt: "2026-10-03T09:55:15.000Z",
  hasIncident: false,
  incidentReason: "",
  deliveryAddress: "",
  receiverName: "",
  events: [{ code: "E", group: "in_progress", title: "Salida de bodega (SPS)", description: "", date: "2026-10-03T09:55:15.000Z", note: "SPS" }],
};

beforeEach(() => {
  fetchCargoExpresoTracking.mockReset();
  fetchC807Tracking.mockReset();
  getShipmentTrackingByGuide.mockReset();
  upsertShipmentTracking.mockReset();
});

describe("/api/finance/shipment-tracking", () => {
  it("consulta Cargo Expreso en vivo y guarda la lectura", async () => {
    fetchCargoExpresoTracking.mockResolvedValue(vivo);
    const res = await pedir("bh262231336-1");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.courier).toBe("cargoexpreso");
    expect(json.courierLabel).toBe("Cargo Expreso");
    expect(json.latestStatus).toBe("EN RUTA BODEGA DESTINO");
    expect(fetchCargoExpresoTracking).toHaveBeenCalledWith("BH262231336-1");
    expect(upsertShipmentTracking).toHaveBeenCalledWith([vivo], 2, "cargoexpreso");
    expect(fetchC807Tracking).not.toHaveBeenCalled();
  });

  it("una guia de c807 va a c807", async () => {
    fetchC807Tracking.mockResolvedValue({ ...vivo, guideNumber: "6595-13968-20260928110658" });
    const json = await (await pedir("6595-13968-20260928110658")).json();
    expect(json.courier).toBe("c807");
    expect(fetchC807Tracking).toHaveBeenCalledWith("6595-13968-20260928110658");
  });

  it("si el courier no contesta, devuelve el historial guardado con su fecha", async () => {
    fetchCargoExpresoTracking.mockRejectedValue(new Error("Cargo Expreso no respondio en 15 segundos."));
    getShipmentTrackingByGuide.mockResolvedValue({
      store_id: 2,
      guide_number: "BH262231336-1",
      tracking_number: "BH262231336-1",
      latest_status: "EN RUTA BODEGA DESTINO",
      latest_code: "E",
      latest_group: "in_progress",
      latest_at: "2026-10-03T09:55:15.000Z",
      has_incident: false,
      incident_reason: "",
      delivery_address: "",
      receiver_name: "",
      events: vivo.events,
      checked_at: "2026-10-14T13:40:15.547Z",
    });

    const res = await pedir("BH262231336-1");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.cached).toBe(true);
    expect(json.cachedAt).toBe("2026-10-14T13:40:15.547Z");
    expect(json.liveError).toContain("15 segundos");
    expect(json.events).toHaveLength(1);
    expect(getShipmentTrackingByGuide).toHaveBeenCalledWith(2, "cargoexpreso", "BH262231336-1");
  });

  it("sin historial guardado avisa el error", async () => {
    fetchCargoExpresoTracking.mockRejectedValue(new Error("Cargo Expreso respondio HTTP 503."));
    getShipmentTrackingByGuide.mockResolvedValue(null);
    const res = await pedir("BH262231336-1");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("503");
  });

  it("rechaza guias que no son de estos couriers y exige la tienda", async () => {
    expect((await pedir("FD28516415")).status).toBe(400);
    const sinTienda = await (await import("../app/api/finance/shipment-tracking/route")).GET(
      new NextRequest("http://localhost/api/finance/shipment-tracking?guide=BH262231336-1")
    );
    expect(sinTienda.status).toBe(400);
  });
});
