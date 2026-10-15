import { describe, expect, it } from "vitest";
import { classifyMoovinGroup, parseMoovinResponse } from "../lib/moovin";
import { applyDetection, detectMoovinIncident } from "../lib/incidents-detect";
import type { MoovinTrackingRow } from "../lib/finance-types";
import type { ShopifyOrderSummary } from "../lib/finance-orders";
import type { Incident } from "../lib/incidents-types";

// Regresión: Moovin reporta las incidencias de GESTIÓN ("Problemas en gestión /
// Estado: Abierto" en su panel) con códigos propios REVIEW ("paquete en
// revisión") y CHANGECONTACTPOINT ("cambio de información en el punto de
// entrega"), NO como FAILED. Antes quedaban como "en tránsito sin clasificar ->
// en_route" y nunca generaban novedad. Deben clasificarse como incidencia.
describe("classifyMoovinGroup — incidencias de gestión", () => {
  it("REVIEW -> failed", () => {
    expect(classifyMoovinGroup("REVIEW", "paquete en revisión")).toBe("failed");
  });
  it("CHANGECONTACTPOINT -> failed", () => {
    expect(classifyMoovinGroup("CHANGECONTACTPOINT", "cambio de información en el punto de entrega")).toBe("failed");
  });
  it("códigos de tránsito normales siguen in_progress", () => {
    expect(classifyMoovinGroup("INROUTE", "En ruta")).toBe("in_progress");
    expect(classifyMoovinGroup("COORDINATE", "Coordinado")).toBe("in_progress");
  });
  it("estados finales/cancelados no cambian", () => {
    expect(classifyMoovinGroup("DELIVERED", "Entregado")).toBe("delivered");
    expect(classifyMoovinGroup("FAILED", "Incidencia en la entrega")).toBe("failed");
    expect(classifyMoovinGroup("XX", "Cancelado por Moovin")).toBe("returned");
  });
});

describe("detectMoovinIncident — una gestión REVIEW/CHANGECONTACTPOINT es novedad", () => {
  function trackingRow(group: string, code: string, title: string): MoovinTrackingRow {
    return {
      id_package: "2586380",
      last_name: "Perez",
      tracking_number: "",
      latest_status: title,
      latest_code: code,
      latest_group: group,
      latest_at: "2026-07-21T22:47:00.000Z",
      has_incident: group === "failed",
      incident_reason: "Cliente no contesta",
      delivery_address: "",
      checked_at: "2026-07-21T22:50:00.000Z",
      events: [
        { code, group, title, description: "", date: "2026-07-21T22:47:00.000Z", note: "Cliente no contesta" },
      ],
    } as unknown as MoovinTrackingRow;
  }

  it("REVIEW genera candidato de novedad (categoría cliente_no_responde por el motivo)", () => {
    const candidate = detectMoovinIncident(trackingRow("failed", "REVIEW", "paquete en revisión"), undefined, 1);
    expect(candidate).not.toBeNull();
    expect(candidate?.guide_number).toBe("2586380");
    expect(candidate?.category).toBe("cliente_no_responde");
  });

  it("CHANGECONTACTPOINT genera candidato de novedad", () => {
    const candidate = detectMoovinIncident(
      trackingRow("failed", "CHANGECONTACTPOINT", "cambio de información en el punto de entrega"),
      undefined,
      1
    );
    expect(candidate).not.toBeNull();
  });

  it("fila CACHEADA (latest_group=in_progress, latest_code=REVIEW) se reinterpreta como novedad", () => {
    // Simula una fila guardada ANTES del mapeo: el grupo quedó en in_progress y
    // has_incident=false, pero el código crudo es REVIEW -> debe detectarse igual.
    const cached = trackingRow("in_progress", "REVIEW", "paquete en revisión");
    (cached as { has_incident: boolean }).has_incident = false;
    const candidate = detectMoovinIncident(cached, undefined, 1);
    expect(candidate).not.toBeNull();
    expect(candidate?.last_tracking_group).toBe("failed");
  });

  it("no degrada un estado terminal ya guardado (delivered se respeta)", () => {
    const delivered = trackingRow("delivered", "DELIVERED", "Entregado");
    (delivered as { has_incident: boolean }).has_incident = false;
    // delivered + sin novedad previa => detectMoovinIncident lo trata como cierre,
    // no como nueva novedad; lo importante es que NO se reinterpreta como failed.
    const candidate = detectMoovinIncident(delivered, undefined, 1);
    expect(candidate?.last_tracking_group ?? "delivered").not.toBe("failed");
  });
});

