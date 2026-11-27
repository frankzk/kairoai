// Anuncio de WhatsApp de los pedidos (27/11/2026): la lectura del endpoint de
// iComfly, qué pedidos se consultan y cuántos, el cruce del anuncio con su
// campaña por el catálogo verificado, y el bot separado por anuncio.
import { describe, expect, it, vi } from "vitest";
import {
  dueForCheck,
  isWhatsappCandidate,
  parseWhatsappAdOrigin,
  rowAdOrigin,
  whatsappAdCheckOf,
  whatsappAdOrigin,
  type WhatsappAdCheck,
} from "../lib/icomfly-whatsapp-ad";
import {
  avanzarAnunciosWhatsapp,
  TABLE,
} from "../lib/icomfly-whatsapp-ad-db";
import {
  buildRealOrderDays,
  matchOriginsToOrders,
} from "../lib/marketing-real-orders";
import { buildMarketingAttribution } from "../lib/marketing-attribution";
import type { MarketingOriginRow } from "../lib/marketing-attribution";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
import { marketingPeriod } from "../lib/marketing-dates";

const SAMPLE = {
  success: true,
  data: {
    via: "whatsapp",
    canal: "WhatsApp",
    tipo: "anuncio",
    ad_id: "120247519549990424",
    ad_name: "",
    campaign_id: "",
    campaign_name: "",
    adset_id: "",
    adset_name: "",
    headline: "¡Complementa tu bienestar diario!",
    source_url: "https://fb.me/6CAR8V2hL",
    has_click: true,
    icomfly_campaign: "",
    received_at: "2026-11-25T20:04:46.587Z",
    fuente: "mensaje",
  },
};
const AD = "120247519549990424";
const CAMPAIGN = "120247519549990001";

describe("parseWhatsappAdOrigin", () => {
  it("reads the ad of the chat", () => {
    expect(parseWhatsappAdOrigin(SAMPLE)).toEqual({
      hasAd: true,
      adId: AD,
      headline: "¡Complementa tu bienestar diario!",
      sourceUrl: "https://fb.me/6CAR8V2hL",
      hasClick: true,
      receivedAt: "2026-11-25T20:04:46.587Z",
      via: "whatsapp",
      tipo: "anuncio",
      raw: {
        via: "whatsapp",
        canal: "WhatsApp",
        tipo: "anuncio",
        ad_id: AD,
        headline: "¡Complementa tu bienestar diario!",
        source_url: "https://fb.me/6CAR8V2hL",
        has_click: true,
        received_at: "2026-11-25T20:04:46.587Z",
        fuente: "mensaje",
      },
    });
  });

  it("data: null is a checked order without ad", () => {
    expect(parseWhatsappAdOrigin({ success: true, data: null })).toMatchObject({
      hasAd: false,
      adId: null,
      raw: null,
    });
  });

  it("unknown shapes are not 'sin anuncio' (they are retried)", () => {
    for (const body of [
      null,
      "Este pedido no trae UTM ni anuncio",
      [],
      { success: false, data: null },
      { success: false, error: "x" },
      { success: true, data: "anuncio" },
      { success: true, data: [SAMPLE.data] },
      {},
    ])
      expect(parseWhatsappAdOrigin(body)).toBeNull();
  });

  it("defensive: bad ids, long texts, extra fields never stored", () => {
    const parsed = parseWhatsappAdOrigin({
      success: true,
      data: {
        tipo: "anuncio",
        ad_id: "12; drop table",
        headline: "x".repeat(5000),
        source_url: "javascript:alert(1)",
        customer_phone: "+50688887777",
        received_at: "ayer",
      },
    })!;
    expect(parsed.hasAd).toBe(true); // iComfly says it was an ad, without id
    expect(parsed.adId).toBeNull();
    expect(parsed.headline).toHaveLength(300);
    expect(parsed.sourceUrl).toBeNull();
    expect(parsed.receivedAt).toBeNull();
    expect(JSON.stringify(parsed.raw)).not.toContain("50688887777");
    // An organic chat payload (no ad id, another tipo) is "sin anuncio".
    expect(
      parseWhatsappAdOrigin({ success: true, data: { via: "whatsapp", tipo: "organico" } })!
        .hasAd,
    ).toBe(false);
    // A numeric ad id is accepted.
    expect(
      parseWhatsappAdOrigin({ success: true, data: { ad_id: 120247519549990 } })!.adId,
    ).toBe("120247519549990");
  });
});

