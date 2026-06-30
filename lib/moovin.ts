// Cliente y parser del tracking de Moovin, compartido por el endpoint bajo
// demanda y el lote. La pagina publica de Moovin es Next.js: renderiza el
// tracking server-side a partir de los searchParams (?tracking/lastName&idPackage),
// asi que un GET normal ya trae los datos incrustados en el HTML. Esa es la via
// principal porque NO depende del id de Server Action, que cambia en cada
// redespliegue de Moovin y deja el lookup ciego. El POST con next-action queda
// como respaldo por compatibilidad (configurable por env).
const MOOVIN_BASE = "https://utilities.moovin.me";
const MOOVIN_NEXT_ACTION =
  process.env.MOOVIN_NEXT_ACTION || "7fae531bab4ee20b1f874b0fafcfa412a52a5a165f";
const MOOVIN_COOKIE = process.env.MOOVIN_COOKIE || "";
const MOOVIN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

// Espera entre reintentos con apellidos alternativos. Solo se aplica cuando
// Moovin respondio pero no se pudo interpretar (apellido equivocado), no en la
// via feliz, asi que casi nunca corre. Corto para no demorar el modal.
const MOOVIN_RETRY_DELAY_MS = 300;
// Tope de apellidos a probar por guia: protege el maxDuration de la ruta si
// Moovin contestara rapido pero ilegible en cada intento.
const MOOVIN_MAX_CANDIDATES = 5;

function moovinSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Apellidos candidatos para el lookup, en orden de prioridad. Moovin indexa por
// el apellido tal cual lo registro Boxful; Shopify a veces mete el nombre
// completo en last_name o parte mal los dos apellidos ticos, asi que cuando el
// valor principal no resuelve probamos variantes derivadas del nombre.
export function moovinLastNameCandidates(lastName: string, fullName?: string): string[] {
  const norm = (v: string) => v.trim().replace(/\s+/g, " ");
  const ln = norm(lastName ?? "");
  const fn = norm(fullName ?? "");
  const lastTokens = (s: string, n: number) => {
    const parts = s.split(" ");
    return parts.length > n ? parts.slice(-n).join(" ") : "";
  };

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const t = norm(value);
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  push(ln); // 1. Boxful Apellido / valor actual
  if (fn) push(lastTokens(fn, 2)); // 2. dos apellidos ticos del nombre completo (fix mas comun)
  push(lastTokens(ln, 2)); // 3. por si last_name trae el nombre completo
  push(lastTokens(ln, 1)); // 4. un solo apellido
  if (fn) push(lastTokens(fn, 1)); // 5. ultimo token del nombre completo
  if (fn) push(fn); // 6. ultimo recurso: nombre completo
  return out.slice(0, MOOVIN_MAX_CANDIDATES);
}

interface MoovinAttempt {
  tracking: MoovinTracking;
  // Se interpreto un payload con listStatus: es una respuesta util, no se sigue
  // probando apellidos.
  parsed: boolean;
  // Moovin no respondio (timeout/red): no insistir con mas candidatos, solo
  // multiplicaria la espera.
  networkError: boolean;
}

// Consulta Moovin probando los apellidos candidatos hasta que uno devuelva un
// tracking interpretable. Conserva en `last_name` el apellido que funciono para
// que la cache y la UI queden con el valor correcto.
export async function fetchMoovinTracking(
  idPackage: string,
  lastName: string,
  options: { includeRaw?: boolean; fullName?: string } = {}
): Promise<MoovinTracking> {
  const candidates = moovinLastNameCandidates(lastName, options.fullName);
  const attempts = candidates.length ? candidates : [lastName.trim()];

  let lastTracking: MoovinTracking | null = null;
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await moovinSleep(MOOVIN_RETRY_DELAY_MS);
    const attempt = await attemptMoovinFetch(idPackage, attempts[i], options);
    if (attempt.parsed) return attempt.tracking;
    lastTracking = attempt.tracking;
    if (attempt.networkError) break;
  }
  return lastTracking ?? attemptBase(idPackage, lastName);
}

function attemptBase(idPackage: string, lastName: string): MoovinTracking {
  return {
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
}

// GET a la pagina publica: Moovin renderiza el tracking server-side desde la URL,
// asi que el HTML ya trae el payload incrustado. No depende del next-action.
function moovinGet(pageUrl: string, signal: AbortSignal): Promise<Response> {
  return fetch(pageUrl, {
    method: "GET",
    signal,
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "es,es-419;q=0.9",
      "user-agent": MOOVIN_UA,
      ...(MOOVIN_COOKIE ? { cookie: MOOVIN_COOKIE } : {}),
    },
    cache: "no-store",
  });
}

