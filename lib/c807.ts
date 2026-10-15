// Cliente y parser del rastreo de c807 Xpress (Honduras).
//
// POR QUE EXISTE: c807 Xpress llevo parte de los envios de Mireva Honduras
// (guias 6595-13968-AAAAMMDDNNNNNN) y Kairo no los seguia. De 44 guias de
// septiembre, 15 terminaron devueltas y 3 nunca las recogio c807 (13/10/2026).
// Su pagina publica de rastreo (c807xpress.com/tracking/?guia=...) pide los
// datos a esta API, que devuelve la bitacora completa de la guia.
//
// Codigos de la bitacora vistos en esas 44 guias:
//   1 creado en sistema · 13 recogido en origen · 19 ingresado a bodega ·
//   21 traslado a bodega · 20 retenido en bodega · 3 actualizacion de datos ·
//   11 asignado en vehiculo · 14 en ruta a destino · 16 problemas en la gestion
//   (el intento fallido: el motivo va en error_motivo y el detalle del
//   repartidor en observaciones) · 23 validacion (llamada de su centro de
//   atencion, no es un intento) · 17 devolucion · 15 llego a su destino: es la
//   entrega, salvo que traiga devolucion = true (el paquete volvio al remitente).
import {
  armarRastreo,
  delMasReciente,
  estadoVigente,
  fechaHonduras,
  type ShipmentEvent,
  type ShipmentTracking,
} from "./courier-tracking";

const C807_ORIGIN = "https://c807xpress.com";
const C807_TRACKING_ENDPOINT = `${C807_ORIGIN}/api-xpress-gacela/guia.php`;
// Despues de un intento fallido, asignarlo a un vehiculo o salir en ruta es
// volver a salir a reparto.
const SALIDAS = new Set(["11", "14"]);

type RawBitacora = {
  estatus?: unknown;
  codigo?: unknown;
  observaciones?: unknown;
  fecha?: unknown;
  error_motivo?: unknown;
  devolucion?: unknown;
  evaluacion?: unknown;
};

type RawGuia = { guia?: unknown; direccion?: unknown; estatus?: unknown };

export function normalizeC807Guide(value?: string | null): string {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

/** Guias de c807 Xpress: cuenta-cliente-fecha y correlativo (p.ej. 6595-13968-20260928110658). */
export function isC807Guide(value?: string | null): boolean {
  return /^\d{3,6}-\d{3,8}-\d{14}$/.test(normalizeC807Guide(value));
}

function texto(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).replace(/\s+/g, " ").trim() : "";
}

function respuesta(evaluacion: unknown, pregunta: RegExp): string {
  if (!Array.isArray(evaluacion)) return "";
  const item = (evaluacion as Array<{ pregunta?: unknown; respuesta?: unknown }>).find((e) =>
    pregunta.test(texto(e.pregunta))
  );
  return item ? texto(item.respuesta) : "";
}

function aEvento(b: RawBitacora): ShipmentEvent {
  const codigo = texto(b.codigo);
  const estatus = texto(b.estatus);
  const obs = texto(b.observaciones);
  const motivo = texto(b.error_motivo);
  const base = { code: codigo, description: obs, date: fechaHonduras(texto(b.fecha)), note: obs };
  switch (codigo) {
    case "15":
      return b.devolucion === true
        ? { ...base, group: "returned", title: "Devuelto al remitente" }
        : { ...base, group: "delivered", title: "Entregado" };
    case "17":
      return { ...base, group: "returned", title: "Devolución" };
    case "16": {
      // "Reprogramación" trae la fecha que pidio el cliente.
      const nuevaFecha = respuesta(b.evaluacion, /reprogramaci/i);
      const detalle = [motivo || "Sin motivo", obs].filter(Boolean).join(": ");
      return {
        ...base,
        group: "failed",
        title: `Intento de entrega fallido: ${motivo || "sin motivo"}`,
        description: nuevaFecha ? `${detalle} (nueva fecha ${nuevaFecha})` : detalle,
      };
    }
    case "23":
      return { ...base, group: "in_progress", title: motivo ? `Validación: ${motivo}` : "Validación" };
    case "1":
      return { ...base, group: "pending", title: "Guía creada" };
    default:
      return { ...base, group: "in_progress", title: obs && /bodega/i.test(estatus) ? `${estatus} (${obs})` : estatus || `Estado ${codigo}` };
  }
}

/** Interpreta la respuesta de la API. Null si no trae la guia. Exportado para tests. */
export function parseC807Response(payload: unknown): ShipmentTracking | null {
  const status = (payload as { status?: { bitacora?: unknown; guia?: RawGuia } } | null)?.status;
  const bitacora = Array.isArray(status?.bitacora) ? (status!.bitacora as RawBitacora[]) : [];
  const guia = status?.guia;
  if (!guia || !bitacora.length) return null;
  const eventos = delMasReciente(bitacora.map(aEvento));
  const estado = estadoVigente(eventos, SALIDAS);
  const entrega = bitacora.find((b) => texto(b.codigo) === "15" && b.devolucion !== true);
  return armarRastreo(normalizeC807Guide(texto(guia.guia)), eventos, estado, {
    // Solo la guia creada: c807 todavia no recogio el paquete.
    enCurso: estado.group === "pending" ? "Guía creada, sin recoger" : texto(guia.estatus),
    deliveryAddress: texto(guia.direccion),
    receiverName: entrega ? respuesta(entrega.evaluacion, /nombre de quien recibe/i) : "",
  });
}

export async function fetchC807Tracking(guide: string): Promise<ShipmentTracking> {
  const guideNumber = normalizeC807Guide(guide);
  if (!isC807Guide(guideNumber)) throw new Error("La guia no tiene formato de c807 Xpress.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(C807_TRACKING_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: C807_ORIGIN,
        referer: `${C807_ORIGIN}/tracking/?guia=${encodeURIComponent(guideNumber)}`,
        "x-requested-with": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
      body: new URLSearchParams({ guia_xpress: guideNumber }).toString(),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("c807 no respondio en 15 segundos.");
    throw new Error(err instanceof Error ? err.message : "No se pudo consultar c807.");
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`c807 respondio HTTP ${res.status}.`);
  // Responde JSON con content-type text/html.
  const body = await res.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }
  const parsed = parseC807Response(payload);
  if (!parsed) throw new Error("c807 no encontro informacion para esta guia.");
  return parsed;
}
