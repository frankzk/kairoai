export type CourierProviderCode = "moovin" | "forza" | "wyn" | "boxful" | (string & {});
export type CourierFileType = "logistica" | "liquidacion";
export type CourierNormalizedStatus =
  | "delivered"
  | "not_delivered"
  | "returned"
  | "en_route"
  | "incident"
  | "cancelled"
  | "pending"
  | "unknown";

export interface CourierTrackingEvent {
  code: string;
  group: CourierNormalizedStatus | string;
  title: string;
  description: string;
  date: string | null;
  note: string;
  raw?: Record<string, unknown>;
}

export interface CourierTrackingResult {
  provider: CourierProviderCode;
  storeId: number;
  guideNumber: string;
  latestStatus: string;
  latestCode: string;
  latestGroup: CourierNormalizedStatus;
  latestAt: string | null;
  hasIncident: boolean;
  incidentReason: string;
  events: CourierTrackingEvent[];
  raw?: Record<string, unknown>;
}

export interface CourierFileParseResult<Row> {
  provider: CourierProviderCode;
  fileType: CourierFileType;
  rows: Row[];
  warnings: string[];
}

export interface CourierAdapter<Row = Record<string, unknown>> {
  provider: CourierProviderCode;
  label: string;
  supportsApiTracking: boolean;
  supportsFileImport: boolean;
  normalizeGuide(guide: string): string;
  normalizeStatus(rawStatus: string, rawGroup?: string): CourierNormalizedStatus;
  trackingUrl?(guide: string): string;
  parseFile?(input: ArrayBuffer, fileType: CourierFileType): Promise<CourierFileParseResult<Row>>;
  fetchTracking?(input: {
    storeId: number;
    guideNumber: string;
    lastName?: string;
  }): Promise<CourierTrackingResult>;
}

export const COURIER_STATUS_ALIASES: Record<CourierNormalizedStatus, string[]> = {
  delivered: ["entregado", "delivered", "delivered_to_customer"],
  not_delivered: ["no entregado", "not delivered", "failed_delivery"],
  returned: ["devuelto", "devolucion", "devolución", "returned", "rts"],
  en_route: ["en ruta", "ruta", "transito", "tránsito", "recolectado", "registrado", "in_transit"],
  incident: ["incidencia", "failed", "problema", "direccion incorrecta", "dirección incorrecta"],
  cancelled: ["cancelado", "cancelada", "cancelled", "guia cancelada"],
  pending: ["pendiente", "pending", "created"],
  unknown: [],
};

/**
 * Busca palabras clave de estado exigiendo que la aguja arranque donde arranca
 * una palabra.
 *
 * Con includes() a secas la busqueda cruza el limite entre palabras: "Transito
 * a destino Entregado a Distribuidor" —un hito normal de WYN— contiene "no
 * entregado" dentro de "destiNO ENTREGADO", asi que TODO paquete en transito se
 * leia como no entregado. Las agujas siguen siendo prefijos ("incid" cubre
 * "incidencia"), solo se ancla el inicio.
 *
 * No se usa \b: los acentos no son \w, asi que \b abriria limites falsos dentro
 * de "transito" o "recepcion" una vez normalizado el texto.
 */
export function matchesStatusKeyword(value: string, needles: string[]): boolean {
  const text = normalizeText(value);
  return needles.some((needle) => startsAtWordBoundary(text, normalizeText(needle)));
}

function startsAtWordBoundary(text: string, needle: string): boolean {
  if (!needle) return false;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    if (at === 0 || !/[a-z0-9]/.test(text[at - 1])) return true;
  }
  return false;
}

export function normalizeCourierStatus(rawStatus: string, rawGroup = ""): CourierNormalizedStatus {
  const text = `${rawGroup} ${rawStatus}`;
  for (const status of [
    "not_delivered",
    "returned",
    "incident",
    "cancelled",
    "delivered",
    "en_route",
    "pending",
  ] as const) {
    if (matchesStatusKeyword(text, COURIER_STATUS_ALIASES[status])) return status;
  }
  return "unknown";
}

export function normalizeGuideDefault(guide: string): string {
  return guide.trim().toUpperCase();
}

export function normalizeForzaGuideGeneric(guide: string): string {
  const trimmed = normalizeGuideDefault(guide);
  if (!trimmed) return "";
  return trimmed.startsWith("FD") ? trimmed : `FD${trimmed}`;
}

export const BUILT_IN_COURIER_ADAPTERS: CourierAdapter[] = [
  {
    provider: "moovin",
    label: "Moovin",
    supportsApiTracking: true,
    supportsFileImport: false,
    normalizeGuide: normalizeGuideDefault,
    normalizeStatus: normalizeCourierStatus,
    trackingUrl: (guide) => `https://moovin.me/tracking/${encodeURIComponent(normalizeGuideDefault(guide))}`,
  },
  {
    provider: "forza",
    label: "Forza",
    supportsApiTracking: true,
    supportsFileImport: false,
    normalizeGuide: normalizeForzaGuideGeneric,
    normalizeStatus: normalizeCourierStatus,
    trackingUrl: (guide) =>
      `https://rastreo.forzadelivery.com/${encodeURIComponent(normalizeForzaGuideGeneric(guide))}`,
  },
  {
    provider: "wyn",
    label: "WYN",
    supportsApiTracking: true,
    supportsFileImport: false,
    normalizeGuide: normalizeGuideDefault,
    normalizeStatus: normalizeCourierStatus,
    trackingUrl: (guide) =>
      `https://wynexpress.com/tracking?number_id=${encodeURIComponent(normalizeGuideDefault(guide))}`,
  },
  {
    provider: "boxful",
    label: "Boxful",
    supportsApiTracking: false,
    supportsFileImport: true,
    normalizeGuide: normalizeGuideDefault,
    normalizeStatus: normalizeCourierStatus,
  },
];

export function getBuiltInCourierAdapter(provider: string): CourierAdapter | null {
  const normalized = provider.trim().toLowerCase();
  return BUILT_IN_COURIER_ADAPTERS.find((adapter) => adapter.provider === normalized) ?? null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
