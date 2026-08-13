import { describe, expect, it } from "vitest";

import { matchesStatusKeyword, normalizeCourierStatus } from "@/lib/courier-adapters";
import { countWynIncidents, getEffectiveTrackingStatus } from "@/lib/finance-orders";
import { normalizeWynStatus, wynGroupFromCode } from "@/lib/wyn";
import { toWynTrackingRow, type CourierShipmentTrackingRow } from "@/lib/finance";

// La raiz del bug: buscar "no entreg" con includes() cruza el limite entre
// palabras. "Transito a destino Entregado a Distribuidor" es el hito RC-0 de
// WYN por el que pasa TODO paquete, y contiene "destiNO ENTREGado".
describe("matchesStatusKeyword", () => {
  it('no lee "no entregado" dentro de "destino entregado"', () => {
    expect(matchesStatusKeyword("Tránsito a destino Entregado a Distribuidor", ["no entreg"])).toBe(
      false
    );
    expect(
      matchesStatusKeyword("Tránsito a destino Entregado a Distribuidor", ["no entregado"])
    ).toBe(false);
  });

  it("si detecta la frase cuando de verdad empieza una palabra", () => {
    expect(matchesStatusKeyword("Paquete no entregado al cliente", ["no entreg"])).toBe(true);
    expect(matchesStatusKeyword("No entregado", ["no entreg"])).toBe(true);
  });

  it("las agujas siguen siendo prefijos de palabra", () => {
    expect(matchesStatusKeyword("Incidencia en la entrega", ["incid"])).toBe(true);
    expect(matchesStatusKeyword("Entrega fallida", ["fall"])).toBe(true);
    // ...pero no en medio de otra palabra.
    expect(matchesStatusKeyword("Desfallecido", ["fall"])).toBe(false);
  });

  it("normalizeCourierStatus deja de marcar el traspaso como no entregado", () => {
    expect(normalizeCourierStatus("Tránsito a destino Entregado a Distribuidor")).not.toBe(
      "not_delivered"
    );
  });
});

// Taxonomia real de WYN tomada de courier_shipments. El texto libre no basta:
// "Entregado a Distribuidor" (RC-0) es transito y "Entregado en direccion de
// retorno" (PF-2) es una devolucion; ambos contienen "entregado".
describe("wynGroupFromCode", () => {
  it("RC-0 es transito, no una entrega ni un fallo", () => {
    expect(wynGroupFromCode("RC-0")).toBe("en_route");
    // Antes del mapa por codigo, el texto de RC-0 daba "not_delivered".
    expect(normalizeWynStatus("Tránsito a destino", "Tránsito a destino", "Entregado a Distribuidor")).not.toBe(
      "not_delivered"
    );
  });

  it("solo PF-* son estados finales, y cada uno con su grupo", () => {
    expect(wynGroupFromCode("PF-1")).toBe("delivered"); // Entregado
    expect(wynGroupFromCode("PF-2")).toBe("returned"); // Entregado en direccion de retorno
    expect(wynGroupFromCode("PF-3")).toBe("not_delivered"); // Siniestrado
    expect(wynGroupFromCode("PF-5")).toBe("not_delivered"); // Robado
  });

  it("los intentos fallidos de ultima milla son incidencia", () => {
    for (const code of ["LM-6", "LM-7", "LM-8", "LM-9", "LM-10", "AV-2"]) {
      expect(wynGroupFromCode(code)).toBe("incident");
    }
  });

  it("los pasos normales de reparto no son incidencia", () => {
    for (const code of ["OC-1", "WI-3", "WI-4", "RC-0", "RC-4", "LM-1", "LM-2", "LM-3", "LM-4"]) {
      expect(wynGroupFromCode(code)).not.toBe("incident");
    }
  });

  it("un codigo que WYN agregue despues no revienta: cae al texto", () => {
    expect(wynGroupFromCode("ZZ-99")).toBeNull();
  });
});

describe("countWynIncidents", () => {
  const evento = (code: string) => ({
    code,
    group: "",
    title: "",
    description: "",
    date: null,
    note: "",
  });

  // Guia MLCR000070298SD: transito normal de punta a punta. Salia como
  // "Reintento" solo porque su RC-0 se leia como "no entregado".
  it("una guia en transito normal no tiene incidencias", () => {
    const events = ["LM-2", "RC-0", "WI-4", "WI-3", "OC-1"].map(evento);
    expect(countWynIncidents(events)).toBe(0);
    expect(
      getEffectiveTrackingStatus(
        {
          guide_number: "MLCR000070298SD",
          wyn_group: "en_route",
          wyn_incidents: countWynIncidents(events),
          source: "shopify",
          boxful_status: "",
          internal_status: "pending",
          shopify_cancelled_at: null,
          shopify_financial_status: "",
        },
        []
      )
    ).toBe("en_route");
  });

  // Guia MLCR000046991SD: aca si hubo un intento que no prospero.
  it("cuenta el intento fallido real (LM-7 destinatario ausente)", () => {
    expect(countWynIncidents(["RC-0", "LM-7", "LM-2", "OC-1"].map(evento))).toBe(1);
  });

  it("sin eventos no inventa incidencias", () => {
    expect(countWynIncidents([])).toBe(0);
    expect(countWynIncidents(undefined)).toBe(0);
  });
});