describe("qué pedidos se consultan", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  const hace = (h: number) => new Date(now - h * 3600_000).toISOString();
  it("never checked, failed (≤3), and without ad once more after 2 days", () => {
    expect(dueForCheck(null, now)).toBe(true);
    expect(dueForCheck({ has_ad: true, skipped: false, attempts: 1, checked_at: hace(500) }, now)).toBe(false);
    expect(dueForCheck({ has_ad: null, skipped: false, attempts: 2, checked_at: hace(1) }, now)).toBe(true);
    expect(dueForCheck({ has_ad: null, skipped: false, attempts: 3, checked_at: hace(1) }, now)).toBe(false);
    expect(dueForCheck({ has_ad: false, skipped: false, attempts: 1, checked_at: hace(47) }, now)).toBe(false);
    expect(dueForCheck({ has_ad: false, skipped: false, attempts: 1, checked_at: hace(48) }, now)).toBe(true);
    expect(dueForCheck({ has_ad: false, skipped: false, attempts: 2, checked_at: hace(500) }, now)).toBe(false);
    expect(dueForCheck({ has_ad: null, skipped: true, attempts: 1, checked_at: hace(49) }, now)).toBe(true);
    expect(dueForCheck({ has_ad: null, skipped: true, attempts: 2, checked_at: hace(500) }, now)).toBe(false);
  });

  it("WhatsApp origins and web orders without UTM; not Shopify nor web with UTM", () => {
    expect(isWhatsappCandidate({ sales_channel: "whatsapp" })).toBe(true);
    expect(isWhatsappCandidate({ labels: [{ name: "Venta por bot" }] })).toBe(true);
    expect(isWhatsappCandidate({ creator: "Conector IA" })).toBe(true);
    expect(isWhatsappCandidate({ creator: "Leonor" })).toBe(true);
    expect(isWhatsappCandidate({ order_number: "MANUAL-1-ABCDE" })).toBe(true);
    expect(isWhatsappCandidate({ order_number: "#55" })).toBe(true);
    expect(
      isWhatsappCandidate({ order_number: "#55", ad_origin: { utm_source: "facebook", utm_content: "120247519549990424" } }),
    ).toBe(false);
    expect(isWhatsappCandidate({ shopify_display_number: "#MCRC1", sales_channel: "whatsapp" })).toBe(false);
    // A WhatsApp order is asked even if it carries UTMs.
    expect(isWhatsappCandidate({ sales_channel: "whatsapp", ad_origin: { utm_source: "facebook" } })).toBe(true);
  });
});

const check = (over: Partial<WhatsappAdCheck> = {}): WhatsappAdCheck => ({
  hasAd: true,
  adId: AD,
  headline: "¡Complementa tu bienestar diario!",
  sourceUrl: "https://fb.me/6CAR8V2hL",
  hasClick: true,
  metaAccountId: "111",
  campaignId: CAMPAIGN,
  adsetId: "120247519549990002",
  adName: "Video 3",
  adsetName: "CTWA",
  campaignName: "WSP | Magnesio",
  icomflyCampaignId: null,
  ...over,
});
const catalog = [{ platform: "meta" as const, accountId: "111", campaignId: CAMPAIGN }];

