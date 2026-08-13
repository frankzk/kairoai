import { matchesStatusKeyword } from "@/lib/courier-adapters";
import type { CourierNormalizedStatus, CourierTrackingEvent } from "@/lib/courier-adapters";

const WYN_TRACKING_ENDPOINT = "https://wynexpress.com/api/tracking";
const WYN_TRACKING_ORIGIN = "https://wynexpress.com";

type WynApiEvent = {
  status?: unknown;
  date?: unknown;
  time?: unknown;
  description?: unknown;
  code?: unknown;
  eventStep?: unknown;
};

type WynApiTracking = {
  trackingNumber?: unknown;
  status?: unknown;
  statusStepName?: unknown;
  lastEventDescription?: unknown;
  events?: unknown;
};

export interface WynTrackingResult {
  guideNumber: string;
  trackingNumber: string;
  latestStatus: string;
  latestCode: string;
  latestGroup: CourierNormalizedStatus;
  latestAt: string | null;
  hasIncident: boolean;
  incidentReason: string;
  deliveryAddress: string;
  receiverName: string;
  events: CourierTrackingEvent[];
  raw: Record<string, unknown>;
}

export function normalizeWynGuide(value?: string | null): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function isWynGuide(value?: string | null): boolean {
  return /^MLCR[0-9A-Z]+$/.test(normalizeWynGuide(value));
}

export function extractWynGuides(value?: string | null): string[] {
  const matches = String(value ?? "").toUpperCase().match(/MLCR[0-9A-Z]+/g) ?? [];
  return Array.from(new Set(matches.map(normalizeWynGuide).filter(isWynGuide)));
}

export function buildWynTrackingUrl(value: string): string {
  return `${WYN_TRACKING_ORIGIN}/tracking?number_id=${encodeURIComponent(normalizeWynGuide(value))}`;
}

/**
 * Taxonomia de eventos de WYN por codigo. El texto libre no alcanza para
 * clasificar: "Entregado a Distribuidor" (RC-0) es el traspaso a la ultima
 * milla, no una entrega al cliente, y "Entregado en direccion de retorno"
 * (PF-2) es justo lo contrario de una entrega. El codigo si es univoco, asi
 * que manda; el texto queda de respaldo para codigos que WYN agregue despues.
 *
 * Familias: OC = orden creada, WI = warehouse, RC = transito, LM = ultima
 * milla, PF = proceso finalizado (los unicos estados finales), AV = aviso.
 */
export const WYN_EVENT_GROUPS: Record<string, CourierNormalizedStatus> = {
  "OC-1": "pending", // Etiqueta impresa
  "WI-3": "en_route", // Recepcion en Warehouse MailAmericas
  "WI-4": "en_route", // Procesado
  "RC-0": "en_route", // Entregado a Distribuidor (traspaso, sigue en transito)
  "RC-4": "en_route", // Rectificacion de ruta
  "LM-1": "en_route", // Recibido en sucursal de Distribucion
  "LM-2": "en_route", // En manos del cartero
  "LM-3": "en_route", // Visita a domicilio
  "LM-4": "en_route", // Disponible para retiro en sucursal
  "LM-11": "en_route", // Reprogramacion: sigue en reparto
  "LM-6": "incident", // Zona de entrega intransitable
  "LM-7": "incident", // Destinatario ausente
  "LM-8": "incident", // Llego a domicilio y se rechazo el paquete
  "LM-9": "incident", // Domicilio de entrega incorrecto
  "LM-10": "incident", // Persona no autorizada para recibir
  "AV-2": "incident", // En investigacion
  "PF-1": "delivered", // Entregado
  "PF-2": "returned", // Entregado en direccion de retorno
  "PF-3": "not_delivered", // Siniestrado
  "PF-5": "not_delivered", // Robado
};

/** Grupo segun el codigo de WYN, o null si el codigo no esta en la taxonomia. */
export function wynGroupFromCode(code: string): CourierNormalizedStatus | null {
  return WYN_EVENT_GROUPS[String(code ?? "").trim().toUpperCase()] ?? null;
}

/** Codigos de WYN que representan un intento de entrega que no prospero. */
export function isWynIncidentCode(code: string): boolean {
  return wynGroupFromCode(code) === "incident";
}

/** Grupo de un evento suelto: manda el codigo y el texto queda de respaldo. */
export function wynEventGroup(code: string, title = "", description = ""): CourierNormalizedStatus {
  return wynGroupFromCode(code) ?? normalizeWynStatus(title, title, description);
}

/**
 * Grupo vigente de una guia segun su historial (el evento mas reciente primero).
 * La consulta a la API y la lectura de cache pasan las dos por aca para que no
 * puedan divergir: si la taxonomia cambia, las filas ya guardadas se releen con
 * la taxonomia nueva en vez de quedarse con el grupo viejo.
 */