// Las filas de courier_shipments guardan el grupo que la taxonomia daba el dia
// del sync. Al arreglar la taxonomia quedaron 215 de 365 guias con un grupo
// vencido, y listWynSyncCandidates no vuelve a consultar una guia en estado
// final: sin reclasificar al leer, un "Robado" guardado como entregado se
// quedaba asi para siempre. Los casos son los que habia en produccion.
describe("toWynTrackingRow (reclasifica cache viejo)", () => {
  const evento = (code: string, title = "", description = "") => ({
    code,
    group: "", // lo que hubiera guardado el sync viejo
    title,
    description,
    date: null,
    note: "",
  });

  const fila = (
    over: Partial<CourierShipmentTrackingRow> & { events: ReturnType<typeof evento>[] }
  ): CourierShipmentTrackingRow => ({
    store_id: 1,
    guide_number: "MLCR000000001SD",
    normalized_status: "unknown",
    raw_status: "",
    latest_at: null,
    has_incident: false,
    incident_reason: "",
    checked_at: "2026-08-12T00:00:00Z",
    ...over,
    raw_payload: { events: over.events },
  });

  it("PF-5 (Robado) guardado como entregado se corrige a no entregado", () => {
    const row = toWynTrackingRow(
      fila({ normalized_status: "delivered", has_incident: false, events: [evento("PF-5", "Robado")] })
    );
    expect(row.latest_group).toBe("not_delivered");
    expect(row.has_incident).toBe(true);
  });

  it("PF-3 (Siniestrado) guardado como entregado tambien se corrige", () => {
    const row = toWynTrackingRow(
      fila({ normalized_status: "delivered", has_incident: true, events: [evento("PF-3", "Siniestrado")] })
    );
    expect(row.latest_group).toBe("not_delivered");
  });

  it("una entrega real deja de arrastrar la incidencia falsa del bug", () => {
    const row = toWynTrackingRow(
      fila({
        normalized_status: "delivered",
        has_incident: true,
        incident_reason: "Tránsito a destino",
        events: [evento("PF-1", "Entregado"), evento("RC-0", "Tránsito a destino", "Entregado a Distribuidor")],
      })
    );
    expect(row.latest_group).toBe("delivered");
    expect(row.has_incident).toBe(false);
    // Sin incidencia no queda motivo colgado de la fila vieja.
    expect(row.incident_reason).toBe("");
  });

  it("el paquete en manos del cartero vuelve a ser transito, no incidencia", () => {
    const row = toWynTrackingRow(
      fila({ normalized_status: "en_route", has_incident: true, events: [evento("LM-2", "En manos del cartero")] })
    );
    expect(row.latest_group).toBe("en_route");
    expect(row.has_incident).toBe(false);
  });

  it("los codigos guardados como unknown recuperan su grupo", () => {
    expect(toWynTrackingRow(fila({ events: [evento("LM-7", "Destinatario ausente")] })).latest_group).toBe(
      "incident"
    );
    expect(toWynTrackingRow(fila({ events: [evento("LM-3", "Visita a domicilio")] })).latest_group).toBe(
      "en_route"
    );
    expect(toWynTrackingRow(fila({ events: [evento("WI-4", "Procesado")] })).latest_group).toBe("en_route");
  });

  it("reclasifica tambien cada evento del historial, no solo el ultimo", () => {
    const row = toWynTrackingRow(
      fila({ events: [evento("PF-1", "Entregado"), evento("RC-0", "Tránsito a destino", "Entregado a Distribuidor")] })
    );
    // El punto rojo del modal salia de este group guardado como "not_delivered".
    expect(row.events.map((event) => event.group)).toEqual(["delivered", "en_route"]);
  });

  it("un codigo desconocido cae al texto guardado en vez de perder el estado", () => {
    const row = toWynTrackingRow(
      fila({ raw_status: "Entregado", normalized_status: "delivered", events: [evento("ZZ-99", "Entregado")] })
    );
    expect(row.latest_group).toBe("delivered");
  });

  it("una fila sin eventos cae al texto de cabecera", () => {
    const row = toWynTrackingRow(fila({ raw_status: "Pedido registrado", events: [] }));
    expect(row.latest_group).toBe("pending");
    expect(row.has_incident).toBe(false);
  });

  it("una fila vacia no revienta: queda en unknown", () => {
    const row = toWynTrackingRow(fila({ events: [] }));
    expect(row.latest_group).toBe("unknown");
    expect(row.has_incident).toBe(false);
    expect(row.events).toEqual([]);
  });
});
