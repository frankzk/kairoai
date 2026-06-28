// Cliente READ-ONLY de la API de iComfly. Obtiene pedidos con atribucion y el
// catalogo de agentes. Multi-tienda: cada llamada recibe storeId.
//
// Autenticacion: si ICOMFLY_TOKEN esta definido se usa directo; si no, se hace
// login con ICOMFLY_EMAIL/ICOMFLY_PASSWORD (POST /auth/login) y se cachea el
// token en memoria. (Mismo flujo que scripts/icomfly-probe.mjs.)

import type { AttributionActor, NormalizedIcomflyOrder } from "./dispatch";
import {
  DEFAULT_FINANCE_STORE_CODE,
  DEFAULT_FINANCE_STORE_ID,
  FINANCE_STORES,
  getFinanceStore,
  getFinanceStoreById,
  type FinanceStoreCode,
  type FinanceStorePublic,
} from "./store-config";

const BASE = process.env.ICOMFLY_BASE || "https://api.icomfly.com/api";

let cachedToken: { token: string; expiresAt: number } | null = null;

const ICOMFLY_STORE_ENV_BY_CODE: Record<FinanceStoreCode, string[]> = {
  "mireva-cr": ["ICOMFLY_CR_STORE_ID", "ICOMFLY_STORE_ID"],
  "mireva-hn": ["ICOMFLY_HN_STORE_ID"],
};

export function defaultStoreId(): number {
  const raw = process.env.ICOMFLY_STORE_ID;
  return raw && !Number.isNaN(Number(raw)) ? Number(raw) : 71;
}

export interface IcomflyStoreContext {
  store: FinanceStorePublic;
  externalStoreId: number;
}

export function getIcomflyExternalStoreId(storeCode: FinanceStoreCode): number | null {
  const envNames = ICOMFLY_STORE_ENV_BY_CODE[storeCode] ?? [];
  for (const envName of envNames) {
    const raw = process.env[envName];
    if (raw != null && raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  }
  if (storeCode === DEFAULT_FINANCE_STORE_CODE) return defaultStoreId();
  return null;
}

export function resolveIcomflyStoreContext(opts: {
  store?: string | null;
  storeId?: number | null;
  externalStoreId?: number | null;
} = {}): IcomflyStoreContext {
  let store: FinanceStorePublic;
  if (opts.storeId != null) {
    const internalStore = getFinanceStoreById(opts.storeId);
    const externalStore = FINANCE_STORES.find(
      (candidate) => getIcomflyExternalStoreId(candidate.code) === opts.storeId
    );
    const resolvedStore = internalStore ?? externalStore;
    if (!resolvedStore) {
      throw new Error(`Tienda iComfly no reconocida para store_id=${opts.storeId}. Envia store=mireva-cr o store=mireva-hn.`);
    }
    store = resolvedStore;
  } else {
    store = getFinanceStore(opts.store ?? DEFAULT_FINANCE_STORE_CODE);
  }
  const externalStoreId = opts.externalStoreId ?? getIcomflyExternalStoreId(store.code);
  if (externalStoreId == null) {
    const expectedEnv = ICOMFLY_STORE_ENV_BY_CODE[store.code]?.[0] ?? "ICOMFLY_STORE_ID";
    throw new Error(`iComfly no configurado para ${store.label}: define ${expectedEnv}.`);
  }
  return { store, externalStoreId };
}

export function listConfiguredIcomflyStoreContexts(): IcomflyStoreContext[] {
  return FINANCE_STORES.flatMap((store) => {
    const externalStoreId = getIcomflyExternalStoreId(store.code);
    return externalStoreId == null ? [] : [{ store, externalStoreId }];
  });
}

async function getToken(): Promise<string> {
  if (process.env.ICOMFLY_TOKEN) return process.env.ICOMFLY_TOKEN;
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const email = process.env.ICOMFLY_EMAIL;
  const password = process.env.ICOMFLY_PASSWORD;
  if (!email || !password) {
    throw new Error("iComfly no configurado: define ICOMFLY_TOKEN o ICOMFLY_EMAIL + ICOMFLY_PASSWORD.");
  }
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`iComfly login error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (body.data as Record<string, unknown>) ?? {};
  const token =
    (body.token as string) ||
    (body.accessToken as string) ||
    (body.access_token as string) ||
    (body.jwt as string) ||
    (data.token as string) ||
    (data.accessToken as string);
  if (!token) throw new Error("iComfly login: no se encontro token en la respuesta.");
  // Cache conservador (50 min); el token real suele durar mas.
  cachedToken = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

async function icomflyFetch(path: string): Promise<unknown> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) {
    // Token expirado: invalida cache y reintenta una vez.
    cachedToken = null;
    const retryToken = await getToken();
    const retry = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${retryToken}` },
      cache: "no-store",
    });
    if (!retry.ok) throw new Error(`iComfly API error ${retry.status}: ${(await retry.text()).slice(0, 200)}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`iComfly API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Extrae el array de pedidos sin importar la forma de la respuesta.
function extractArray(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  const b = (body ?? {}) as Record<string, unknown>;
  const arr = b.data ?? b.orders ?? b.results ?? b.items;
  return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
}

export interface IcomflyOrdersPage {
  orders: NormalizedIcomflyOrder[];
  raw: Array<Record<string, unknown>>;
  hasMore: boolean;
}

export async function listOrdersWithAttribution(opts: {
  storeId?: number;
  externalStoreId?: number;
  page?: number;
  limit?: number;
}): Promise<IcomflyOrdersPage> {
  const storeId = opts.storeId ?? DEFAULT_FINANCE_STORE_ID;
  const externalStoreId = opts.externalStoreId ?? defaultStoreId();
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 100;
  const params = new URLSearchParams({
    store_id: String(externalStoreId),
    withAttribution: "1",
    page: String(page),
    limit: String(limit),
  });
  const body = await icomflyFetch(`/orders?${params.toString()}`);
  const raw = extractArray(body);
  const orders = raw.map((r) => normalizeIcomflyOrder(r, storeId));
  // Si vino una pagina llena, asumimos que puede haber mas.
  const hasMore = raw.length >= limit;
  return { orders, raw, hasMore };
}

export interface IcomflyAgent {
  userId: number;
  name: string;
  email: string;
  metrics: Record<string, unknown>;
}

export async function listAgents(opts: {
  storeId?: number;
  externalStoreId?: number;
  from?: string;
  to?: string;
}): Promise<IcomflyAgent[]> {
  const externalStoreId = opts.externalStoreId ?? defaultStoreId();
  const params = new URLSearchParams({ store_id: String(externalStoreId) });
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const body = await icomflyFetch(`/metrics/agents?${params.toString()}`);
  const raw = extractArray(body);
  return raw
    .map((r) => {
      const userId = pickNumber(r, ["user_id", "userId", "id", "agent_id"]);
      return {
        userId: userId ?? 0,
        name: pickString(r, ["name", "nombre", "full_name", "user_name"]),
        email: pickString(r, ["email", "correo", "mail"]),
        metrics: r,
      };
    })
    .filter((a) => a.userId > 0);
}

// ─── Normalizacion tolerante de un pedido de iComfly ─────────────────────────

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return String(v);
  }
  return "";
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function pickRaw(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return null;
}

