// Historial completo de Forza (Honduras): incidencias, devoluciones y la hora.
//
// EL CASO (16/10/2026): Forza valido "destinatario no responde las llamadas" en
// la guia de #MIRH20879 y en Kairo el pedido seguia "En ruta": leia solo los 5
// hitos de la linea de tiempo y la novedad se abrio dos dias despues, deducida y
// sin el motivo. El historial completo venia en la misma consulta
// (GetNewDeliveryTracking, order.milestones) y no se leia.
//
// Los historiales de estos tests estan armados a mano con la forma de los reales
// (150 guias de julio a octubre de 2026), sin datos de clientes.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fechaForza, interpretarHistorialForza, limpiarNotaForza } from "../lib/forza-historial";
import { fetchForzaTracking } from "../lib/forza";

type Paso = [fecha: string, etapa: number, titulo: string, descripcion?: string, clasificacion?: string];

const hito = ([date, stageId, title, description = title, clasification = ""]: Paso) => ({
  date,
  stageId,
  title,
  description,
  clasification,
});
const historial = (pasos: Paso[]) => [...pasos].reverse().map(hito);

const HASTA_RUTA: Paso[] = [
  ["2026-10-15 15:06:18Z", 1, "Solicitado"],
  ["2026-10-15 16:36:00Z", 2, "Recolectado"],
  ["2026-10-15 19:30:04Z", 11, "Arribó a las instalaciones"],
  ["2026-10-16 04:26:40Z", 10, "En Inventario"],
  ["2026-10-16 05:35:14Z", 4, "En ruta"],
];
const incidencia = (fecha: string, motivo: string, tipo = "Intento de entrega fallida"): Paso => [fecha, 45, "Incidencia en ruta", motivo, tipo];
const validada = (fecha: string, nota: string): Paso => [fecha, 50, "Incidencia Validada", nota];
const reproceso = (fecha: string): Paso => [fecha, 8, "Paquete Retornado para Reproceso"];
const ruta = (fecha: string): Paso => [fecha, 4, "En ruta"];

describe("fechaForza: Forza manda la hora de Honduras", () => {
  it("la Z del historial es falsa: 12:59 en Honduras son 18:59 UTC", () => {
    expect(fechaForza("2026-10-16 12:59:14Z")).toBe("2026-10-16T18:59:14.000Z");
  });
  it("la consulta vieja trae mes/dia/año con AM/PM", () => {
    expect(fechaForza("10/15/2026 3:06:18 PM")).toBe("2026-10-15T21:06:18.000Z");
    expect(fechaForza("10/20/2026 12:02:20 AM")).toBe("2026-10-20T06:02:20.000Z");
  });
  it("lo que no entiende queda en null", () => {
    expect(fechaForza("")).toBeNull();
    expect(fechaForza("ayer")).toBeNull();
  });
});

describe("limpiarNotaForza: la nota del call center sin telefonos ni coletillas", () => {
  it.each([
    ["50400000000 Destinatario no responde las llamadas. Se programa segunda visita.", "Destinatario no responde las llamadas. Se programa segunda visita."],
    ["C/E00000000-Destinatario no responde las llamadas.se gestiona visita.ACEPTA EVIDENCIA POR INFORMACION CLARA", "Destinatario no responde las llamadas.se gestiona visita."],
    ["+504 0000-0000 - -Destinatario no contesta, cuenta con los intentos de entrega, se gestiona devolución.", "Destinatario no contesta, cuenta con los intentos de entrega, se gestiona devolución."],
    ["S/E 50400000000Destinatario no responde las llamadas. Se programa visita.", "Destinatario no responde las llamadas. Se programa visita."],
    ["00000000--Dest. no responde llamada, se prepara paquete para segundo intento de entrega--Se declina evidencia por falta de informacion.", "Dest. no responde llamada, se prepara paquete para segundo intento de entrega"],
    ["-su pedido ha sido reprogramado", "Su pedido ha sido reprogramado"],
  ])("%s", (crudo, limpio) => {
    expect(limpiarNotaForza(crudo)).toBe(limpio);
  });
});

