// TikTok Ads por anuncio y por dia, para la Matriz 4Pi de Marketing (03/11/2026).
//
// Charlie (lib/marketing-charlie.ts) trabaja por anuncio con el detalle diario
// que lee de Meta: gasto, impresiones, clics, frecuencia, compras, valor de
// compras e interacciones. De TikTok no hay acceso directo a la API (la app de
// desarrollador fue rechazada): el escenario de Make "CR|KENKU HEAL1010" manda
// el reporte por anuncio a POST /api/marketing/tiktok-anuncios y aca se arma
// la cuenta de TikTok con la misma forma que una de Meta.
//
// Lo que TikTok no da por este reporte queda vacio, no inventado:
//   - Estado de entrega: no viene. Se marca "ACTIVE" solo si el anuncio gasto
//     el ultimo dia consultado (es lo que Charlie usa para "activos").
//   - Post, creativo y assets dinamicos (Flex de Meta): null.
// "Compras" es Complete Payment (el evento de compra del pixel), el
// equivalente al purchase de Meta.

import { getDB } from "@/lib/db";
import type { CharlieAccount, CharlieAd, CharlieAdset } from "@/lib/marketing-charlie-types";
import { secretoValido } from "@/lib/tiktok-diario";

export { secretoValido };
export const TABLA_ANUNCIOS = "tiktok_anuncios_diario";
export const MAX_FILAS_ANUNCIOS = 1000;

export interface FilaAnuncio {
  store_id: number;
  advertiser_id: string;
  advertiser_name: string;
  ad_id: string;
  ad_name: string;
  adgroup_id: string;
  adgroup_name: string;
  campaign_id: string;
  campaign_name: string;
  fecha: string;
  spend: number;
  impressions: number;
  clicks: number;
  frequency: number | null;
  purchases: number;
  purchase_value: number | null;
  interactions: number;
  currency: string;
}

function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function texto(v: unknown, max = 300): string {
  return v == null ? "" : String(v).trim().slice(0, max);
}

function id(v: unknown): string {
  const t = texto(v, 40);
  return /^\d+$/.test(t) ? t : "";
}

/** Valida una fila de Make. La fecha puede venir "2026-11-02" o con hora (stat_time_day). */
export function leerFilaAnuncio(
  crudo: unknown,
  storeId: number
): { ok: true; fila: FilaAnuncio } | { ok: false; motivo: string } {
  const r = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;
  const advertiserId = id(r.advertiser_id);
  const adId = id(r.ad_id);
  const fecha = /^(\d{4}-\d{2}-\d{2})/.exec(texto(r.date ?? r.fecha ?? r.stat_time_day))?.[1] ?? "";
  const spend = numero(r.spend);
  const currency = texto(r.currency, 3).toUpperCase();
  if (!advertiserId) return { ok: false, motivo: "advertiser_id invalido" };
  if (!adId) return { ok: false, motivo: "ad_id invalido" };
  if (!fecha || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) return { ok: false, motivo: "fecha invalida" };
  if (spend == null || spend < 0) return { ok: false, motivo: "spend invalido" };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, motivo: "currency invalida" };
  const entero = (v: unknown) => {
    const n = numero(v);
    return n == null || n < 0 ? 0 : Math.round(n);
  };
  const purchases = entero(r.purchases);
  // Valor = compras x valor por compra (TikTok no da el total directo en este reporte).
  const porCompra = numero(r.value_per_purchase);
  const valorDirecto = numero(r.purchase_value);
  const valor = valorDirecto ?? (porCompra != null && porCompra >= 0 ? porCompra * purchases : null);
  const frecuencia = numero(r.frequency);
  return {
    ok: true,
    fila: {
      store_id: storeId,
      advertiser_id: advertiserId,
      advertiser_name: texto(r.advertiser_name),
      ad_id: adId,
      ad_name: texto(r.ad_name),
      adgroup_id: id(r.adgroup_id),
      adgroup_name: texto(r.adgroup_name),
      campaign_id: id(r.campaign_id),
      campaign_name: texto(r.campaign_name),
      fecha,
      spend: Math.round(spend * 100) / 100,
      impressions: entero(r.impressions),
      clicks: entero(r.clicks),
      frequency: frecuencia != null && frecuencia > 0 ? Math.round(frecuencia * 1000) / 1000 : null,
      purchases,
      purchase_value: valor == null ? null : Math.round(valor * 100) / 100,
      interactions: entero(r.interactions),
      currency,
    },
  };
}

