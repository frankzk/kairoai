// Rastreo de Cargo Expreso (Honduras): como se lee la respuesta de su API.
//
// Las respuestas de estos tests estan armadas a mano con la forma de las reales
// (60 guias de septiembre y octubre de 2026), sin datos de clientes.

import { describe, expect, it } from "vitest";
import { isCargoExpresoGuide, normalizeCargoExpresoGuide, parseCargoExpresoResponse } from "../lib/cargo-expreso";

type Scan = [fecha: string, estado: string, ruta: string, tipo?: string, hub?: string];

function respuesta(scans: Scan[], guia: Record<string, unknown> = {}) {
  return {
    tracking: {
      resultado: true,
      datosGuia: {
        NumeroGuia: "BH000000001-1",
        DestinatarioNombre: "Cliente de Prueba",
        DestinatarioDireccion: "Colonia de Prueba, Tegucigalpa",
        PODNombre: "",
        PODStatus: "",
        PODStatusDes: "",
        detalle: scans.map(([FechaHoraScan, EstadoMovimiento, NombreRuta, TipoMovimiento = "", HUB = "TGU"]) => ({
          FechaHoraScan,
          EstadoMovimiento,
          NombreRuta,
          TipoMovimiento,
          HUB,
        })),
        ...guia,
      },
    },
  };
}

// Recoleccion en la bodega de Mireva, viaje y salida a reparto.
const HASTA_REPARTO: Scan[] = [
  ["2026-10-02 10:22:24", "R", "TGU22 - Recolectando"],
  ["2026-10-02 13:30:00", "I", "TGU22 - RUTA CENTRO DISTRIBUCION", "INGRESO A BODEGA"],
  ["2026-10-03 07:40:00", "A", "TG105 - RUTA KENNEDY", "ASIGNACION DE CARGA"],
  ["2026-10-03 07:45:00", "E", "RUTA KENNEDY", "SALIDA DE BODEGA"],
];

describe("guias de Cargo Expreso", () => {
  it("son BH + digitos + pieza", () => {
    expect(isCargoExpresoGuide("BH000000001-1")).toBe(true);
    expect(isCargoExpresoGuide(" bh000000001-1 ")).toBe(true);
    expect(normalizeCargoExpresoGuide(" bh000000001-1 ")).toBe("BH000000001-1");
    expect(isCargoExpresoGuide("FD123456789")).toBe(false);
    expect(isCargoExpresoGuide("BH000000001")).toBe(false);
  });
});

