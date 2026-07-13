// Cliente y parser del tracking de Moovin, compartido por el endpoint bajo
// demanda y el lote. La pagina publica de Moovin es Next.js y hace bailout a
// client-side rendering: el HTML solo trae "Cargando..." y los datos los pide el
// navegador con un POST de Server Action (body [idPackage,"",""], el apellido va
// solo en la URL). Por eso replicamos ese POST con el header next-action.
//
// El id de la accion cambia en CADA redespliegue de Moovin y entonces Next.js no
// ejecuta la accion -> respuesta sin listStatus -> "No se pudo interpretar". Para
// que el lookup se auto-repare sin tocar env vars, si el id conocido falla se
// descubre el id vigente leyendo los chunks JS del bundle (ver discoverActionIds)
// y se cachea el que funciona. MOOVIN_NEXT_ACTION es solo la semilla por defecto.
const MOOVIN_BASE = "https://utilities.moovin.me";
const MOOVIN_NEXT_ACTION =
  process.env.MOOVIN_NEXT_ACTION || "7f6d3afc07259da244f5fca31a6a6122df262750a5";
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

// El id de Server Action vigente cambia en cada redespliegue de Moovin. Se cachea
// el ultimo que devolvio datos (cachedGoodActionId) para usarlo de primero; si
// deja de servir, se redescubre del bundle. discoveredIds cachea el resultado del
// scrape unos segundos para no rebajar el bundle por cada guia de un lote.
let cachedGoodActionId: string | null = null;
let discoveredIds: string[] = [];
let discoveredAt = 0;
const DISCOVERY_TTL_MS = 60_000;

function moovinPostAction(
  idPackage: string,
  lastName: string,
  pageUrl: string,
  actionId: string,
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
      "next-action": actionId,
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

// Un POST con un id de accion concreto, ya interpretado a MoovinAttempt.
async function postMoovinAction(
  idPackage: string,
  lastName: string,
  pageUrl: string,
  actionId: string,
  base: MoovinTracking,
  options: { includeRaw?: boolean }
): Promise<MoovinAttempt> {
  // Corte duro: Moovin scrapea su web publica y puede colgarse; sin timeout el
  // modal gira hasta que muere la funcion serverless (~30s).
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await moovinPostAction(idPackage, lastName, pageUrl, actionId, controller.signal);
    const text = await res.text();
    const detail = parseMoovinResponse(text);
    if (!detail) {
      return {
        tracking: {
          ...base,
          http_status: res.status,
          error: "No se pudo interpretar la respuesta de Moovin",
          ...(options.includeRaw ? { raw: text.slice(0, 20000) } : {}),
        },
        parsed: false,
        networkError: false,
      };
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
    return { tracking: { ...base, error }, parsed: false, networkError: true };
  } finally {
    clearTimeout(abortTimer);
  }
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

  // Ids a probar, en orden: el ultimo que funciono y el configurado/por defecto.
  // Si todos fallan en interpretar, se descubre el id vigente del bundle.
  const ids: string[] = [];
  const addId = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  addId(cachedGoodActionId);
  addId(MOOVIN_NEXT_ACTION);

  let unparsed: MoovinAttempt | null = null;
  let networkErr: MoovinAttempt | null = null;
  let discovered = false;

  for (let i = 0; i < ids.length; i++) {
    const result = await postMoovinAction(idPackage, lastName, pageUrl, ids[i], base, options);
    if (result.parsed) {
      cachedGoodActionId = ids[i];
      return result;
    }
    if (result.networkError) networkErr = result;
    else unparsed ??= result; // se conserva el primer "no interpretable" para ?raw=1

    // Agotados los ids conocidos sin exito: descubrir el id vigente y seguir.
    if (i === ids.length - 1 && !discovered) {
      discovered = true;
      for (const id of await getDiscoveredActionIds()) addId(id);
    }
  }

  // Se prefiere reportar "no interpretable" (hubo respuesta) sobre el error de
  // red, y solo se marca networkError si NINGUN intento obtuvo respuesta (para
  // que el reintento por apellidos no insista en vano).
  return unparsed ?? networkErr ?? { tracking: base, parsed: false, networkError: true };
}

// Ids de Server Action descubiertos del bundle, con cache corta para no rebajar
// los chunks por cada guia de un lote tras un redespliegue.
async function getDiscoveredActionIds(): Promise<string[]> {
  const now = Date.now();
  if (discoveredIds.length && now - discoveredAt < DISCOVERY_TTL_MS) return discoveredIds;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 12000);
  try {
    const ids = await discoverActionIds(controller.signal);
    if (ids.length) {
      discoveredIds = ids;
      discoveredAt = now;
    }
    return ids;
  } catch {
    return discoveredIds;
  } finally {
    clearTimeout(abortTimer);
  }
}