export async function guardarFilasAnuncios(filas: FilaAnuncio[]): Promise<number> {
  if (!filas.length) return 0;
  const porLlave = new Map(filas.map((f) => [`${f.store_id}|${f.advertiser_id}|${f.ad_id}|${f.fecha}`, f]));
  const ahora = new Date().toISOString();
  const { error } = await getDB()
    .from(TABLA_ANUNCIOS)
    .upsert(
      Array.from(porLlave.values()).map((f) => ({ ...f, updated_at: ahora })),
      { onConflict: "store_id,advertiser_id,ad_id,fecha" }
    );
  if (error) throw new Error(`guardarFilasAnuncios: ${error.message}`);
  return porLlave.size;
}

/**
 * Las cuentas de TikTok con la forma de Charlie. `ultimoDia`: el ultimo dia
 * consultado, para marcar como activos los anuncios que gastaron ese dia.
 * Puro: se prueba sin base.
 */
export function cuentasCharlieTiktok(filas: FilaAnuncio[], ultimoDia: string, timezone: string): CharlieAccount[] {
  const cuentas = new Map<string, { cuenta: CharlieAccount; ads: Map<string, CharlieAd>; adsets: Map<string, CharlieAdset> }>();
  for (const f of filas) {
    let c = cuentas.get(f.advertiser_id);
    if (!c) {
      c = {
        cuenta: {
          platform: "tiktok",
          id: f.advertiser_id,
          name: `TikTok · ${f.advertiser_name || f.advertiser_id}`,
          currency: f.currency,
          timezone,
          ads: [],
          adsets: [],
          metadataMessage:
            "TikTok (via Make): sin estado de entrega, post ni creativo; activo = gasto el ultimo dia consultado. Compras = Complete Payment.",
        },
        ads: new Map(),
        adsets: new Map(),
      };
      cuentas.set(f.advertiser_id, c);
    }
    let ad = c.ads.get(f.ad_id);
    if (!ad) {
      ad = {
        id: f.ad_id,
        name: f.ad_name || f.ad_id,
        adsetId: f.adgroup_id,
        campaignId: f.campaign_id,
        effectiveStatus: "SIN_DATO",
        postId: null,
        creativeId: null,
        assets: null,
        daily: [],
      };
      c.ads.set(f.ad_id, ad);
    }
    if (f.ad_name) ad.name = f.ad_name;
    if (f.fecha === ultimoDia && Number(f.spend) > 0) ad.effectiveStatus = "ACTIVE";
    ad.daily.push({
      date: f.fecha,
      spend: Number(f.spend) || 0,
      impressions: f.impressions ?? 0,
      clicks: f.clicks ?? 0,
      frequency: f.frequency == null ? null : Number(f.frequency),
      purchases: f.purchases ?? 0,
      purchaseValue: f.purchase_value == null ? (f.purchases > 0 ? null : 0) : Number(f.purchase_value),
      interactions: f.interactions ?? 0,
    });
    if (f.adgroup_id && !c.adsets.has(f.adgroup_id)) {
      c.adsets.set(f.adgroup_id, {
        id: f.adgroup_id,
        name: f.adgroup_name || f.adgroup_id,
        campaignId: f.campaign_id,
        dynamic: false,
        effectiveStatus: "SIN_DATO",
      });
    }
    const adset = f.adgroup_id ? c.adsets.get(f.adgroup_id) : undefined;
    if (adset && f.adgroup_name) adset.name = f.adgroup_name;
    if (adset && f.fecha === ultimoDia && Number(f.spend) > 0) adset.effectiveStatus = "ACTIVE";
  }
  return Array.from(cuentas.values()).map(({ cuenta, ads, adsets }) => ({
    ...cuenta,
    ads: Array.from(ads.values()).map((a) => ({ ...a, daily: a.daily.sort((x, y) => x.date.localeCompare(y.date)) })),
    adsets: Array.from(adsets.values()),
  }));
}

/** Las cuentas de TikTok para Charlie entre dos dias (YYYY-MM-DD, inclusivos). */
export async function leerCuentasCharlieTiktok(storeId: number, desde: string, hasta: string): Promise<CharlieAccount[]> {
  const filas: FilaAnuncio[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getDB()
      .from(TABLA_ANUNCIOS)
      .select(
        "store_id,advertiser_id,advertiser_name,ad_id,ad_name,adgroup_id,adgroup_name,campaign_id,campaign_name,fecha,spend,impressions,clicks,frequency,purchases,purchase_value,interactions,currency"
      )
      .eq("store_id", storeId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .order("ad_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`leerCuentasCharlieTiktok: ${error.message}`);
    const pagina = (data ?? []) as FilaAnuncio[];
    filas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return cuentasCharlieTiktok(filas, hasta, process.env.TIKTOK_CR_TIMEZONE?.trim() ?? "");
}