describe("el anuncio de WhatsApp como origen publicitario", () => {
  it("campaign only when the catalog verifies it (same Meta account)", () => {
    expect(whatsappAdOrigin(check(), catalog)).toMatchObject({
      platform: "meta",
      via: "whatsapp",
      adId: AD,
      campaignId: CAMPAIGN,
      adsetId: "120247519549990002",
      campaignName: "WSP | Magnesio",
      conflicts: [],
    });
    // Not in the catalog: the ad id stays, no campaign (never guessed).
    const unknown = whatsappAdOrigin(check(), []);
    expect(unknown).toMatchObject({ adId: AD, campaignId: null, adsetId: null, campaignName: "" });
    // Another account of the catalog: no campaign.
    expect(whatsappAdOrigin(check({ metaAccountId: "222" }), catalog)!.campaignId).toBeNull();
    // Meta not read yet: no campaign.
    expect(whatsappAdOrigin(check({ campaignId: null, metaAccountId: null }), catalog)!.campaignId).toBeNull();
    // iComfly's own campaign id (when its Facebook Ads are connected), verified.
    expect(
      whatsappAdOrigin(check({ campaignId: null, metaAccountId: null, icomflyCampaignId: CAMPAIGN }), catalog)!
        .campaignId,
    ).toBe(CAMPAIGN);
    // Meta and iComfly disagree: conflict, no attribution.
    const clash = whatsappAdOrigin(check({ icomflyCampaignId: "120247519549990999" }), catalog)!;
    expect(clash.campaignId).toBeNull();
    expect(clash.conflicts).toEqual(["campaign"]);
    // No ad: no origin.
    expect(whatsappAdOrigin(check({ hasAd: false, adId: null }), catalog)).toBeNull();
    expect(whatsappAdOrigin(null, catalog)).toBeNull();
  });

  it("a web UTM wins over the WhatsApp ad", () => {
    const web = rowAdOrigin({ utm_source: "facebook", campaign_id: "123456789" }, check(), catalog)!;
    expect(web.campaignId).toBe("123456789");
    expect(web.via).toBeUndefined();
    expect(rowAdOrigin(null, check(), catalog)!.via).toBe("whatsapp");
  });

  it("stored rows: skipped and failed checks are 'not checked'", () => {
    expect(whatsappAdCheckOf({ skipped: true, has_ad: null })).toBeNull();
    expect(whatsappAdCheckOf({ skipped: false, has_ad: null })).toBeNull();
    expect(whatsappAdCheckOf({ skipped: false, has_ad: false })).toMatchObject({ hasAd: false, adId: null });
    // Meta fields only count when Meta answered ok.
    expect(
      whatsappAdCheckOf({ has_ad: true, ad_id: AD, meta_status: "not_found", campaign_id: CAMPAIGN })!.campaignId,
    ).toBeNull();
  });

  it("an order with a WhatsApp ad counts for that ad's campaign in real orders", () => {
    const period = marketingPeriod("2026-11-25", "2026-11-25")!;
    const order = (name: string): OrderProfitabilityRow =>
      ({
        order_key: name,
        order_name: name,
        guide_number: "",
        created_at: "2026-11-25T18:00:00Z",
        tracking_status: "delivered",
        items: [{ sku: "MAG", title: "Magnesio", quantity: 1 }],
      }) as unknown as OrderProfitabilityRow;
    const row = (name: string, whatsappAd: WhatsappAdCheck | null): MarketingOriginRow => ({
      icomfly_order_id: name.slice(3),
      order_number: name.slice(3),
      shopify_display_number: name,
      store_web_seq: null,
      tracking_number: null,
      ad_origin: null,
      sales_channel: "whatsapp",
      whatsappAd,
      originSource: "icomfly",
    });
    const orders = [order("IC-1"), order("IC-2"), order("IC-3")];
    const rows = [
      row("IC-1", check()),
      row("IC-2", check({ metaAccountId: null, campaignId: null })),
      row("IC-3", check({ hasAd: false, adId: null })),
    ];
    const matched = matchOriginsToOrders(orders, rows, catalog);
    const [day] = buildRealOrderDays(orders, matched, period, new Date("2026-11-26T12:00:00Z"));
    expect(day.withCampaign).toBe(1);
    expect(day.byCampaign).toEqual({ [`meta:${CAMPAIGN}`]: 1 });
    expect(day.byAd).toEqual({ [`meta:${AD}`]: 1 });
    // The ad without verified campaign and the organic chat go by product.
    expect(day.unlinkedBySku).toEqual({ "sku:mag": 2 });
    const attribution = buildMarketingAttribution(orders, rows, period, new Date("2026-11-26T12:00:00Z"), catalog);
    expect(attribution.linkedCampaign).toBe(1);
    expect(attribution.groups[0]).toMatchObject({ campaignId: CAMPAIGN, adId: AD, orders: 1 });
  });
});

// ─── El cron, con una base en memoria ───────────────────────────────────────

