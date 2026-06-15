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

interface ForzaEnvelope {
  d?: string;
}

interface ForzaInnerResponse {
  Data?: string | null;
}

interface ForzaPayload {
  StatusCode?: number;
  Description?: string;
  ObjectValue?: RawForzaObjectValue;
}

interface RawForzaObjectValue {
  IdResult?: number;
  Message?: string;
  statusList?: RawForzaStatus[];
  ReceiverName?: string;
  Poblado?: string;
  Municipio?: string;
  Departamento?: string;
  Description?: string;
  Country?: string;
  StatusTracking?: number;
  StatusTrackingTitle?: string;
  StatusTrackingDescription?: string;
  DeliveryETA?: string;
}

interface RawForzaStatus {
  label?: string;
  Description?: string;
  DateCreate?: string;
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

  const data = {
    Method: "GetTrackingPublic",
    Params: {
      GuideSerie: "FD",
      GuideNumber: guideNumber,
    },
  };

  const endpoints = [FORZA_HN_API_URL, FORZA_PUBLIC_API_URL];
  let lastError = "";

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          accept: "application/json, text/plain, */*",
          origin: FORZA_TRACKING_BASE,
          referer: buildForzaTrackingUrl(normalizedGuide),
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          path: "Tracking/GetTrackingPublic",
          data: JSON.stringify(data),
        }),
        cache: "no-store",
      });

      const text = await res.text();
      const detail = parseForzaResponse(text);
      if (!detail) {
        lastError = `No se pudo interpretar la respuesta de Forza (${new URL(endpoint).hostname})`;
        if (options.includeRaw) lastError += `: ${text.slice(0, 500)}`;
        continue;
      }

      if (detail.error) {
        return {
          ...base,
          ok: false,
          http_status: res.status,
          error: detail.error,
          ...(options.includeRaw ? { raw: text.slice(0, 20000) } : {}),
        };
      }

      const latest = detail.events[0] ?? null;
      const incident = computeForzaIncident(detail.events);
      return {
        ...base,
        ok: res.ok,
        http_status: res.status,
        latest_status: latest?.title ?? detail.latestStatus ?? null,
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
      lastError = `${new URL(endpoint).hostname}: ${
        err instanceof Error ? err.message : "Error consultando Forza"
      }`;
      continue;
    }
  }

  return { ...base, error: lastError || "No se pudo interpretar la respuesta de Forza" };
}

function parseForzaResponse(raw: string): {
  latestStatus: string;
  deliveryEta: string | null;
  deliveryAddress: string;
  receiverName: string;
  events: ForzaEvent[];
  error?: string;
} | null {
  try {
    const envelope = JSON.parse(raw) as ForzaEnvelope;
    const inner = JSON.parse(String(envelope.d ?? "{}")) as ForzaInnerResponse;
    const data = inner.Data ? (JSON.parse(inner.Data) as { PayLoad?: string }) : null;
    const payload = data?.PayLoad ? (JSON.parse(data.PayLoad) as ForzaPayload) : null;
    const objectValue = payload?.ObjectValue;
    if (!objectValue) return null;
    if (objectValue.IdResult !== 200) {
      return {
        latestStatus: "",
        deliveryEta: null,
        deliveryAddress: "",
        receiverName: "",
        events: [],
        error: objectValue.Message || "Forza no devolvio datos para esta guia.",
      };
    }

    const events = (objectValue.statusList ?? [])
      .map((status) => {
        const title = String(status.label ?? "").trim();
        const description = String(status.Description ?? "").trim();
        const date = normalizeForzaDate(status.DateCreate);
        return {
          code: title.toUpperCase().replace(/\s+/g, "_"),
          group: classifyForzaGroup(title),
          title,
          description,
          date,
          note: "",
        };
      })
      .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

    return {
      latestStatus: String(objectValue.StatusTrackingTitle ?? "").trim(),
      deliveryEta: normalizeForzaDate(objectValue.DeliveryETA),
      deliveryAddress: [objectValue.Poblado, objectValue.Municipio, objectValue.Departamento]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(", "),
      receiverName: String(objectValue.ReceiverName ?? "").trim(),
      events,
    };
  } catch {
    return null;
  }
}

function classifyForzaGroup(status: string): ForzaGroup {
  const lower = status.toLowerCase();
  if (lower.includes("entregado")) return "delivered";
  if (lower.includes("devuelto") || lower.includes("retorno") || lower.includes("retornado")) return "returned";
  if (lower.includes("fall") || lower.includes("incid") || lower.includes("no entreg")) return "failed";
  return "in_progress";
}

function computeForzaIncident(events: ForzaEvent[]): { active: boolean; reason: string } {
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
