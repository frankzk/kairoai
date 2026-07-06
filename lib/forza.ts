const FORZA_HN_API_URL = "https://portal.portal.forzadelivery.com/fdHN/Home.aspx/API";
const FORZA_PUBLIC_API_URL = "https://rastreo.forzadelivery.com/fd2/Home.aspx/API";
const FORZA_TRACKING_BASE = "https://rastreo.forzadelivery.com";

export type ForzaGroup = "delivered" | "failed" | "returned" | "in_progress";

export interface ForzaEvent {
  code: string;
  group: ForzaGroup;
  title: string;
  description: string;
  date: string | null;
  note: string;
}

export interface ForzaTracking {
  ok: boolean;
  http_status: number;
  guide_number: string;
  tracking_number: string;
  latest_status: string | null;
  latest_status_code: string | null;
  latest_group: ForzaGroup | null;
  latest_at: string | null;
  delivery_address: string;
  receiver_name: string;
  has_incident: boolean;
  incident_reason: string;
  events: ForzaEvent[];
  error?: string;
  raw?: string;
}

interface ForzaRequestVariant {
  label: string;
  path: string;
  data: {
    Method: string;
    Params: Record<string, string | number>;
  };
}

export function buildForzaTrackingUrl(guide: string): string {
  const normalized = normalizeForzaGuide(guide);
  return `${FORZA_TRACKING_BASE}/${encodeURIComponent(normalized || guide)}`;
}

export function normalizeForzaGuide(guide: string): string {
  const trimmed = String(guide ?? "").trim().toUpperCase();
  if (!trimmed) return "";
  return trimmed.startsWith("FD") ? trimmed : `FD${trimmed.replace(/^FD/i, "")}`;
}

export async function fetchForzaTracking(
  guide: string,
  options: { includeRaw?: boolean } = {}
): Promise<ForzaTracking> {
  const normalizedGuide = normalizeForzaGuide(guide);
  const guideNumber = normalizedGuide.replace(/^FD/i, "");
  const base: ForzaTracking = {
    ok: false,
    http_status: 0,
    guide_number: normalizedGuide,
    tracking_number: normalizedGuide,
    latest_status: null,
    latest_status_code: null,
    latest_group: null,
    latest_at: null,
    delivery_address: "",
    receiver_name: "",
    has_incident: false,
    incident_reason: "",
    events: [],
  };

  if (!guideNumber) {
    return { ...base, error: "guide requerido" };
  }

  const requests = buildForzaRequestVariants(guideNumber);
  const endpoints = [FORZA_PUBLIC_API_URL, FORZA_HN_API_URL];
  let lastError = "";

  for (const endpoint of endpoints) {
    for (const request of requests) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=UTF-8",
            accept: "application/json, text/plain, */*",
            origin: FORZA_TRACKING_BASE,
            referer: buildForzaTrackingUrl(normalizedGuide),
            "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
            "sec-ch-ua-mobile": "?1",
            "sec-ch-ua-platform": '"Android"',
            "user-agent":
              "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
          },
          body: JSON.stringify({
            path: request.path,
            data: JSON.stringify(request.data),
          }),
          cache: "no-store",
        });

        const text = await res.text();
        const endpointHost = new URL(endpoint).hostname;
        if (isCaptchaResponse(text)) {
          lastError = `Forza devolvio CAPTCHA (${endpointHost}). Necesitamos API oficial, archivo de estados o webhook; no se debe automatizar contra el captcha.`;
          if (options.includeRaw) lastError += `: ${text.slice(0, 500)}`;
          continue;
        }

        const detail = parseForzaResponse(text);
        if (!detail) {
          lastError = `No se pudo interpretar la respuesta de Forza (${endpointHost}, ${request.label})`;
          if (options.includeRaw) lastError += `: ${text.slice(0, 500)}`;
          continue;
        }

        if (detail.error) {
          lastError = detail.error;
          continue;
        }

        // Entrega es terminal: si la guia se entrego, ese estado prevalece sobre
        // eventos posteriores. No hay reversion de una entrega bajo la misma guia.
        const delivered = detail.events.find((e) => e.group === "delivered");
        const latest = delivered ?? detail.events[0] ?? null;
        const latestStatus = latest?.title ?? detail.latestStatus ?? null;
        if (!latestStatus && !detail.events.length) {
          lastError = `Forza no devolvio estado para esta guia (${endpointHost}, ${request.label})`;
          continue;
        }

        const incident = computeForzaIncident(detail.events);
        return {
          ...base,
          ok: res.ok,
          http_status: res.status,
          latest_status: latestStatus,
          latest_status_code: latest?.code ?? null,
          latest_group: latest?.group ?? classifyForzaGroup(detail.latestStatus ?? ""),
          latest_at: latest?.date ?? detail.deliveryEta,
          delivery_address: detail.deliveryAddress,
          receiver_name: detail.receiverName,
          has_incident: incident.active,
          incident_reason: incident.reason,
          events: detail.events,
          ...(options.includeRaw ? { raw: text.slice(0, 20000) } : {}),
        };
      } catch (err) {
        lastError = `${new URL(endpoint).hostname} (${request.label}): ${
          err instanceof Error ? err.message : "Error consultando Forza"
        }`;
        continue;
      }
    }
  }

  return { ...base, error: lastError || "No se pudo interpretar la respuesta de Forza" };
}