describe("parseCargoExpresoResponse", () => {
  it("sin datos de la guia devuelve null", () => {
    expect(parseCargoExpresoResponse(null)).toBeNull();
    expect(parseCargoExpresoResponse({ tracking: { resultado: false } })).toBeNull();
  });

  it("'001 Entregando-Paquete' es la entrega", () => {
    const t = parseCargoExpresoResponse(
      respuesta([...HASTA_REPARTO, ["2026-10-03 15:10:00", "D", "TG105 - 001 Entregando-Paquete"]], {
        PODNombre: "Quien Recibio",
        PODStatus: "5",
      })
    )!;
    expect(t.latestGroup).toBe("delivered");
    expect(t.latestStatus).toBe("Entregado");
    expect(t.hasIncident).toBe(false);
    expect(t.receiverName).toBe("Quien Recibio");
  });

  it("las fechas vienen en hora de Honduras (UTC-6)", () => {
    const t = parseCargoExpresoResponse(respuesta(HASTA_REPARTO))!;
    expect(t.events.at(-1)!.date).toBe("2026-10-02T16:22:24.000Z");
    // Del mas reciente al mas viejo.
    expect(t.events[0].code).toBe("E");
  });

  it("un intento fallido que volvio a la bodega es incidencia, con su motivo", () => {
    const t = parseCargoExpresoResponse(
      respuesta([
        ...HASTA_REPARTO,
        ["2026-10-03 17:33:24", "D", "TG105 - 005 Nadie en casa"],
        ["2026-10-03 17:34:16", "NO", "TG105 - 005 Nadie en casa"],
        ["2026-10-03 17:35:58", "I", "TG105 - RUTA KENNEDY", "INGRESO A BODEGA"],
      ])
    )!;
    expect(t.latestGroup).toBe("failed");
    expect(t.hasIncident).toBe(true);
    expect(t.incidentReason).toBe("005 Nadie en casa");
    expect(t.latestStatus).toBe("Intento de entrega fallido: 005 Nadie en casa");
    // La fecha de la novedad es la del intento, no la del ingreso a bodega.
    expect(t.latestAt).toBe("2026-10-03T23:33:24.000Z");
  });

  it("NO y NC acompañan al intento: no cuentan como otro intento", () => {
    const t = parseCargoExpresoResponse(
      respuesta([
        ...HASTA_REPARTO,
        ["2026-10-03 17:33:24", "D", "TG105 - 005 Nadie en casa"],
        ["2026-10-03 17:34:16", "NO", "TG105 - 005 Nadie en casa"],
        ["2026-10-03 17:34:40", "NC", "TG105 - 005 Nadie en casa"],
      ])
    )!;
    expect(t.events.filter((e) => e.group === "failed")).toHaveLength(1);
  });

  it("si despues de la falla volvio a salir a reparto, es un reintento en curso", () => {
    const t = parseCargoExpresoResponse(
      respuesta([
        ...HASTA_REPARTO,
        ["2026-10-03 17:33:24", "D", "TG105 - 005 Nadie en casa"],
        ["2026-10-03 17:35:58", "I", "TG105 - RUTA KENNEDY", "INGRESO A BODEGA"],
        ["2026-10-05 07:40:00", "A", "TG105 - RUTA KENNEDY", "ASIGNACION DE CARGA"],
        ["2026-10-05 07:45:00", "E", "RUTA KENNEDY", "SALIDA DE BODEGA"],
      ])
    )!;
    expect(t.latestGroup).toBe("in_progress");
    expect(t.hasIncident).toBe(false);
    // El intento anterior queda en el historial para contarlo.
    expect(t.events.filter((e) => e.group === "failed")).toHaveLength(1);
  });

  it("'CANCELADO POR DEVOLUCION' es la devolucion, aunque antes haya fallado", () => {
    const t = parseCargoExpresoResponse(
      respuesta([
        ...HASTA_REPARTO,
        ["2026-10-03 18:22:11", "D", "TG105 - Cliente no llegó a punto de encuentro."],
        ["2026-10-03 18:24:33", "I", "TG105 - RUTA KENNEDY", "INGRESO A BODEGA"],
        ["2026-10-04 13:40:35", "X", "", "CANCELADO POR DEVOLUCION"],
      ])
    )!;
    expect(t.latestGroup).toBe("returned");
    expect(t.latestStatus).toBe("Devuelto");
    expect(t.hasIncident).toBe(false);
  });

  it("'COBERTURA' (destino fuera de zona) no corta el envio", () => {
    const t = parseCargoExpresoResponse(
      respuesta([
        ["2026-09-25 17:27:04", "R", "TGU22 - Recolectando"],
        ["2026-09-26 07:17:36", "I", "LHSPC - LH HUB CEIBA", "INGRESO A BODEGA", "LCE"],
        ["2026-09-26 09:07:48", "X", "", "COBERTURA", "LCE"],
      ])
    )!;
    expect(t.latestGroup).toBe("in_progress");
    expect(t.events[0].title).toBe("Destino fuera de cobertura");
  });

  it("solo recolectado es pendiente", () => {
    const t = parseCargoExpresoResponse(respuesta([["2026-10-02 10:22:24", "R", "TGU22 - Recolectando"]]))!;
    expect(t.latestGroup).toBe("pending");
  });
});
