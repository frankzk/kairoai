import { describe, expect, it } from "vitest";

import { matchesStatusKeyword, normalizeCourierStatus } from "@/lib/courier-adapters";
import { countWynIncidents, getEffectiveTrackingStatus } from "@/lib/finance-orders";
import { normalizeWynStatus, wynGroupFromCode } from "@/lib/wyn";

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
          source: "",
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
