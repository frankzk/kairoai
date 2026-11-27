// Anuncios de WhatsApp de los pedidos de iComfly (27/11/2026): el cron que
// llena `icomfly_whatsapp_ad_origins` y las lecturas de Marketing.
// Solo servidor. Las reglas puras están en lib/icomfly-whatsapp-ad.ts.
//
// EL CRON (`icomfly-whatsapp-ads`, cada 10 min: :01/:11/:21/:31/:41/:51), por tienda:
//   1. Recorre los pedidos de los últimos 45 días, del más nuevo al más viejo
//      (icomfly_orders con su índice (store_id, icomfly_created_at)), y deja
//      los que tocan: nunca revisados; con error (hasta 3 intentos); o sin
//      anuncio / descartados una sola vez más, a los 2 días (el chat se puede
//      vincular después). Los de menos de 15 minutos esperan a la próxima.
//   2. De esos lee solo unas rutas del pedido (por clave primaria, de a 100)
//      y descarta los que no pueden venir de un chat (Shopify y web con UTM):
//      quedan guardados `skipped` para no leerlos otra vez.
//   3. Pregunta a iComfly por los demás: ≤ 60 por tienda, de a 4, 8 s cada
//      uno. Guarda también los que no traen anuncio (has_ad = false).
//   4. Lee en Meta la campaña de hasta 20 anuncios nuevos por tienda (cuenta
//      de la tienda, token solo en la cabecera). Un anuncio ya leído en otro
//      pedido no se vuelve a pedir.
// Reanuda solo: lo revisado queda en la tabla y la corrida siguiente sigue
// con lo que falta. Nunca lanza: los errores se cuentan en el resumen, sin
// el texto del proveedor ni datos del pedido.
import { getDB } from "./db";
import { getIcomflyWhatsappAdOrigin } from "./icomfly";
import {
  dueForCheck,
  isWhatsappCandidate,
  parseWhatsappAdOrigin,
  whatsappAdCheckOf,
  WHATSAPP_AD_COLUMNS,
  type ParsedWhatsappAd,
  type StoredCheckState,
  type WhatsappAdCheck,
  type WhatsappCandidateSignals,
} from "./icomfly-whatsapp-ad";
import {
  metaAuthHeaders,
  metaConfigAccountIds,
  metaConfigFor,
  metaVersionValid,
} from "./marketing-meta-config";
import { isMarketingStore } from "./marketing-stores";
import type { FinanceStoreCode } from "./store-config";

export const TABLE = "icomfly_whatsapp_ad_origins";

/** Límites de una corrida, por tienda. */
export const WHATSAPP_AD_LIMITS = {
  /** Consultas a iComfly por tienda y corrida. */
  requests: 60,
  concurrency: 4,
  timeoutMs: 8000,
  lookbackDays: 45,
  /** Un pedido recién creado espera: iComfly puede vincular el chat unos minutos después. */
  minAgeMs: 15 * 60_000,
  /** Pedidos leídos de icomfly_orders por página. */
  page: 500,
  /** Pedidos cuyo detalle se lee por corrida (para clasificarlos). */
  maxClassified: 600,
  /** Anuncios cuya campaña se lee en Meta por corrida. */
  metaAds: 20,
};

type Db = ReturnType<typeof getDB>;
type Row = Record<string, unknown>;

const isMissingRelation = (error: { code?: string; message?: string } | null | undefined) =>
  ["42P01", "PGRST205"].includes(String(error?.code)) ||
  /relation .* does not exist|schema cache/i.test(String(error?.message ?? ""));

const chunks = <T,>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// ─── Lecturas de Marketing ───────────────────────────────────────────────────

/**
 * Checks of the orders created in [from, to) (dates or ISO). One indexed query
 * by store and creation range (pages of 1000). Fail-soft: without the table
 * (migration pending) or on an error, an empty map — the bot orders show as
 * "sin revisar", nothing else changes.
 */