type Row = Record<string, unknown>;
function memoryDb(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "upsert" | "update" = "select";
    let payload: unknown = null;
    let sort: { col: string; asc: boolean } | null = null;
    let window: [number, number] | null = null;
    let max: number | null = null;
    const q: Record<string, unknown> = {};
    const chain = (name: string, fn: (...a: never[]) => void) => {
      q[name] = (...args: never[]) => {
        calls.push({ table, op: name, args });
        fn(...args);
        return q;
      };
    };
    chain("select", () => {});
    chain("eq", (c: string, v: unknown) => filters.push((r) => r[c] === v));
    chain("gte", (c: string, v: string) => filters.push((r) => String(r[c]) >= v));
    chain("lt", (c: string, v: string) => filters.push((r) => String(r[c]) < v));
    chain("in", (c: string, v: unknown[]) => filters.push((r) => v.includes(r[c])));
    chain("is", (c: string) => filters.push((r) => r[c] == null));
    chain("not", (c: string) => filters.push((r) => r[c] != null));
    chain("order", (c: string, o?: { ascending?: boolean }) => (sort = { col: c, asc: o?.ascending !== false }));
    chain("range", (a: number, b: number) => (window = [a, b]));
    chain("limit", (n: number) => (max = n));
    chain("upsert", (rows: Row[]) => {
      op = "upsert";
      payload = rows;
    });
    chain("update", (fields: Row) => {
      op = "update";
      payload = fields;
    });
    q.then = (resolve: (v: unknown) => unknown) => {
      const list = (tables[table] ??= []);
      if (op === "upsert") {
        for (const row of payload as Row[]) {
          const at = list.findIndex(
            (r) => r.store_id === row.store_id && r.icomfly_order_id === row.icomfly_order_id,
          );
          if (at >= 0) list[at] = { ...list[at], ...row };
          else list.push({ ...row });
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      const hits = list.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hits) Object.assign(r, payload);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      let out = [...hits];
      if (sort) {
        const { col, asc } = sort;
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (window) out = out.slice(window[0], window[1] + 1);
      if (max != null) out = out.slice(0, max);
      return Promise.resolve({ data: out.map((r) => ({ ...r })), error: null }).then(resolve);
    };
    return q;
  };
  return { db: () => ({ from }) as never, calls, tables };
}

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function storeTables() {
  const orders: Row[] = [];
  const payloads: Row[] = [];
  const add = (id: string, minutesAgo: number, signals: Row) => {
    orders.push({ store_id: 1, icomfly_order_id: id, icomfly_created_at: ago(minutesAgo) });
    payloads.push({ store_id: 1, icomfly_order_id: id, ...signals });
  };
  add("1328939", 60, { order_number: "172132", sales_channel: "whatsapp" }); // newest, bot
  add("1329232", 120, { order_number: "MANUAL-1-ABCDE" });
  add("1332560", 180, { order_number: "173104", creator: "Conector IA" });
  add("1326432", 240, { order_number: "171454", creator: "Leonor" });
  add("2000001", 300, { order_number: "#9", ad_origin: { utm_source: "facebook", utm_content: AD } }); // web + UTM
  add("2000002", 360, { order_number: "#10", shopify_display_number: "#MCRC10" }); // Shopify
  add("2000003", 5, { order_number: "175000", sales_channel: "whatsapp" }); // too new
  add("2000004", 420, { order_number: "175001", sales_channel: "whatsapp" }); // already has ad
  add("2000005", 60 * 24 * 60, { order_number: "100", sales_channel: "whatsapp" }); // out of the window
  orders.push({ store_id: 2, icomfly_order_id: "9000001", icomfly_created_at: ago(60) }); // other store
  return {
    icomfly_orders: orders,
    icomfly_order_payloads: payloads,
    [TABLE]: [
      { store_id: 1, icomfly_order_id: "2000004", has_ad: true, skipped: false, attempts: 1, checked_at: ago(600), ad_id: AD, meta_status: "ok" },
    ] as Row[],
  };
}

const store = { id: 1, code: "mireva-cr" as const };
const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });

