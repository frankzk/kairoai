// Gasto diario de TikTok Ads que manda Make (03/11/2026).
//
// El escenario "CR|KENKU HEAL1010" de Make ya leia el reporte de TikTok cada
// dia y lo escribia en el Sheets "Mireva Costa Rica" > Ads Tracker. Ahora
// tambien lo manda a POST /api/marketing/tiktok-diario, y Marketing lo usa
// como fuente de TikTok (la app de desarrollador de TikTok fue rechazada, asi
// que no hay acceso directo a la API).
//
// Make trae AYER y ANTEAYER en cada corrida: cada dia llega dos veces. La
// fila se guarda por tienda + anunciante + campaña + dia y el segundo envio
// reemplaza al primero (el de anteayer ya esta cerrado y es el bueno).
//
// La cuenta cobra en soles (PEN): se guarda la moneda tal cual y Marketing la
// muestra aparte de Meta (USD), sin convertir.

import crypto from "crypto";
import { getDB } from "@/lib/db";
import type { MarketingAdsData, MarketingCampaign } from "@/lib/marketing-source-types";

export const TABLA = "tiktok_ads_diario";
export const MAX_FILAS_POR_ENVIO = 500;

export interface FilaTiktok {
  store_id: number;
  advertiser_id: string;
  advertiser_name: string;
  campaign_id: string;
  campaign_name: string;
  fecha: string;
  spend: number;
  clicks: number;
  impressions: number | null;
  conversions: number | null;
  currency: string;
  timezone: string;
}