export async function readWhatsappAdChecksByRange(
  storeId: number,
  from: string,
  to: string,
): Promise<Map<string, WhatsappAdCheck>> {
  const out = new Map<string, WhatsappAdCheck>();
  try {
    for (let start = 0; start < 20_000; start += 1000) {
      const { data, error } = await getDB()
        .from(TABLE)
        .select(WHATSAPP_AD_COLUMNS)
        .eq("store_id", storeId)
        .gte("order_created_at", from)
        .lt("order_created_at", to)
        .order("icomfly_order_id")
        .range(start, start + 999);
      if (error || !data) return out;
      for (const row of data as unknown as Row[]) {
        const check = whatsappAdCheckOf(row);
        if (check) out.set(String(row.icomfly_order_id), check);
      }
      if (data.length < 1000) break;
    }
  } catch {
    // Sin la tabla: todo queda "sin revisar".
  }
  return out;
}

/** Checks of some orders by primary key (chunks of 100). Fail-soft like the range read. */
export async function readWhatsappAdChecksByIds(
  storeId: number,
  ids: string[],
): Promise<Map<string, WhatsappAdCheck>> {
  const out = new Map<string, WhatsappAdCheck>();
  const unique = Array.from(new Set(ids.filter((id) => /^[1-9]\d*$/.test(id))));
  try {
    for (const part of chunks(unique, 100)) {
      const { data, error } = await getDB()
        .from(TABLE)
        .select(WHATSAPP_AD_COLUMNS)
        .eq("store_id", storeId)
        .in("icomfly_order_id", part);
      if (error || !data) return out;
      for (const row of data as unknown as Row[]) {
        const check = whatsappAdCheckOf(row);
        if (check) out.set(String(row.icomfly_order_id), check);
      }
    }
  } catch {
    // idem
  }
  return out;
}

// ─── El cron ─────────────────────────────────────────────────────────────────

export interface WhatsappAdRunSummary {
  store: string;
  /** Consultas hechas a iComfly. */
  consultados: number;
  conAnuncio: number;
  sinAnuncio: number;
  /** Respuestas con error o con forma desconocida (se reintentan). */
  errores: number;
  /** Pedidos que no pueden venir de un chat (no se consultó iComfly). */
  descartados: number;
  /** Quedaron pedidos por revisar (tope de la corrida o del tiempo). */
  quedan: boolean;
  meta:
    | { resueltos: number; noEncontrados: number; errores: number; reusados: number }
    | "sin_configurar";
  /** Migración pendiente: la tabla no existe. */
  pendiente?: string;
  error?: string;
}

export interface WhatsappAdDeps {
  db?: () => Db;
  fetchOrigin?: (
    store: FinanceStoreCode,
    id: string,
    timeoutMs: number,
  ) => Promise<{ status: number; body: unknown }>;
  fetcher?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => number;
  limits?: Partial<typeof WHATSAPP_AD_LIMITS>;
}

interface Candidate {
  id: string;
  createdAt: string | null;
  prev: StoredCheckState | null;
}

class MissingTable extends Error {}

function fail(error: { code?: string; message?: string } | null, what: string): never {
  if (isMissingRelation(error)) throw new MissingTable();
  throw new Error(`No se pudo ${what}.`);
}

const SIGNAL_COLUMNS =
  "icomfly_order_id,order_number:payload->>order_number,shopify_display_number:payload->>shopify_display_number,sales_channel:payload->>sales_channel,labels:payload->labels,creator:payload->atribucion->creo->>nombre,ad_origin:payload->ad_origin";

/** Runs `work` over `items` with at most `n` at a time, stopping new ones after `deadline`. */
async function pool<T>(
  items: T[],
  n: number,
  deadline: number,
  now: () => number,
  work: (item: T) => Promise<void>,
): Promise<number> {
  let next = 0,
    started = 0;
  const lanes = Array.from({ length: Math.max(1, n) }, async () => {
    while (next < items.length && now() < deadline) {
      const item = items[next++];
      started++;
      await work(item);
    }
  });
  await Promise.all(lanes);
  return started;
}

/**
 * Picks the orders to ask about (newest first) and stores the skipped ones.
 * Returns the candidates (≤ `limits.requests`) and whether more are left.
 */