function buildForzaRequestVariants(guideNumber: string): ForzaRequestVariant[] {
  return [
    {
      label: "GetNewDeliveryTracking",
      path: "Tracking/GetNewDeliveryTracking",
      data: {
        Method: "GetNewDeliveryTracking",
        Params: {
          GuideSerie: "FD",
          GuideNumber: guideNumber,
          TicketNumber: "",
          NirPhone: 0,
          Phone: 0,
        },
      },
    },
    {
      label: "GetTrackingPublic",
      path: "Tracking/GetTrackingPublic",
      data: {
        Method: "GetTrackingPublic",
        Params: {
          GuideSerie: "FD",
          GuideNumber: guideNumber,
        },
      },
    },
  ];
}

function parseForzaResponse(raw: string): {
  latestStatus: string;
  deliveryEta: string | null;
  deliveryAddress: string;
  receiverName: string;
  events: ForzaEvent[];
  error?: string;
} | null {
  const parsed = safeJsonParse(raw);
  if (!parsed) return null;

  const objectValue = extractForzaObjectValue(parsed);
  const objectRecord = asRecord(objectValue);
  if (!objectRecord) return null;

  const resultCode = readNumber(objectRecord, ["IdResult", "idResult", "StatusCode", "statusCode", "Code", "code"]);
  const message = readString(objectRecord, ["Message", "message", "Description", "description"]);
  const statusRows = readArrayDeep(objectRecord, [
    "statusList",
    "StatusList",
    "trackingList",
    "TrackingList",
    "events",
    "Events",
    "history",
    "History",
    "TrackingEvents",
  ]);

  if (resultCode && resultCode !== 200 && !statusRows.length) {
    return {
      latestStatus: "",
      deliveryEta: null,
      deliveryAddress: "",
      receiverName: "",
      events: [],
      error: message || "Forza no devolvio datos para esta guia.",
    };
  }

  const events = statusRows
    .map(normalizeRawForzaStatus)
    .filter((event): event is ForzaEvent => Boolean(event))
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  const latestStatus =
    readString(objectRecord, [
      "StatusTrackingTitle",
      "statusTrackingTitle",
      "StatusTitle",
      "statusTitle",
      "LatestStatus",
      "latestStatus",
      "CurrentStatus",
      "currentStatus",
    ]) || events[0]?.title || "";

  return {
    latestStatus,
    deliveryEta: normalizeForzaDate(
      readString(objectRecord, ["DeliveryETA", "deliveryETA", "deliveryEta", "EstimatedDelivery", "estimatedDelivery"])
    ),
    deliveryAddress:
      readString(objectRecord, ["DeliveryAddress", "deliveryAddress", "Address", "address", "Direccion", "direccion"]) ||
      readStringPath(objectRecord, ["order", "destiny", "address"]) ||
      readStringPath(objectRecord, ["order", "destiny", "place"]) ||
      [objectRecord.Poblado, objectRecord.Municipio, objectRecord.Departamento]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(", "),
    receiverName:
      readString(objectRecord, ["ReceiverName", "receiverName", "Receiver", "receiver", "Consignee", "consignee"]) ||
      readStringPath(objectRecord, ["order", "customer", "fullname"]) ||
      readStringPath(objectRecord, ["order", "destiny", "receiver"]),
    events,
  };
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractForzaObjectValue(value: unknown): unknown {
  let current: unknown = value;
  for (let i = 0; i < 12; i += 1) {
    if (typeof current === "string") {
      const parsed = safeJsonParse(current);
      if (!parsed) return current;
      current = parsed;
      continue;
    }

    const record = asRecord(current);
    if (!record) return current;

    if (record.ObjectValue !== undefined) {
      current = record.ObjectValue;
      continue;
    }

    const nextKey = ["d", "Data", "data", "PayLoad", "payload", "Result", "result"].find(
      (key) => record[key] !== undefined && record[key] !== null
    );
    if (!nextKey) return current;
    current = record[nextKey];
  }
  return current;
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  const text = readString(record, keys);
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function readArrayDeep(value: unknown, keys: string[], depth = 0): unknown[] {
  if (depth > 4) return [];
  const record = asRecord(value);
  if (!record) return [];

  for (const key of keys) {
    const direct = record[key];
    if (Array.isArray(direct)) return direct;
  }

  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object") continue;
    const nested = readArrayDeep(child, keys, depth + 1);
    if (nested.length) return nested;
  }

  return [];
}

function readStringPath(record: Record<string, unknown>, path: string[]): string {
  let current: unknown = record;
  for (const key of path) {
    const currentRecord = asRecord(current);
    if (!currentRecord) return "";
    current = currentRecord[key];
  }
  return current === undefined || current === null ? "" : String(current).trim();
}

function normalizeRawForzaStatus(status: unknown): ForzaEvent | null {
  const record = asRecord(status);
  if (!record) return null;
  const title =
    readString(record, [
      "label",
      "Label",
      "Status",
      "status",
      "StatusTitle",
      "StatusName",
      "Title",
      "title",
      "Name",
      "name",
      "Estado",
      "estado",
      "Event",
      "event",
    ]) || "Movimiento Forza";
  const description = readString(record, [
    "Description",
    "description",
    "Descripcion",
    "descripcion",
    "StatusDescription",
    "EventDescription",
    "Observation",
    "Observacion",
    "Comment",
    "comment",
    "Message",
    "message",
  ]);
  const date = normalizeForzaDate(
    readString(record, [
      "DateCreate",
      "dateCreate",
      "Date",
      "date",
      "CreatedAt",
      "createdAt",
      "EventDate",
      "eventDate",
      "Fecha",
      "fecha",
    ])
  );
  if (!title && !description && !date) return null;

  return {
    code: title.toUpperCase().replace(/\s+/g, "_"),
    group: classifyForzaGroup(`${title} ${description}`),
    title,
    description,
    date,
    note: readString(record, ["Note", "note", "Notes", "notes"]),
  };
}

function isCaptchaResponse(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes("recaptcha") || lower.includes("captcha") || lower.includes("no soy un robot");
}

function classifyForzaGroup(status: string): ForzaGroup {
  const lower = status.toLowerCase();
  // Fallas/devoluciones ANTES que la entrega: "no entregado" contiene "entregado"
  // y no debe clasificarse como delivered.
  if (lower.includes("no entreg") || lower.includes("fall") || lower.includes("incid")) return "failed";
  if (lower.includes("devuelto") || lower.includes("retorno") || lower.includes("retornado")) return "returned";
  if (lower.includes("reproceso")) return "in_progress";
  if (lower.includes("entrega completa") || lower.includes("entregado")) return "delivered";
  return "in_progress";
}

function computeForzaIncident(events: ForzaEvent[]): { active: boolean; reason: string } {
  // Entrega terminal: una guia con un evento "delivered" nunca tiene incidencia activa.
  if (events.some((e) => e.group === "delivered")) return { active: false, reason: "" };
  const latest = events[0];
  if (!latest || latest.group !== "failed") return { active: false, reason: "" };
  return { active: true, reason: latest.description || latest.title };
}

function normalizeForzaDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!match) return raw;
  const [, first, second, year, hour = "0", minute = "0", secondPart = "0", meridian = ""] = match;
  let month = Number(first);
  let day = Number(second);
  if (month > 12 && day <= 12) {
    month = Number(second);
    day = Number(first);
  }
  let hours = Number(hour);
  const upperMeridian = meridian.toUpperCase();
  if (upperMeridian === "PM" && hours < 12) hours += 12;
  if (upperMeridian === "AM" && hours === 12) hours = 0;
  const date = new Date(Number(year), month - 1, day, hours, Number(minute), Number(secondPart));
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}