export function deriveWynGroup(
  events: Array<Pick<CourierTrackingEvent, "code" | "title" | "description">>,
  fallbackText = ""
): CourierNormalizedStatus {
  const latest = events[0];
  return (
    wynGroupFromCode(String(latest?.code ?? "")) ??
    normalizeWynStatus(fallbackText, String(latest?.title ?? ""), String(latest?.description ?? ""))
  );
}

/**
 * Incidencia ACTIVA: la guia quedo parada y necesita gestion. Se mide sobre el
 * estado vigente, no sobre el historial: un intento fallido con movimiento
 * posterior ya no bloquea la entrega.
 */
export function isWynIncidentGroup(group: CourierNormalizedStatus): boolean {
  return group === "returned" || group === "not_delivered" || group === "incident";
}

export function normalizeWynStatus(status: string, stepName = "", description = ""): CourierNormalizedStatus {
  const text = `${status} ${stepName} ${description}`;
  const has = (needles: string[]) => matchesStatusKeyword(text, needles);
  if (has(["returned", "devuelto", "retorno", "devolucion"])) return "returned";
  // "Entregado a Distribuidor" (handoff a la ultima milla, eventStep 5 /
  // "Transito a destino") NO es entrega al cliente: el paquete sigue en
  // transito. Se evalua antes que "entregado" porque ahi "entregado" si abre
  // palabra, y sin esta regla el handoff se leia como delivered e inflaba la
  // tasa de entrega. Solo "Entregado" / "Proceso finalizado" (eventStep 7)
  // cuenta como entrega real.
  if (has(["distribuidor"])) return "en_route";
  if (has(["not delivered", "no entregado", "fallido", "failed", "rechazado"])) return "not_delivered";
  if (has(["delivered", "entregado"])) return "delivered";
  if (has(["incident", "incidencia", "incorrecto", "problema"])) return "incident";
  if (has(["cancelled", "cancelado", "cancelada"])) return "cancelled";
  if (has(["en ruta", "transito", "ultima milla", "cartero", "distribuidor", "llegada", "retirado"])) {
    return "en_route";
  }
  if (has(["pending", "pendiente", "creado", "registrado"])) return "pending";
  return "unknown";
}

export async function fetchWynTracking(guide: string): Promise<WynTrackingResult> {
  const guideNumber = normalizeWynGuide(guide);
  if (!isWynGuide(guideNumber)) throw new Error("La guia no tiene un formato WYN valido.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(WYN_TRACKING_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "es-CR,es;q=0.9,en;q=0.8",
        "content-type": "application/json",
        origin: WYN_TRACKING_ORIGIN,
        referer: buildWynTrackingUrl(guideNumber),
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ trackingNumber: guideNumber, language: "es", country: "Costa Rica" }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WYN no respondio dentro de 10 segundos.");
    }
    throw new Error(error instanceof Error ? error.message : "No se pudo consultar WYN.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`WYN respondio HTTP ${response.status}.`);

  const payload = (await response.json()) as { data?: WynApiTracking | null; message?: unknown };
  const data = payload.data;
  if (!data || typeof data !== "object") {
    throw new Error(asText(payload.message) || "WYN no encontro informacion para esta guia.");
  }

  const rawEvents = Array.isArray(data.events) ? (data.events as WynApiEvent[]) : [];
  const events = rawEvents.map(toTrackingEvent);
  const latestStatus = asText(data.statusStepName) || asText(data.status) || events[0]?.title || "Sin estado";
  const latestDescription = asText(data.lastEventDescription) || events[0]?.description || "";
  // El grupo del evento mas reciente ya viene del codigo, que es univoco; el
  // texto de cabecera de WYN solo se usa si ese codigo es desconocido.
  const latestGroup = deriveWynGroup(events, `${asText(data.status)} ${latestStatus} ${latestDescription}`);
  const hasIncident = isWynIncidentGroup(latestGroup);

  return {
    guideNumber,
    trackingNumber: asText(data.trackingNumber) || guideNumber,
    latestStatus,
    latestCode: events[0]?.code || asText(data.status),
    latestGroup,
    latestAt: events[0]?.date ?? null,
    hasIncident,
    incidentReason: hasIncident ? events[0]?.description || latestDescription : "",
    deliveryAddress: "",
    receiverName: "",
    events,
    raw: data as Record<string, unknown>,
  };
}

function toTrackingEvent(event: WynApiEvent): CourierTrackingEvent {
  const date = asText(event.date);
  const time = asText(event.time);
  const title = asText(event.status) || "Actualizacion WYN";
  const description = asText(event.description);
  const code = asText(event.code);
  return {
    code,
    // El codigo manda sobre el texto (ver WYN_EVENT_GROUPS).
    group: wynEventGroup(code, title, description),
    title,
    description,
    date: buildEventDate(date, time),
    note: "",
    raw: event as Record<string, unknown>,
  };
}

function buildEventDate(date: string, time: string): string | null {
  if (!date) return null;
  const candidate = `${date}T${time || "00:00"}:00-06:00`;
  return Number.isNaN(Date.parse(candidate)) ? date : candidate;
}

function asText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

