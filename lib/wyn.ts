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

export function normalizeWynStatus(status: string, stepName = "", description = ""): CourierNormalizedStatus {
  const text = normalizeText(`${status} ${stepName} ${description}`);
  if (includesAny(text, ["returned", "devuelto", "retorno", "devolucion"])) return "returned";
  if (includesAny(text, ["not delivered", "no entregado", "fallido", "failed", "rechazado"])) {
    return "not_delivered";
  }
  if (includesAny(text, ["delivered", "entregado"])) return "delivered";
  if (includesAny(text, ["incident", "incidencia", "incorrecto", "problema"])) return "incident";
  if (includesAny(text, ["cancelled", "cancelado", "cancelada"])) return "cancelled";
  if (includesAny(text, ["en ruta", "transito", "ultima milla", "cartero", "distribuidor", "llegada", "retirado"])) {
    return "en_route";
  }
  if (includesAny(text, ["pending", "pendiente", "creado", "registrado"])) return "pending";
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
  const latestGroup = normalizeWynStatus(asText(data.status), latestStatus, latestDescription);
  const incidentEvent = events.find((event) => isIncidentText(`${event.title} ${event.description} ${event.note}`));
  const hasIncident = latestGroup === "returned" || latestGroup === "not_delivered" || Boolean(incidentEvent);

  return {
    guideNumber,
    trackingNumber: asText(data.trackingNumber) || guideNumber,
    latestStatus,
    latestCode: events[0]?.code || asText(data.status),
    latestGroup,
    latestAt: events[0]?.date ?? null,
    hasIncident,
    incidentReason: incidentEvent?.description || (hasIncident ? latestDescription : ""),
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
  return {
    code: asText(event.code),
    group: normalizeWynStatus(title, title, description),
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

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function isIncidentText(value: string): boolean {
  const text = normalizeText(value);
  return includesAny(text, ["incorrect", "incid", "fallid", "rechaz", "devuelt", "retorno", "no entreg"]);
}
