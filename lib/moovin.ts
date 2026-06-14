// Cliente y parser del tracking de Moovin, compartido por el endpoint bajo
// demanda y el lote. La pagina publica de Moovin es Next.js con Server Actions;
// se replica el POST con el header next-action. El id de la accion cambia
// cuando Moovin redespliega, por eso es configurable por env.
const MOOVIN_BASE = "https://utilities.moovin.me";
const MOOVIN_NEXT_ACTION =
  process.env.MOOVIN_NEXT_ACTION || "7fae531bab4ee20b1f874b0fafcfa412a52a5a165f";
const MOOVIN_COOKIE = process.env.MOOVIN_COOKIE || "";

const MOOVIN_STATUS_GROUP: Record<string, MoovinGroup> = {
  DELIVERED: "delivered",
  FAILED: "failed",
  RETURNED: "returned",
  RETURN: "returned",
  RETURNTOSENDER: "returned",
  // Cancelado (p.ej. supera numero de intentos): el paquete no se entrego.
  CANCELED: "returned",
  CANCELLED: "returned",
  CANCEL: "returned",
};

export type MoovinGroup = "delivered" | "failed" | "returned" | "in_progress";

export interface MoovinEvent {
  code: string;
  group: MoovinGroup;
  title: string;
  description: string;
  date: string | null;
  note: string;
}

export interface MoovinTracking {
  ok: boolean;
  http_status: number;
  id_package: string;
  last_name: string;
  tracking_number: string;
  profile: string;
  latest_status: string | null;
  latest_status_code: string | null;
  latest_group: MoovinGroup | null;
  latest_at: string | null;
  delivery_address: string;
  // Incidencia activa: ultimo estado es FAILED (no se resolvio en una entrega
  // posterior). Util para alertar entregas en riesgo.
  has_incident: boolean;
  incident_reason: string;
  events: MoovinEvent[];
  error?: string;
  raw?: string;
}

export async function fetchMoovinTracking(
  idPackage: string,
  lastName: string,
  options: { includeRaw?: boolean } = {}
): Promise<MoovinTracking> {
  const base: MoovinTracking = {
    ok: false,
    http_status: 0,
    id_package: idPackage,
    last_name: lastName,
    tracking_number: "",
    profile: "",
    latest_status: null,
    latest_status_code: null,
    latest_group: null,
    latest_at: null,
    delivery_address: "",
    has_incident: false,
    incident_reason: "",
    events: [],
  };

  const pageUrl = `${MOOVIN_BASE}/?tracking/lastName=${encodeURIComponent(
    lastName
  )}&idPackage=${encodeURIComponent(idPackage)}`;
  const routerStateTree = JSON.stringify([
    "",
    { children: ["__PAGE__", {}, `/?tracking/lastName=${lastName}&idPackage=${idPackage}`, "refresh"] },
    null,
    null,
    true,
  ]);

  try {
    const res = await fetch(pageUrl, {
      method: "POST",
      headers: {
        accept: "text/x-component",
        "content-type": "text/plain;charset=UTF-8",
        "next-action": MOOVIN_NEXT_ACTION,
        "next-router-state-tree": routerStateTree,
        origin: MOOVIN_BASE,
        referer: pageUrl,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ...(MOOVIN_COOKIE ? { cookie: MOOVIN_COOKIE } : {}),
      },
      body: JSON.stringify([idPackage, "", ""]),
      cache: "no-store",
    });

    const text = await res.text();
    const detail = parseMoovinResponse(text);
    if (!detail) {
      return {
        ...base,
        http_status: res.status,
        error: "No se pudo interpretar la respuesta de Moovin",
        ...(options.includeRaw ? { raw: text.slice(0, 20000) } : {}),
      };
    }

    const latest = detail.events[0] ?? null;
    const incident = computeIncident(detail.events);
    return {
      ...base,
      ok: res.ok,
      http_status: res.status,
      tracking_number: detail.tracking_number,
      profile: detail.profile,
      latest_status: latest?.title ?? null,
      latest_status_code: latest?.code ?? null,
      latest_group: latest?.group ?? null,
      latest_at: latest?.date ?? null,
      delivery_address: detail.delivery_address,
      has_incident: incident.active,
      incident_reason: incident.reason,
      events: detail.events,
      ...(options.includeRaw ? { raw: text.slice(0, 20000) } : {}),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "Error consultando Moovin" };
  }
}

// Incidencia activa = el evento mas reciente es FAILED. Si despues hubo una
// entrega o reintento, ya no cuenta como riesgo.
function computeIncident(events: MoovinEvent[]): { active: boolean; reason: string } {
  const latest = events[0];
  if (!latest || latest.group !== "failed") return { active: false, reason: "" };
  return { active: true, reason: latest.note || latest.description };
}

interface RawStatus {
  idStatus?: number;
  date?: string;
  status?: string;
  title?: string;
  description?: string;
  comments?: Array<{ value?: string; reason?: string }>;
}

interface RawPayload {
  serialNumber?: string;
  nameProfile?: string;
  listStatus?: RawStatus[];
  coorList?: Array<{ name?: string; address?: string }>;
}

interface MoovinDetail {
  tracking_number: string;
  profile: string;
  delivery_address: string;
  events: MoovinEvent[];
}

// Clasifica el grupo por codigo; si el codigo es desconocido, rescata las
// cancelaciones por titulo ("Cancelado") para que cuenten como no entregado.
function classifyMoovinGroup(code: string, title: string): MoovinGroup {
  const mapped = MOOVIN_STATUS_GROUP[code];
  if (mapped) return mapped;
  if (title.toLowerCase().includes("cancelado")) return "returned";
  return "in_progress";
}

function parseMoovinResponse(raw: string): MoovinDetail | null {
  const payload = findTrackingPayload(raw);
  if (!payload || !Array.isArray(payload.listStatus)) return null;

  const events: MoovinEvent[] = payload.listStatus
    .map((status) => {
      const code = String(status.status ?? "").toUpperCase();
      const note = (status.comments ?? [])
        .map((comment) => [comment.reason, comment.value].filter(Boolean).join(": "))
        .filter(Boolean)
        .join(" | ");
      return {
        code,
        group: classifyMoovinGroup(code, String(status.title ?? "")),
        title: String(status.title ?? ""),
        description: String(status.description ?? ""),
        date: status.date ?? null,
        note,
      };
    })
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));

  const delivery = (payload.coorList ?? []).find((point) =>
    String(point.name ?? "").toLowerCase().includes("entrega")
  );

  return {
    tracking_number: String(payload.serialNumber ?? ""),
    profile: String(payload.nameProfile ?? ""),
    delivery_address: String(delivery?.address ?? ""),
    events,
  };
}

function findTrackingPayload(raw: string): RawPayload | null {
  for (const line of raw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const jsonPart = line.slice(colon + 1).trim();
    if (!jsonPart.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(jsonPart) as RawPayload;
      if (parsed && Array.isArray(parsed.listStatus)) return parsed;
    } catch {
      // Linea no-JSON o truncada; se ignora.
    }
  }
  return null;
}