async function selectCandidates(
  db: Db,
  storeId: number,
  nowMs: number,
  limits: typeof WHATSAPP_AD_LIMITS,
  summary: WhatsappAdRunSummary,
  deadline: number,
  now: () => number,
): Promise<{ candidates: Candidate[]; more: boolean }> {
  const since = new Date(nowMs - limits.lookbackDays * 86_400_000).toISOString();
  const until = new Date(nowMs - limits.minAgeMs).toISOString();
  const candidates: Candidate[] = [];
  let classified = 0,
    overflow = false;
  for (let page = 0; ; page++) {
    if (now() >= deadline) return { candidates, more: true };
    const { data, error } = await db
      .from("icomfly_orders")
      .select("icomfly_order_id,icomfly_created_at")
      .eq("store_id", storeId)
      .gte("icomfly_created_at", since)
      .lt("icomfly_created_at", until)
      .order("icomfly_created_at", { ascending: false })
      .range(page * limits.page, page * limits.page + limits.page - 1);
    if (error) fail(error, "leer los pedidos de iComfly");
    const orders = (data ?? []) as Row[];
    const ids = orders
      .map((o) => String(o.icomfly_order_id ?? ""))
      .filter((id) => /^[1-9]\d*$/.test(id));
    const created = new Map(orders.map((o) => [String(o.icomfly_order_id), (o.icomfly_created_at as string) ?? null]));

    const prev = new Map<string, StoredCheckState>();
    for (const part of chunks(ids, 200)) {
      const { data: rows, error: e } = await db
        .from(TABLE)
        .select("icomfly_order_id,has_ad,skipped,attempts,checked_at")
        .eq("store_id", storeId)
        .in("icomfly_order_id", part);
      if (e) fail(e, "leer los pedidos revisados");
      for (const r of (rows ?? []) as Row[])
        prev.set(String(r.icomfly_order_id), r as unknown as StoredCheckState);
    }
    const due = ids.filter((id) => dueForCheck(prev.get(id), nowMs));

    for (const part of chunks(due, 100)) {
      if (candidates.length >= limits.requests || classified >= limits.maxClassified)
        return { candidates, more: true };
      const { data: payloads, error: e } = await db
        .from("icomfly_order_payloads")
        .select(SIGNAL_COLUMNS)
        .eq("store_id", storeId)
        .in("icomfly_order_id", part);
      if (e) fail(e, "leer el detalle de los pedidos");
      const byId = new Map(
        ((payloads ?? []) as unknown as Array<WhatsappCandidateSignals & { icomfly_order_id: unknown }>).map(
          (p) => [String(p.icomfly_order_id), p],
        ),
      );
      const skipped: Row[] = [];
      for (const id of part) {
        const signals = byId.get(id);
        // Sin el detalle guardado todavía: se mira en otra corrida.
        if (!signals) continue;
        classified++;
        const before = prev.get(id) ?? null;
        if (isWhatsappCandidate(signals)) {
          if (candidates.length < limits.requests)
            candidates.push({ id, createdAt: created.get(id) ?? null, prev: before });
          else overflow = true;
          continue;
        }
        skipped.push({
          store_id: storeId,
          icomfly_order_id: id,
          order_created_at: created.get(id) ?? null,
          checked_at: new Date(nowMs).toISOString(),
          attempts: (Number(before?.attempts) || 0) + 1,
          skipped: true,
          has_ad: null,
        });
      }
      if (skipped.length) {
        const { error: w } = await db
          .from(TABLE)
          .upsert(skipped, { onConflict: "store_id,icomfly_order_id" });
        if (w) fail(w, "guardar los pedidos descartados");
        summary.descartados += skipped.length;
      }
    }
    if (orders.length < limits.page) return { candidates, more: overflow };
  }
}

function checkRow(
  storeId: number,
  c: Candidate,
  parsed: ParsedWhatsappAd | null,
  nowIso: string,
): Row {
  const base = {
    store_id: storeId,
    icomfly_order_id: c.id,
    order_created_at: c.createdAt,
    checked_at: nowIso,
    attempts: (Number(c.prev?.attempts) || 0) + 1,
    skipped: false,
  };
  if (!parsed)
    // Error: a previous "sin anuncio" stays (never downgraded to unknown).
    return {
      ...base,
      has_ad: c.prev?.has_ad === false ? false : null,
      ad_id: null,
      headline: null,
      source_url: null,
      has_click: null,
      received_at: null,
      via: null,
      tipo: null,
      raw: null,
    };
  return {
    ...base,
    has_ad: parsed.hasAd,
    ad_id: parsed.adId,
    headline: parsed.headline,
    source_url: parsed.sourceUrl,
    has_click: parsed.hasClick,
    received_at: parsed.receivedAt,
    via: parsed.via,
    tipo: parsed.tipo,
    raw: parsed.raw,
  };
}