// Descubre los ids de Server Action vigentes leyendo los chunks JS del App Router
// de Moovin: baja la pagina, ordena los chunks por probabilidad de contener la
// accion y los escanea hasta el primer hallazgo. Asi el lookup se auto-repara
// cuando Moovin redespliega, sin actualizar la env var a mano.
async function discoverActionIds(signal: AbortSignal): Promise<string[]> {
  const pageRes = await fetch(`${MOOVIN_BASE}/`, {
    method: "GET",
    signal,
    headers: {
      accept: "text/html",
      "user-agent": MOOVIN_UA,
      ...(MOOVIN_COOKIE ? { cookie: MOOVIN_COOKIE } : {}),
    },
    cache: "no-store",
  });
  const html = await pageRes.text();
  const chunks = Array.from(
    new Set(
      Array.from(html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9._/-]+?\.js(?:\?[^"']*)?/g)).map(
        (m) => m[0]
      )
    )
  ).sort((a, b) => actionChunkScore(b) - actionChunkScore(a));

  const ids = new Set<string>();
  for (const path of chunks.slice(0, 8)) {
    try {
      const url = path.startsWith("http") ? path : `${MOOVIN_BASE}${path}`;
      const res = await fetch(url, { signal, headers: { "user-agent": MOOVIN_UA }, cache: "no-store" });
      const js = await res.text();
      for (const id of extractActionIds(js)) ids.add(id);
      if (ids.size) break;
    } catch {
      // Chunk inaccesible; se sigue con el resto.
    }
  }
  return Array.from(ids);
}

// Heuristica de prioridad: el page chunk y los vendor numerados (p.ej. 684-*)
// referencian la accion; webpack/polyfills/main-app casi nunca.
function actionChunkScore(path: string): number {
  if (path.includes("/app/page-")) return 3;
  if (/\/chunks\/\d+-/.test(path)) return 2;
  if (path.includes("webpack") || path.includes("polyfills") || path.includes("main-app")) return 0;
  return 1;
}

// Extrae ids de Server Action de un bundle JS. Next.js los pasa como literal a
// createServerReference("<id>", ...); el id es hex (~42 chars). Exportado para
// tests.
export function extractActionIds(js: string): string[] {
  const ids = new Set<string>();
  for (const m of Array.from(js.matchAll(/createServerReference\)?\(\s*"([0-9a-f]{30,50})"/g))) {
    ids.add(m[1]);
  }
  // Respaldo por si la minificacion oculta el nombre: literales hex del tamano
  // tipico del id de accion.
  if (!ids.size) {
    for (const m of Array.from(js.matchAll(/"([0-9a-f]{40,44})"/g))) ids.add(m[1]);
  }
  return Array.from(ids);
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

// Exportado para tests. La respuesta del Server Action es un stream RSC con
// lineas "<n>:{...}"; el tracking viene en la linea cuyo objeto trae listStatus.
export function parseMoovinResponse(raw: string): MoovinDetail | null {
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