function parseActor(raw: unknown): AttributionActor | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const name = pickString(o, ["name", "nombre", "full_name", "user_name", "usuario"]);
  const email = pickString(o, ["email", "correo", "mail"]);
  const userId = pickNumber(o, ["user_id", "userId", "id", "agent_id"]);
  const at = pickString(o, ["at", "date", "fecha", "created_at", "createdAt", "timestamp"]) || null;
  if (!name && !email && userId == null) return undefined;
  return { userId, name, email, at };
}

export function normalizeIcomflyOrder(
  raw: Record<string, unknown>,
  storeId: number
): NormalizedIcomflyOrder {
  const attrRaw = (pickRaw(raw, ["atribucion", "attribution"]) ?? {}) as Record<string, unknown>;
  const attribution: NormalizedIcomflyOrder["attribution"] = {};
  for (const key of ["creo", "confirmo", "genero_guia", "envio", "cancelo"] as const) {
    const actor = parseActor(attrRaw[key]);
    if (actor) attribution[key] = actor;
  }

  return {
    storeId,
    icomflyOrderId: pickString(raw, ["id", "_id", "orderId", "uuid", "order_id"]),
    orderNumber: pickString(raw, ["order_number", "numero", "number", "code", "codigo", "reference"]),
    shopifyDisplayNumber: pickString(raw, ["shopify_display_number", "shopify_order_name", "shopify_name", "store_order_number", "external_number"]),
    status: pickString(raw, ["status", "estado", "order_status", "state"]),
    carrierName: pickString(raw, ["carrier", "courier", "transportadora", "carrier_name", "shipping_carrier"]),
    trackingNumber: pickString(raw, ["tracking_number", "tracking", "guia", "guide", "waybill", "guide_number"]),
    shippedAt: pickString(raw, ["shipped_at", "fecha_envio", "sent_at", "dispatched_at"]) || null,
    createdAt: pickString(raw, ["created_at", "createdAt", "fecha", "fecha_creacion", "date"]) || null,
    attribution,
  };
}