const AD_ID = /^[1-9]\d{5,30}$/;
const metaText = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");

type MetaLookup =
  | {
      kind: "ok";
      accountId: string;
      campaignId: string | null;
      adsetId: string | null;
      adName: string;
      adsetName: string;
      campaignName: string;
    }
  | { kind: "not_found" }
  | { kind: "error" };

/** One ad in Meta with the store's token (header only). Only the store's own accounts count. */
async function lookupMetaAd(
  adId: string,
  version: string,
  token: string,
  accounts: Set<string>,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<MetaLookup> {
  const url = new URL(`https://graph.facebook.com/${version}/${adId}`);
  url.searchParams.set("fields", "account_id,campaign_id,adset_id,name,campaign{name},adset{name}");
  try {
    const res = await fetcher(url, {
      headers: metaAuthHeaders({ token }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as Row | null;
    if (!res.ok) {
      const code = Number((body?.error as Row | undefined)?.code);
      // 100 = no existe o el token no lo ve: no se vuelve a pedir.
      return (res.status === 400 || res.status === 404) && code === 100
        ? { kind: "not_found" }
        : { kind: "error" };
    }
    const account = metaText(body?.account_id).replace(/^act_/, "");
    if (!account || !accounts.has(account)) return { kind: "not_found" };
    const campaignId = metaText(body?.campaign_id);
    const adsetId = metaText(body?.adset_id);
    return {
      kind: "ok",
      accountId: account,
      campaignId: AD_ID.test(campaignId) ? campaignId : null,
      adsetId: AD_ID.test(adsetId) ? adsetId : null,
      adName: metaText(body?.name),
      adsetName: metaText((body?.adset as Row | undefined)?.name),
      campaignName: metaText((body?.campaign as Row | undefined)?.name),
    };
  } catch {
    return { kind: "error" };
  }
}

/** Fills the campaign of the ads whose campaign is still unknown. */
async function resolveMetaCampaigns(
  db: Db,
  storeId: number,
  store: FinanceStoreCode,
  deps: Required<Pick<WhatsappAdDeps, "fetcher" | "env" | "now">>,
  limits: typeof WHATSAPP_AD_LIMITS,
  deadline: number,
): Promise<WhatsappAdRunSummary["meta"]> {
  if (!isMarketingStore(store)) return "sin_configurar";
  const config = metaConfigFor(store, deps.env);
  let accounts: Set<string>;
  try {
    if (!config.configured || !metaVersionValid(config)) return "sin_configurar";
    accounts = new Set(metaConfigAccountIds(config));
  } catch {
    return "sin_configurar";
  }
  const result = { resueltos: 0, noEncontrados: 0, errores: 0, reusados: 0 };
  const { data, error } = await db
    .from(TABLE)
    .select("ad_id")
    .eq("store_id", storeId)
    .eq("has_ad", true)
    .is("meta_status", null)
    .not("ad_id", "is", null)
    .order("checked_at", { ascending: false })
    .limit(200);
  if (error) fail(error, "leer los anuncios pendientes");
  const ads = Array.from(
    new Set(((data ?? []) as Row[]).map((r) => String(r.ad_id ?? "")).filter((id) => AD_ID.test(id))),
  ).slice(0, limits.metaAds);
  if (!ads.length) return result;

  // An ad already read for another order of the store is reused.
  const { data: known, error: e } = await db
    .from(TABLE)
    .select("ad_id,meta_status,meta_account_id,campaign_id,adset_id,ad_name,adset_name,campaign_name")
    .eq("store_id", storeId)
    .in("ad_id", ads)
    .not("meta_status", "is", null)
    .limit(200);
  if (e) fail(e, "leer los anuncios ya resueltos");
  const knownByAd = new Map<string, Row>();
  for (const row of (known ?? []) as Row[]) knownByAd.set(String(row.ad_id), row);

  const save = async (adId: string, fields: Row) => {
    const { error: w } = await db
      .from(TABLE)
      .update({ ...fields, meta_checked_at: new Date(deps.now()).toISOString() })
      .eq("store_id", storeId)
      .eq("ad_id", adId)
      .is("meta_status", null);
    if (w) throw new Error("save");
  };
  await pool(ads, 3, deadline, deps.now, async (adId) => {
    try {
      const reuse = knownByAd.get(adId);
      if (reuse) {
        await save(adId, {
          meta_status: reuse.meta_status,
          meta_account_id: reuse.meta_account_id ?? null,
          campaign_id: reuse.campaign_id ?? null,
          adset_id: reuse.adset_id ?? null,
          ad_name: reuse.ad_name ?? null,
          adset_name: reuse.adset_name ?? null,
          campaign_name: reuse.campaign_name ?? null,
        });
        result.reusados++;
        return;
      }
      const found = await lookupMetaAd(adId, config.version, config.token, accounts, deps.fetcher, limits.timeoutMs);
      if (found.kind === "error") {
        result.errores++;
        return;
      }
      if (found.kind === "not_found") {
        await save(adId, { meta_status: "not_found" });
        result.noEncontrados++;
        return;
      }
      await save(adId, {
        meta_status: "ok",
        meta_account_id: found.accountId,
        campaign_id: found.campaignId,
        adset_id: found.adsetId,
        ad_name: found.adName || null,
        adset_name: found.adsetName || null,
        campaign_name: found.campaignName || null,
      });
      result.resueltos++;
    } catch {
      result.errores++;
    }
  });
  return result;
}

/**
 * One run for one store. Never throws: a missing table answers `pendiente`,
 * any other failure `error` (generic text, no provider output).
 */
export async function avanzarAnunciosWhatsapp(
  store: { id: number; code: FinanceStoreCode },
  deadline: number,
  deps: WhatsappAdDeps = {},
): Promise<WhatsappAdRunSummary> {
  const db = (deps.db ?? getDB)();
  const now = deps.now ?? Date.now;
  const limits = { ...WHATSAPP_AD_LIMITS, ...deps.limits };
  const fetchOrigin = deps.fetchOrigin ?? getIcomflyWhatsappAdOrigin;
  const summary: WhatsappAdRunSummary = {
    store: store.code,
    consultados: 0,
    conAnuncio: 0,
    sinAnuncio: 0,
    errores: 0,
    descartados: 0,
    quedan: false,
    meta: { resueltos: 0, noEncontrados: 0, errores: 0, reusados: 0 },
  };
  try {
    const nowMs = now();
    const { candidates, more } = await selectCandidates(db, store.id, nowMs, limits, summary, deadline, now);
    const pending: Row[] = [];
    const flush = async () => {
      if (!pending.length) return;
      const rows = pending.splice(0, pending.length);
      const { error } = await db.from(TABLE).upsert(rows, { onConflict: "store_id,icomfly_order_id" });
      if (error) fail(error, "guardar los anuncios");
    };
    const started = await pool(candidates, limits.concurrency, deadline, now, async (c) => {
      let parsed: ParsedWhatsappAd | null = null;
      try {
        const res = await fetchOrigin(store.code, c.id, limits.timeoutMs);
        parsed = res.status >= 200 && res.status < 300 ? parseWhatsappAdOrigin(res.body) : null;
      } catch {
        parsed = null;
      }
      summary.consultados++;
      if (!parsed) summary.errores++;
      else if (parsed.hasAd) summary.conAnuncio++;
      else summary.sinAnuncio++;
      pending.push(checkRow(store.id, c, parsed, new Date(now()).toISOString()));
      if (pending.length >= 20) await flush();
    });
    await flush();
    summary.quedan = more || started < candidates.length;
    summary.meta = await resolveMetaCampaigns(
      db,
      store.id,
      store.code,
      { fetcher: deps.fetcher ?? fetch, env: deps.env ?? process.env, now },
      limits,
      deadline,
    );
    // Every request failed: iComfly (or the endpoint) is not answering.
    if (summary.consultados > 0 && summary.errores === summary.consultados)
      summary.error = "iComfly no respondió el origen de anuncio de ningún pedido.";
  } catch (err) {
    if (err instanceof MissingTable) {
      summary.pendiente = "Aplicar la migración 20261127120000_icomfly_whatsapp_ad_origins.sql";
    } else {
      summary.error = err instanceof Error ? err.message.slice(0, 200) : "Error";
    }
  }
  return summary;
}