describe("interpretarHistorialForza", () => {
  it("sin historial devuelve null (se usa la consulta vieja)", () => {
    expect(interpretarHistorialForza(undefined)).toBeNull();
    expect(interpretarHistorialForza([])).toBeNull();
  });

  it("una incidencia en ruta es un intento fallido vigente, con el motivo y lo que decidio Forza", () => {
    const h = interpretarHistorialForza(
      historial([
        ...HASTA_RUTA,
        incidencia("2026-10-16 08:07:35Z", "Destinatario no localizado"),
        validada("2026-10-16 12:59:14Z", "50400000000 Destinatario no responde las llamadas. Se programa segunda visita."),
        reproceso("2026-10-16 15:42:16Z"),
      ])
    )!;
    expect(h.group).toBe("failed");
    expect(h.motivo).toBe("Destinatario no localizado · Forza: Destinatario no responde las llamadas. Se programa segunda visita.");
    expect(h.ultimaFalla).toMatchObject({ code: "INCIDENCIA_EN_RUTA", date: "2026-10-16T14:07:35.000Z" });
    // La validacion y la vuelta a bodega no son otros intentos.
    expect(h.events.filter((e) => e.group === "failed")).toHaveLength(1);
    // Del mas reciente al mas viejo.
    expect(h.events[0].code).toBe("RETORNADO_PARA_REPROCESO");
  });

  it("si vuelve a salir a ruta, el intento queda en el historial y el envio sigue en curso", () => {
    const h = interpretarHistorialForza(
      historial([...HASTA_RUTA, incidencia("2026-10-16 08:07:35Z", "No hay nadie en destino"), reproceso("2026-10-16 15:42:16Z"), ruta("2026-10-17 05:09:59Z")])
    )!;
    expect(h.group).toBe("in_progress");
    expect(h.motivo).toBe("");
    expect(h.events.filter((e) => e.group === "failed")).toHaveLength(1);
  });

  it("dos avisos de incidencia en la misma salida son un solo intento", () => {
    const h = interpretarHistorialForza(
      historial([...HASTA_RUTA, incidencia("2026-10-16 08:00:00Z", "Destinatario no localizado"), incidencia("2026-10-16 09:00:00Z", "Destinatario no localizado")])
    )!;
    expect(h.events.filter((e) => e.group === "failed")).toHaveLength(1);
  });

  it("una salida que vuelve a la bodega sin incidencia tambien es un intento fallido", () => {
    // 67 de 198 vueltas a bodega de la muestra no tenian incidencia: todas de un dia entero en ruta.
    const h = interpretarHistorialForza(historial([...HASTA_RUTA, reproceso("2026-10-16 17:21:00Z")]))!;
    expect(h.group).toBe("failed");
    expect(h.motivo).toContain("Forza no registro el motivo");
  });

  it("tres visitas fallidas y la devolucion (el caso de #MIRH20879)", () => {
    const h = interpretarHistorialForza(
      historial([
        ...HASTA_RUTA,
        incidencia("2026-10-16 08:07:35Z", "Destinatario no localizado"),
        validada("2026-10-16 12:59:14Z", "Destinatario no responde las llamadas. se gestiona visita."),
        reproceso("2026-10-16 15:42:16Z"),
        ruta("2026-10-17 05:09:59Z"),
        incidencia("2026-10-17 07:44:28Z", "Destinatario no localizado"),
        reproceso("2026-10-17 16:41:56Z"),
        ruta("2026-10-19 05:24:49Z"),
        incidencia("2026-10-19 08:34:03Z", "Destinatario no localizado"),
        validada("2026-10-19 10:14:47Z", "Destinatario no contesta las llamadas. cuenta con dos visitas Se gestiona devolución"),
        reproceso("2026-10-19 15:04:07Z"),
        ruta("2026-10-20 09:19:08Z"),
        ["2026-10-20 16:26:19Z", 14, "Devuelto"],
      ])
    )!;
    expect(h.group).toBe("returned");
    expect(h.events.filter((e) => e.group === "failed")).toHaveLength(3);
  });

  it("Forza mostraba la devolucion como 'Entregado'; el historial la dice", () => {
    const entregado = interpretarHistorialForza(
      historial([...HASTA_RUTA, ["2026-10-16 13:04:12Z", 5, "Entregado"], ["2026-10-16 20:28:44Z", 25, "COD pagado"]])
    )!;
    expect(entregado.group).toBe("delivered");
    const anulado = interpretarHistorialForza(historial([["2026-10-15 15:06:18Z", 1, "Solicitado"], ["2026-10-15 18:00:00Z", 7, "Anulado"]]))!;
    expect(anulado.group).toBe("cancelled");
  });
});

describe("fetchForzaTracking con el historial completo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lee order.milestones de GetNewDeliveryTracking (IdResult 202) sin caer a la consulta vieja", async () => {
    const respuesta = {
      d: {
        StatusCode: 200,
        Data: {
          PayLoad: {
            ObjectValue: {
              IdResult: "202",
              Message: "",
              order: {
                customer: { fullname: "Cliente de Prueba" },
                destiny: { address: null, receiver: "" },
                milestones: historial([
                  ...HASTA_RUTA,
                  incidencia("2026-10-16 08:07:35Z", "Destinatario no localizado"),
                  validada("2026-10-16 12:59:14Z", "Destinatario no responde las llamadas. Se programa segunda visita."),
                ]),
              },
            },
          },
        },
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(respuesta), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = await fetchForzaTracking("FD00000001");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(t).toMatchObject({
      historial: true,
      latest_group: "failed",
      latest_status: "Intento de entrega fallido",
      latest_at: "2026-10-16T14:07:35.000Z",
      has_incident: true,
      incident_reason: "Destinatario no localizado · Forza: Destinatario no responde las llamadas. Se programa segunda visita.",
      receiver_name: "Cliente de Prueba",
    });
  });
});
