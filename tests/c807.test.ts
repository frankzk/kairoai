// Rastreo de c807 Xpress (Honduras): como se lee la respuesta de su API.
//
// Las respuestas de estos tests estan armadas a mano con la forma de las reales
// (44 guias de septiembre de 2026), sin datos de clientes.

import { describe, expect, it } from "vitest";
import { isC807Guide, normalizeC807Guide, parseC807Response } from "../lib/c807";

type Paso = [fecha: string, codigo: string, estatus: string, extra?: Record<string, unknown>];

const GUIA = "6595-13968-20260928000001";

function respuesta(pasos: Paso[]) {
  return {
    flujo: [{ codigo: "15", descripcion: "Llegó a su destino", orden: "11" }],
    status: {
      guia: { guia: GUIA, estatus: "", direccion: "Colonia de Prueba, San Pedro Sula" },
      // La API los devuelve del mas reciente al mas viejo.
      bitacora: [...pasos].reverse().map(([fecha, codigo, estatus, extra = {}]) => ({
        estatus,
        codigo,
        orden: null,
        observaciones: "",
        fecha,
        error: false,
        evaluacion: [],
        pod: [],
        error_motivo: null,
        ...extra,
      })),
    },
  };
}

const HASTA_REPARTO: Paso[] = [
  ["2026-09-28 15:45:35", "1", "Creado en sistema"],
  ["2026-09-29 16:40:59", "13", "Recogido en origen"],
  ["2026-09-29 18:43:21", "19", "Ingresado a bodega", { observaciones: "HUB Principal SPS" }],
  ["2026-09-30 07:06:24", "11", "Asignado en vehículo"],
  ["2026-09-30 07:19:33", "14", "En ruta a destino"],
];

const falla = (fecha: string, motivo: string, observaciones = "", evaluacion: unknown[] = []): Paso => [
  fecha,
  "16",
  "Problemas en la gestión",
  { error: true, error_motivo: motivo, observaciones, evaluacion },
];

describe("guias de c807", () => {
  it("son cuenta-cliente-fecha y correlativo", () => {
    expect(isC807Guide("6595-13968-20260928110658")).toBe(true);
    expect(normalizeC807Guide(" 6595-13968-20260928110658 ")).toBe("6595-13968-20260928110658");
    expect(isC807Guide("BH262231376-1")).toBe(false);
    expect(isC807Guide("FD43326843")).toBe(false);
  });
});

describe("parseC807Response", () => {
  it("sin bitacora devuelve null", () => {
    expect(parseC807Response(null)).toBeNull();
    expect(parseC807Response({ status: { bitacora: [], guia: {} } })).toBeNull();
  });

  it("'Llegó a su destino' es la entrega, con quien recibe", () => {
    const t = parseC807Response(
      respuesta([
        ...HASTA_REPARTO,
        ["2026-09-30 11:15:03", "15", "Llegó a su destino", {
          devolucion: false,
          evaluacion: [{ pregunta: "Nombre de quien recibe", respuesta: "Quien Recibio" }],
        }],
      ])
    )!;
    expect(t.latestGroup).toBe("delivered");
    expect(t.receiverName).toBe("Quien Recibio");
    // Hora de Honduras (UTC-6).
    expect(t.events[0].date).toBe("2026-09-30T17:15:03.000Z");
  });

  it("'Llegó a su destino' con devolucion es el paquete que volvio al remitente", () => {
    const t = parseC807Response(
      respuesta([
        ...HASTA_REPARTO,
        falla("2026-09-30 14:00:00", "Cliente rechaza envío", "Lo rechazo porque no es lo que pidio"),
        ["2026-10-02 09:00:00", "17", "Devolución"],
        ["2026-10-04 10:00:00", "15", "Llegó a su destino", { devolucion: true, error_motivo: "Devolución" }],
      ])
    )!;
    expect(t.latestGroup).toBe("returned");
    expect(t.latestStatus).toBe("Devuelto");
  });

  it("'Devolución' (17) ya es devolucion aunque el paquete no haya llegado", () => {
    const t = parseC807Response(
      respuesta([...HASTA_REPARTO, falla("2026-09-30 14:00:00", "Numero equivocado"), ["2026-10-02 09:00:00", "17", "Devolución"]])
    )!;
    expect(t.latestGroup).toBe("returned");
  });

  it("un intento fallido que no volvio a salir es incidencia, con motivo y detalle del repartidor", () => {
    const t = parseC807Response(
      respuesta([
        ...HASTA_REPARTO,
        falla("2026-09-30 14:22:00", "Direccion incompleta/no contesta", "No contesta llamadas ni mensajes"),
        ["2026-09-30 18:00:00", "19", "Ingresado a bodega", { observaciones: "HUB Principal SPS" }],
        // La llamada de su centro de atencion no es otro intento ni una salida.
        ["2026-10-01 09:00:00", "23", "Validación", { error_motivo: "Direccion incompleta/no contesta" }],
      ])
    )!;
    expect(t.latestGroup).toBe("failed");
    expect(t.incidentReason).toBe("Direccion incompleta/no contesta: No contesta llamadas ni mensajes");
    expect(t.latestAt).toBe("2026-09-30T20:22:00.000Z");
    expect(t.events.filter((e) => e.group === "failed")).toHaveLength(1);
  });

  it("la reprogramacion pedida por el cliente lleva la fecha nueva", () => {
    const t = parseC807Response(
      respuesta([
        ...HASTA_REPARTO,
        falla("2026-09-30 14:22:00", "Reprogramación", "Cliente dijo que estaba fuera de casa", [
          { pregunta: "Reprogramación", respuesta: "2026-10-02" },
        ]),
      ])
    )!;
    expect(t.incidentReason).toBe("Reprogramación: Cliente dijo que estaba fuera de casa (nueva fecha 2026-10-02)");
  });

  it("si despues de la falla lo asignaron a un vehiculo, es un reintento en curso", () => {
    const t = parseC807Response(
      respuesta([
        ...HASTA_REPARTO,
        falla("2026-09-30 14:22:00", "Por tiempo"),
        ["2026-10-01 07:00:00", "19", "Ingresado a bodega"],
        ["2026-10-01 08:00:00", "11", "Asignado en vehículo"],
      ])
    )!;
    expect(t.latestGroup).toBe("in_progress");
    expect(t.events.filter((e) => e.group === "failed")).toHaveLength(1);
  });

  it("solo la guia creada: c807 todavia no lo recogio", () => {
    const t = parseC807Response(respuesta([["2026-09-28 15:52:50", "1", "Creado en sistema"]]))!;
    expect(t.latestGroup).toBe("pending");
    expect(t.latestStatus).toBe("Guía creada, sin recoger");
  });
});