/** Compara el secreto sin filtrar por tiempo cuanto coincide. */
export function secretoValido(recibido: string | null, esperado: string | undefined): boolean {
  if (!esperado || !recibido) return false;
  const a = crypto.createHash("sha256").update(recibido).digest();
  const b = crypto.createHash("sha256").update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

function numero(v: unknown): number | null {
  if (v == null || v === "") return null;
  // Make puede mandar "1,234.56" o "24.31".
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function texto(v: unknown, max = 300): string {
  return v == null ? "" : String(v).trim().slice(0, max);
}

/**
 * Valida una fila de Make. Devuelve la fila lista o el motivo del rechazo.
 * La fecha puede venir "2026-11-02" o "2026-11-02T00:00:00.000Z" (stat_time_day).
 */
export function leerFilaTiktok(
  crudo: unknown,
  storeId: number
): { ok: true; fila: FilaTiktok } | { ok: false; motivo: string } {
  const r = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;
  const advertiserId = texto(r.advertiser_id, 40);
  const campaignId = texto(r.campaign_id, 40);
  const fecha = /^(\d{4}-\d{2}-\d{2})/.exec(texto(r.date ?? r.fecha ?? r.stat_time_day))?.[1] ?? "";
  const spend = numero(r.spend);
  const currency = texto(r.currency, 3).toUpperCase();
  if (!/^\d+$/.test(advertiserId)) return { ok: false, motivo: "advertiser_id invalido" };
  if (!/^\d+$/.test(campaignId)) return { ok: false, motivo: "campaign_id invalido" };
  if (!fecha || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) return { ok: false, motivo: "fecha invalida" };
  if (spend == null || spend < 0) return { ok: false, motivo: "spend invalido" };
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, motivo: "currency invalida" };
  const entero = (v: unknown) => {
    const n = numero(v);
    return n == null || n < 0 ? null : Math.round(n);
  };
  return {
    ok: true,
    fila: {
      store_id: storeId,
      advertiser_id: advertiserId,
      advertiser_name: texto(r.advertiser_name),
      campaign_id: campaignId,
      campaign_name: texto(r.campaign_name),
      fecha,
      spend: Math.round(spend * 100) / 100,
      clicks: entero(r.clicks) ?? 0,
      impressions: entero(r.impressions),
      conversions: entero(r.conversions ?? r.conversion),
      currency,
      timezone: texto(r.timezone, 60),
    },
  };
}

/** Guarda (o reemplaza) las filas del envio. */
export async function guardarFilasTiktok(filas: FilaTiktok[]): Promise<number> {
  if (!filas.length) return 0;
  // La ultima version de cada llave gana, para no mandar dos veces la misma en un upsert.
  const porLlave = new Map(filas.map((f) => [`${f.store_id}|${f.advertiser_id}|${f.campaign_id}|${f.fecha}`, f]));
  const ahora = new Date().toISOString();
  const { error } = await getDB()
    .from(TABLA)
    .upsert(
      Array.from(porLlave.values()).map((f) => ({ ...f, updated_at: ahora })),
      { onConflict: "store_id,advertiser_id,campaign_id,fecha" }
    );
  if (error) throw new Error(`guardarFilasTiktok: ${error.message}`);
  return porLlave.size;
}

/** Arma las cuentas de Marketing con las filas del periodo (dias YYYY-MM-DD, inclusivos). Puro. */
export function cuentasTiktok(filas: FilaTiktok[]): MarketingAdsData[] {
  const cuentas = new Map<string, { data: MarketingAdsData; campanas: Map<string, MarketingCampaign> }>();
  for (const f of filas) {
    let cuenta = cuentas.get(f.advertiser_id);
    if (!cuenta) {
      cuenta = {
        data: {
          accountId: f.advertiser_id,
          accountName: f.advertiser_name || f.advertiser_id,
          currency: f.currency,
          timezone: f.timezone,
          campaigns: [],
        },
        campanas: new Map(),
      };
      cuentas.set(f.advertiser_id, cuenta);
    }
    let c = cuenta.campanas.get(f.campaign_id);
    if (!c) {
      c = { id: f.campaign_id, name: f.campaign_name || f.campaign_id, spend: 0, impressions: 0, clicks: 0, daily: [] };
      cuenta.campanas.set(f.campaign_id, c);
    }
    // El nombre mas reciente de la campaña.
    if (f.campaign_name) c.name = f.campaign_name;
    c.spend += Number(f.spend) || 0;
    c.impressions += f.impressions ?? 0;
    c.clicks += f.clicks ?? 0;
    c.daily!.push({
      date: f.fecha,
      spend: Number(f.spend) || 0,
      impressions: f.impressions ?? 0,
      clicks: f.clicks ?? 0,
      purchases: f.conversions,
    });
  }
  return Array.from(cuentas.values()).map(({ data, campanas }) => ({
    ...data,
    campaigns: Array.from(campanas.values())
      .map((c) => ({ ...c, spend: Math.round(c.spend * 100) / 100, daily: c.daily!.sort((a, b) => a.date.localeCompare(b.date)) }))
      .sort((a, b) => b.spend - a.spend),
  }));
}

/** Las cuentas de TikTok con gasto en el periodo, o [] si Make todavia no mando nada. */
export async function leerCuentasTiktok(storeId: number, desde: string, hasta: string): Promise<MarketingAdsData[]> {
  const filas: FilaTiktok[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getDB()
      .from(TABLA)
      .select(
        "store_id,advertiser_id,advertiser_name,campaign_id,campaign_name,fecha,spend,clicks,impressions,conversions,currency,timezone"
      )
      .eq("store_id", storeId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .order("campaign_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`leerCuentasTiktok: ${error.message}`);
    const pagina = (data ?? []) as FilaTiktok[];
    filas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  // Make no sabe la zona horaria de la cuenta: se configura aparte. Sin ella
  // Marketing no da el CPA combinado (no sabe si los dias coinciden con los
  // de los pedidos en Costa Rica).
  const zona = process.env.TIKTOK_CR_TIMEZONE?.trim() ?? "";
  return cuentasTiktok(filas.map((f) => (f.timezone ? f : { ...f, timezone: zona })));
}

/** Los anunciantes de TikTok de los que Make ya mando gasto para la tienda. */
export async function anunciantesTiktok(storeId: number): Promise<string[]> {
  const { data, error } = await getDB()
    .from(TABLA)
    .select("advertiser_id")
    .eq("store_id", storeId)
    .order("fecha", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`anunciantesTiktok: ${error.message}`);
  return Array.from(new Set(((data ?? []) as Array<{ advertiser_id: string }>).map((r) => r.advertiser_id)));
}