// POST de Server Action (via legada). Solo sirve si MOOVIN_NEXT_ACTION coincide
// con el id desplegado en Moovin; queda como respaldo del GET.
function moovinPostAction(
  idPackage: string,
  lastName: string,
  pageUrl: string,
  signal: AbortSignal
): Promise<Response> {
  const routerStateTree = JSON.stringify([
    "",
    { children: ["__PAGE__", {}, `/?tracking/lastName=${lastName}&idPackage=${idPackage}`, "refresh"] },
    null,
    null,
    true,
  ]);
  return fetch(pageUrl, {
    method: "POST",
    signal,
    headers: {
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": MOOVIN_NEXT_ACTION,
      "next-router-state-tree": routerStateTree,
      origin: MOOVIN_BASE,
      referer: pageUrl,
      "user-agent": MOOVIN_UA,
      ...(MOOVIN_COOKIE ? { cookie: MOOVIN_COOKIE } : {}),
    },
    body: JSON.stringify([idPackage, "", ""]),
    cache: "no-store",
  });
}

async function attemptMoovinFetch(
  idPackage: string,
  lastName: string,
  options: { includeRaw?: boolean } = {}
): Promise<MoovinAttempt> {
  const base = attemptBase(idPackage, lastName);
  const pageUrl = `${MOOVIN_BASE}/?tracking/lastName=${encodeURIComponent(
    lastName
  )}&idPackage=${encodeURIComponent(idPackage)}`;

  // Orden de robustez: primero el GET (a prueba de redespliegues), luego el POST
  // legado. La primera estrategia que devuelva un payload interpretable gana.
  const strategies: Array<(signal: AbortSignal) => Promise<Response>> = [
    (signal) => moovinGet(pageUrl, signal),
    (signal) => moovinPostAction(idPackage, lastName, pageUrl, signal),
  ];

  let unparsed: MoovinAttempt | null = null;
  let networkErr: MoovinAttempt | null = null;

  for (const run of strategies) {
    // Corte duro por estrategia: Moovin scrapea su web publica y puede colgarse;
    // sin timeout el modal gira hasta que muere la funcion serverless (~30s).
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await run(controller.signal);
      const text = await res.text();
      const detail = parseMoovinResponse(text);
      if (!detail) {
        // Se conserva el PRIMER no-interpretable (el GET, via principal) para que
        // el modo debug (?raw=1) muestre la respuesta que deberia traer los datos.
        unparsed ??= {
          tracking: {
            ...base,
            http_status: res.status,
            error: "No se pudo interpretar la respuesta de Moovin",
            ...(options.includeRaw ? { raw: text.slice(0, 20000) } : {}),
          },
          parsed: false,
          networkError: false,
        };
        continue;
      }

      const latest = detail.events[0] ?? null;
      const incident = computeIncident(detail.events);
      return {
        tracking: {
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
        },
        parsed: true,
        networkError: false,
      };
    } catch (err) {
      const error =
        err instanceof Error && err.name === "AbortError"
          ? "Moovin no respondio a tiempo (timeout)."
          : err instanceof Error
            ? err.message
            : "Error consultando Moovin";
      networkErr = { tracking: { ...base, error }, parsed: false, networkError: true };
    } finally {
      clearTimeout(abortTimer);
    }
  }

  // Ninguna estrategia interpreto: preferimos reportar "no interpretable" (hubo
  // respuesta) sobre el error de red, y solo marcamos networkError si TODAS
  // fallaron por red (para que el reintento por apellidos no insista en vano).
  return unparsed ?? networkErr ?? { tracking: base, parsed: false, networkError: true };
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

// Exportado para tests: interpreta tanto la respuesta RSC del Server Action como
// el HTML del GET a la pagina.
export function parseMoovinResponse(raw: string): MoovinDetail | null {
  // Dos formatos posibles: (1) respuesta RSC / Server Action, con lineas
  // "<n>:{...}" directas; (2) HTML del GET a la pagina, con el stream RSC
  // incrustado en <script>self.__next_f.push([1,"..."])</script>. Reensamblar el
  // segundo produce el mismo formato del primero, asi que se reusa el parser.
  const payload = findTrackingPayload(raw) ?? findTrackingPayload(extractNextFlight(raw));
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
  if (!raw) return null;
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

// Reensambla el stream RSC que Next.js incrusta en el HTML como
// self.__next_f.push([1,"<chunk>"]). Cada chunk es un literal JSON string; al
// concatenarlos en orden se reconstruye el mismo flight con lineas "<n>:{...}"
// que devuelve el Server Action, asi findTrackingPayload lo procesa igual.
function extractNextFlight(html: string): string {
  if (!html.includes("self.__next_f")) return "";
  const chunks: string[] = [];
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(match[1]) as string);
    } catch {
      // Chunk truncado o no parseable; se ignora.
    }
  }
  return chunks.join("");
}
