// Adaptador de LECTURA de las conversaciones de WhatsApp de Icomfly.
// Consume el namespace interno /api/chat/* (descubierto en Fase 0):
//   GET /api/chat/conversations?limit&page   -> lista paginada
//   GET /api/chat/conversations/:id/messages -> transcript
//   GET /api/chat/labels                      -> catalogo de etiquetas
// Se autentica con el MISMO JWT que /auth/login (reutiliza getChatToken, igual
// flujo que lib/icomfly.ts). Multi-tienda via header X-Active-Store-Ids.
//
// Normalizacion tolerante: los CRM cambian de forma sin avisar, asi que todo
// pasa por pickString/pickNumber/pickBool defensivos.

import type { ConversationMessage, IcomflyConversation } from "./leads-types";

const BASE = process.env.ICOMFLY_BASE || "https://api.icomfly.com/api";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function loginForToken(): Promise<string> {
  const email = process.env.ICOMFLY_EMAIL;
  const password = process.env.ICOMFLY_PASSWORD;
  if (!email || !password) {
    throw new Error("iComfly no configurado: define ICOMFLY_EMAIL + ICOMFLY_PASSWORD (o ICOMFLY_TOKEN).");
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
  cachedToken = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

// Preferimos el login por credenciales (se auto-refresca y quedo verificado que
// su JWT funciona en /api/chat/*). ICOMFLY_TOKEN es solo un override explicito
// para cuando no hay credenciales. `forceFresh` ignora el cache y re-loguea:
// se usa ante un 401 para no quedar atrapados con un token vencido.
async function getChatToken(forceFresh = false): Promise<string> {
  const hasCreds = Boolean(process.env.ICOMFLY_EMAIL && process.env.ICOMFLY_PASSWORD);
  if (hasCreds) {
    if (!forceFresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
    return loginForToken();
  }
  if (process.env.ICOMFLY_TOKEN) return process.env.ICOMFLY_TOKEN;
  throw new Error("iComfly no configurado: define ICOMFLY_EMAIL + ICOMFLY_PASSWORD (o ICOMFLY_TOKEN).");
}

async function chatFetch(path: string, externalStoreId: number): Promise<unknown> {
  const token = await getChatToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Active-Store-Ids": String(externalStoreId),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${BASE}${path}`, { headers, cache: "no-store" });
  if (res.status === 401) {
    // Token vencido/invalido: forzar un login nuevo y reintentar una vez.
    cachedToken = null;
    const retryToken = await getChatToken(true);
    const retry = await fetch(`${BASE}${path}`, {
      headers: { ...headers, Authorization: `Bearer ${retryToken}` },
      cache: "no-store",
    });
    if (!retry.ok) {
      const detail = (await retry.text()).slice(0, 200);
      const hint = process.env.ICOMFLY_EMAIL
        ? ""
        : " (no hay ICOMFLY_EMAIL/ICOMFLY_PASSWORD en este entorno; revisa las env vars de Vercel para Preview y Production).";
      throw new Error(`iComfly chat ${retry.status}: ${detail}${hint}`);
    }
    return retry.json();
  }
  if (!res.ok) throw new Error(`iComfly chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ─── Helpers de normalizacion ────────────────────────────────────────────────
function pickString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v != null && v !== "") return String(v);
  }
  return "";
}
function pickNumber(o: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = o[k];
    if (v != null && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}
function pickBool(o: Record<string, unknown>, keys: string[]): boolean {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1 || v === "1") return true;
    if (v === "false" || v === 0 || v === "0") return false;
  }
  return false;
}
function pickStringOrNull(o: Record<string, unknown>, keys: string[]): string | null {
  const s = pickString(o, keys);
  return s === "" ? null : s;
}

function extractArray(body: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
  const b = (body ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(b[k])) return b[k] as Array<Record<string, unknown>>;
  }
  const nested = (b.data ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(nested[k])) return nested[k] as Array<Record<string, unknown>>;
  }
  return [];
}

function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l) => {
      if (typeof l === "string") return l;
      if (l && typeof l === "object") {
        const o = l as Record<string, unknown>;
        return pickString(o, ["name", "nombre", "label", "title", "text"]);
      }
      return "";
    })
    .filter(Boolean);
}

export function normalizeConversation(raw: Record<string, unknown>): IcomflyConversation {
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  return {
    id: pickString(raw, ["id", "_id", "conversation_id", "uuid"]),
    contactId: pickStringOrNull(raw, ["contact_id", "contactId", "customer_id"]),
    phone: pickStringOrNull(raw, ["phone_number", "phone", "telefono", "wa_id", "platform_user_id"]),
    displayName: pickString(raw, ["display_name", "whatsapp_display_name", "name", "contact_name", "username"]),
    platform: pickString(raw, ["platform", "channel"]) || "whatsapp",
    status: pickString(raw, ["status", "state", "estado"]),
    assignedTo: pickStringOrNull(raw, ["assigned_to", "assignedTo", "agent_id"]),
    lastMessageText: pickString(raw, ["last_message_text", "last_message", "lastMessage"]),
    lastMessageAt: pickStringOrNull(raw, ["last_message_at", "lastMessageAt", "updated_at"]),
    lastMessageSender: pickString(raw, ["last_message_sender", "lastMessageSender", "last_sender"]),
    unreadCount: pickNumber(raw, ["unread_count", "unreadCount", "unread"]),
    priority: pickString(raw, ["priority", "prioridad"]),
    chatbotDisabled: pickBool(raw, ["chatbot_disabled", "chatbotDisabled", "bot_disabled"]),
    abandonedCartId: pickStringOrNull(metadata, ["abandoned_cart_id"]) ?? pickStringOrNull(raw, ["abandoned_cart_id"]),
    abandonedCartCount: pickNumber(raw, ["abandoned_cart_count", "abandonedCartCount"]),
    recoveredCartCount: pickNumber(raw, ["recovered_cart_count", "recoveredCartCount"]),
    labels: normalizeLabels(raw.labels ?? raw.tags),
    closedAt: pickStringOrNull(raw, ["closed_at", "closedAt"]),
    closedReason: pickStringOrNull(raw, ["closed_reason", "closedReason"]),
    lastReopenAt: pickStringOrNull(raw, ["last_reopen_at", "lastReopenAt"]),
    createdAt: pickStringOrNull(raw, ["created_at", "createdAt"]),
    updatedAt: pickStringOrNull(raw, ["updated_at", "updatedAt"]),
    waPhoneNumberId: pickStringOrNull(raw, ["whatsapp_account_id", "wa_phone_number_id", "phone_number_id"]),
    storeCountry: pickString(raw, ["store_country", "country"]),
    raw,
  };
}

export interface ConversationsPage {
  conversations: IcomflyConversation[];
  page: number;
  hasMore: boolean;
  total: number | null;
}

/** Lista una pagina de conversaciones. */
export async function listConversations(opts: {
  externalStoreId: number;
  page?: number;
  limit?: number;
}): Promise<ConversationsPage> {
  const page = Math.max(opts.page ?? 1, 1);
  const limit = opts.limit ?? 50;
  const body = (await chatFetch(
    `/chat/conversations?limit=${limit}&page=${page}`,
    opts.externalStoreId
  )) as Record<string, unknown>;
  const raw = extractArray(body, ["conversations", "data", "items", "results"]);
  const conversations = raw.map(normalizeConversation).filter((c) => c.id);
  const pagination = (body?.pagination ?? {}) as Record<string, unknown>;
  const total =
    pickNumber(pagination, ["total", "count"]) ||
    pickNumber(body ?? {}, ["total", "count"]) ||
    null;
  const totalPages = pickNumber(pagination, ["total_pages", "totalPages", "pages"]);
  const hasMore = totalPages ? page < totalPages : raw.length >= limit;
  return { conversations, page, hasMore, total: total || null };
}

// ─── Transcript (drawer / enriquecimiento) ───────────────────────────────────
function msgDirection(raw: Record<string, unknown>): "inbound" | "outbound" {
  const sender = pickString(raw, ["sender_type", "direction", "from"]).toLowerCase();
  if (["contact", "customer", "client", "cliente", "inbound", "in"].includes(sender)) return "inbound";
  return "outbound";
}
function msgTimeMs(raw: Record<string, unknown>): number {
  const v = pickString(raw, ["created_at", "timestamp", "sent_at", "date"]);
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return t;
  const n = Number(v);
  if (!Number.isNaN(n)) return n < 1e12 ? n * 1000 : n;
  return 0;
}
function msgMediaKind(raw: Record<string, unknown>): ConversationMessage["mediaKind"] {
  const t = pickString(raw, ["media_type", "message_type", "type"]).toLowerCase();
  if (t.includes("image") || t.includes("imagen")) return "image";
  if (t.includes("audio") || t.includes("voice")) return "audio";
  if (t.includes("video")) return "video";
  if (t.includes("document") || t.includes("doc") || t.includes("file")) return "document";
  if (t.includes("sticker")) return "sticker";
  return undefined;
}

export function normalizeMessage(raw: Record<string, unknown>): ConversationMessage {
  const mediaUrl = pickStringOrNull(raw, ["media_url", "mediaUrl", "attachment_url"]);
  return {
    id: pickString(raw, ["id", "_id", "external_message_id", "message_id"]),
    direction: msgDirection(raw),
    timestamp: msgTimeMs(raw),
    text: pickString(raw, ["content", "text", "body", "message"]) || undefined,
    mediaKind: mediaUrl ? msgMediaKind(raw) : undefined,
    mediaUrl: mediaUrl ?? undefined,
    caption: pickString(raw, ["caption"]) || undefined,
    template: pickStringOrNull(
      (raw.metadata ?? {}) as Record<string, unknown>,
      ["templateName", "template_name"]
    ) ?? undefined,
  };
}

export async function fetchConversationTranscript(
  conversationId: string,
  externalStoreId: number
): Promise<ConversationMessage[]> {
  const body = await chatFetch(
    `/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    externalStoreId
  );
  const raw = extractArray(body, ["messages", "data", "items", "posts"]);
  return raw.map(normalizeMessage).filter((m) => m.id).sort((a, b) => a.timestamp - b.timestamp);
}

export interface IcomflyLabel {
  id: string;
  name: string;
  color: string;
  usageCount: number;
}

export async function listChatLabels(externalStoreId: number): Promise<IcomflyLabel[]> {
  const body = await chatFetch(`/chat/labels`, externalStoreId);
  const raw = extractArray(body, ["labels", "data", "items"]);
  return raw.map((l) => ({
    id: pickString(l, ["id", "_id"]),
    name: pickString(l, ["name", "nombre", "label"]),
    color: pickString(l, ["color"]),
    usageCount: pickNumber(l, ["usage_count", "usageCount"]),
  }));
}