describe("cron icomfly-whatsapp-ads", () => {
  it("asks only the orders that can come from a chat, newest first, and stores the 'no ad' too", async () => {
    const mem = memoryDb(storeTables());
    const asked: string[] = [];
    const fetchOrigin = vi.fn(async (_s: string, id: string) => {
      asked.push(id);
      return id === "1328939" ? ok(SAMPLE.data) : id === "1326432" ? { status: 503, body: null } : ok(null);
    });
    const summary = await avanzarAnunciosWhatsapp(store, NOW + 60_000, {
      db: mem.db,
      fetchOrigin,
      now: () => NOW,
      env: {},
      limits: { concurrency: 1 },
    });
    expect(asked).toEqual(["1328939", "1329232", "1332560", "1326432"]);
    expect(summary).toMatchObject({
      store: "mireva-cr",
      consultados: 4,
      conAnuncio: 1,
      sinAnuncio: 2,
      errores: 1,
      descartados: 2,
      quedan: false,
      meta: "sin_configurar",
    });
    expect(summary.error).toBeUndefined();
    const saved = new Map(mem.tables[TABLE].map((r) => [r.icomfly_order_id, r]));
    expect(saved.get("1328939")).toMatchObject({ has_ad: true, ad_id: AD, skipped: false, attempts: 1, order_created_at: ago(60) });
    expect(saved.get("1329232")).toMatchObject({ has_ad: false, ad_id: null });
    expect(saved.get("1326432")).toMatchObject({ has_ad: null, attempts: 1 }); // error: retried
    expect(saved.get("2000001")).toMatchObject({ skipped: true, has_ad: null });
    expect(saved.get("2000002")).toMatchObject({ skipped: true });
    expect(saved.has("2000003")).toBe(false);
    expect(saved.has("2000005")).toBe(false);
    // Only this store, and the payload read selects small paths, never the customer.
    for (const c of mem.calls.filter((c) => c.op === "eq" && c.args[0] === "store_id")) expect(c.args[1]).toBe(1);
    for (const c of mem.calls.filter((c) => c.op === "select"))
      expect(String(c.args[0])).not.toMatch(/phone|customer|address|email|^\*$/);

    // An hour later: the failed one again, and the one that was too new.
    fetchOrigin.mockClear();
    asked.length = 0;
    await avanzarAnunciosWhatsapp(store, NOW + 3600_000 + 60_000, { db: mem.db, fetchOrigin, now: () => NOW + 3600_000, env: {} });
    expect(asked).toEqual(["2000003", "1326432"]);
    // Two days later: the 'no ad' ones once more; the ad one never.
    asked.length = 0;
    const later = NOW + 49 * 3600_000;
    await avanzarAnunciosWhatsapp(store, later + 60_000, {
      db: mem.db,
      fetchOrigin,
      now: () => later,
      env: {},
      limits: { lookbackDays: 45 },
    });
    // (1326432 keeps failing: its third and last try.)
    expect(asked.sort()).toEqual(["1326432", "1329232", "1332560", "2000003"].sort());
    asked.length = 0;
    const evenLater = later + 49 * 3600_000;
    await avanzarAnunciosWhatsapp(store, evenLater + 60_000, { db: mem.db, fetchOrigin, now: () => evenLater, env: {} });
    expect(asked).toEqual([]);
  });

  it("respects the request cap per run and resumes in the next", async () => {
    const mem = memoryDb(storeTables());
    const fetchOrigin = vi.fn(async () => ok(null));
    const first = await avanzarAnunciosWhatsapp(store, NOW + 60_000, {
      db: mem.db,
      fetchOrigin,
      now: () => NOW,
      env: {},
      limits: { requests: 2 },
    });
    expect(fetchOrigin).toHaveBeenCalledTimes(2);
    expect(first.quedan).toBe(true);
    const second = await avanzarAnunciosWhatsapp(store, NOW + 60_000, {
      db: mem.db,
      fetchOrigin,
      now: () => NOW,
      env: {},
      limits: { requests: 2 },
    });
    expect(fetchOrigin).toHaveBeenCalledTimes(4);
    expect(second.quedan).toBe(false);
    // Never more at once than the concurrency.
    let live = 0,
      peak = 0;
    const slow = vi.fn(async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return ok(null);
    });
    await avanzarAnunciosWhatsapp(store, NOW + 60_000, { db: memoryDb(storeTables()).db, fetchOrigin: slow, now: () => NOW, env: {}, limits: { concurrency: 2 } });
    expect(peak).toBe(2);
  });

  it("a timeout or a throw is counted, never crashes; all failing is reported", async () => {
    const mem = memoryDb(storeTables());
    const summary = await avanzarAnunciosWhatsapp(store, NOW + 60_000, {
      db: mem.db,
      fetchOrigin: async () => {
        throw new Error("The operation was aborted due to timeout Bearer secreto");
      },
      now: () => NOW,
      env: {},
    });
    expect(summary.errores).toBe(4);
    expect(summary.error).toBe("iComfly no respondió el origen de anuncio de ningún pedido.");
    expect(JSON.stringify(summary)).not.toContain("secreto");
  });

  it("without the migration answers 'pendiente' and does nothing", async () => {
    const db = () =>
      ({
        from: () => {
          const q: Record<string, unknown> = {};
          for (const m of ["select", "eq", "gte", "lt", "in", "order", "range", "is", "not", "limit"]) q[m] = () => q;
          q.then = (r: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { code: "PGRST205", message: "x" } }).then(r);
          return q;
        },
      }) as never;
    const fetchOrigin = vi.fn();
    const summary = await avanzarAnunciosWhatsapp(store, NOW + 60_000, { db, fetchOrigin, now: () => NOW, env: {} });
    expect(summary.pendiente).toContain("20261127120000_icomfly_whatsapp_ad_origins.sql");
    expect(summary.error).toBeUndefined();
    expect(fetchOrigin).not.toHaveBeenCalled();
  });

  it("resolves the campaign of new ads in Meta once per ad, token only in the header", async () => {
    const tables = storeTables();
    tables[TABLE].push(
      { store_id: 1, icomfly_order_id: "3000001", has_ad: true, ad_id: "120000000000000001", meta_status: null, checked_at: ago(10), attempts: 1, skipped: false },
      { store_id: 1, icomfly_order_id: "3000002", has_ad: true, ad_id: "120000000000000001", meta_status: null, checked_at: ago(11), attempts: 1, skipped: false },
      { store_id: 1, icomfly_order_id: "3000003", has_ad: true, ad_id: "120000000000000002", meta_status: null, checked_at: ago(12), attempts: 1, skipped: false },
      { store_id: 1, icomfly_order_id: "3000004", has_ad: true, ad_id: "120000000000000003", meta_status: null, checked_at: ago(13), attempts: 1, skipped: false },
      // Same ad as 3000005, already read for another order: reused.
      { store_id: 1, icomfly_order_id: "3000005", has_ad: true, ad_id: "120000000000000004", meta_status: null, checked_at: ago(14), attempts: 1, skipped: false },
      { store_id: 1, icomfly_order_id: "3000006", has_ad: true, ad_id: "120000000000000004", meta_status: "ok", meta_account_id: "111", campaign_id: CAMPAIGN, checked_at: ago(900), attempts: 1, skipped: false },
    );
    const mem = memoryDb(tables);
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: URL | string, init?: RequestInit) => {
      urls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-cr");
      const id = String(url).split("/").pop()!.split("?")[0];
      if (id === "120000000000000001")
        return new Response(
          JSON.stringify({ account_id: "111", campaign_id: CAMPAIGN, adset_id: "120000000000000777", name: "Video 3", campaign: { name: "WSP | Magnesio" } }),
          { status: 200 },
        );
      if (id === "120000000000000002") return new Response(JSON.stringify({ account_id: "999", campaign_id: CAMPAIGN }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 100, message: "Unsupported get request" } }), { status: 400 });
    });
    const summary = await avanzarAnunciosWhatsapp(store, NOW + 60_000, {
      db: mem.db,
      fetchOrigin: async () => ok(null),
      fetcher: fetcher as never,
      now: () => NOW,
      env: { META_CR_ACCESS_TOKEN: "tok-cr", META_CR_AD_ACCOUNT_IDS: "act_111", META_CR_GRAPH_VERSION: "v21.0" },
    });
    expect(summary.meta).toEqual({ resueltos: 1, noEncontrados: 2, errores: 0, reusados: 1 });
    expect(urls).toHaveLength(3);
    for (const u of urls) expect(u).not.toContain("tok-cr");
    const saved = new Map(mem.tables[TABLE].map((r) => [r.icomfly_order_id, r]));
    for (const id of ["3000001", "3000002"])
      expect(saved.get(id)).toMatchObject({
        meta_status: "ok",
        meta_account_id: "111",
        campaign_id: CAMPAIGN,
        adset_id: "120000000000000777",
        campaign_name: "WSP | Magnesio",
      });
    // Another account's ad, and an ad Meta does not show: not_found, no campaign.
    expect(saved.get("3000003")).toMatchObject({ meta_status: "not_found" });
    expect(saved.get("3000003")!.campaign_id).toBeUndefined();
    expect(saved.get("3000004")).toMatchObject({ meta_status: "not_found" });
    expect(saved.get("3000005")).toMatchObject({ meta_status: "ok", campaign_id: CAMPAIGN });
    expect(JSON.stringify(summary)).not.toContain("tok-cr");
  });
});