// Regresion: Moovin cierra algunas entregas con DELIVEREDCOMPLETE ("Entrega
// completa") en vez de DELIVERED. Sin mapear caia a in_progress: el pedido
// figuraba "No entregado" en finanzas y la deteccion lo daba de alta como
// demora. Paso con #MCRC16612 y #MCRC17995 (septiembre): dos novedades falsas
// que el equipo tuvo que investigar y cerrar a mano. Ya se habia arreglado en
// #131 (julio) pero ese cambio no llego a main al consolidar produccion.
describe("DELIVEREDCOMPLETE es una entrega", () => {
  const ENTREGADO = "El paquete ha sido entregado en la dirección de destino.";

  it("se clasifica como delivered", () => {
    expect(classifyMoovinGroup("DELIVEREDCOMPLETE", "Entrega completa")).toBe("delivered");
  });

  it("el parser real deja el envio como entregado (es el grupo que se guarda y lee finanzas)", () => {
    // Tramo final del historial real de la guia 2607543 (#MCRC17995).
    const raw =
      '1:{"serialNumber":"2607543","listStatus":[' +
      '{"date":"2026-08-09T14:10:00Z","status":"INROUTE","title":"En ruta para entregar a lo largo del día",' +
      '"description":"El envío está en poder de un Moover (mensajero) para ser entregado."},' +
      '{"date":"2026-08-09T16:40:00Z","status":"COORDINATE","title":"Coordinado"},' +
      `{"date":"2026-08-10T16:30:00Z","status":"DELIVEREDCOMPLETE","title":"Entrega completa","description":"${ENTREGADO}"}` +
      "]}\n";
    const detail = parseMoovinResponse(raw)!;
    expect(detail.events[0].code).toBe("DELIVEREDCOMPLETE");
    expect(detail.events[0].group).toBe("delivered");
    // Los eventos de transito del mismo historial no cambian.
    expect(detail.events.find((e) => e.code === "INROUTE")?.group).toBe("in_progress");
  });

  describe("en la bandeja de novedades", () => {
    const NOW = "2026-09-23T12:00:00.000Z";
    // El envio como lo guarda la sincronizacion ya con el codigo mapeado.
    const entregado = {
      id_package: "2607543",
      last_name: "",
      tracking_number: "",
      latest_status: "Entrega completa",
      latest_code: "DELIVEREDCOMPLETE",
      latest_group: "delivered",
      latest_at: "2026-08-10T16:30:00.000Z",
      has_incident: false,
      incident_reason: "",
      delivery_address: "",
      checked_at: "2026-09-15T00:01:24.000Z",
      events: [],
    } as unknown as MoovinTrackingRow;
    // Pedido de 54 dias: sin el mapeo, pasaba de largo el umbral de demora.
    const pedidoViejo = { name: "#MCRC17995", created_at: "2026-07-31T12:00:00.000Z" } as ShopifyOrderSummary;

    it("un pedido viejo entregado asi no se da de alta como demora", () => {
      const candidate = detectMoovinIncident(entregado, undefined, 1, pedidoViejo, NOW)!;
      expect(candidate.category).not.toBe("demora_entrega");
      expect(candidate.last_tracking_group).toBe("delivered");
      expect(applyDetection(null, candidate, NOW).action).toBe("skip");
    });

    it("una demora abierta sobre ese envio se cierra sola como resuelta", () => {
      const demoraAbierta = {
        id: 1,
        store_id: 1,
        status: "pendiente",
        category: "demora_entrega",
        shopify_order_id: "",
        customer_phone: "",
        customer_name: "",
        courier: "Moovin",
        order_name: "#MCRC17995",
        guide_number: "2607543",
        cod_amount: 19900,
        reprogramada_para: null,
        reprogramada_at: null,
      } as unknown as Incident;
      const candidate = detectMoovinIncident(entregado, undefined, 1, pedidoViejo, NOW)!;
      const r = applyDetection(demoraAbierta, candidate, NOW);
      expect(r.patch.status).toBe("resuelta");
      expect(r.event?.message).toBe("Entrega confirmada por el courier");
    });
  });
});
