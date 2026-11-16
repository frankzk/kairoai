// Gasto del período por cuenta publicitaria (Meta y TikTok), para cotejar
// contra el administrador de anuncios que Kairo está leyendo bien cada
// cuenta. Sale de /api/marketing/sources: el gasto de las campañas de cada
// cuenta en su moneda, su conversión a USD y, si la fuente lo trae, el gasto
// día por día. Las cuentas de Meta que no se pudieron leer salen como fila
// aparte, para que no parezca que gastaron cero.
//
// Puro: se prueba en tests/marketing-spend-accounts.test.ts.

import type { MarketingAdsData, MarketingSources } from "./marketing-source-types";
import type { UsdRate } from "./marketing-charlie-types";
import { asUsd } from "./marketing-usd-rate";

export interface SpendAccountRow {
  key: string;
  platform: "meta" | "tiktok";
  accountId: string;
  accountName: string;
  currency: string;
  /** Gasto del período en la moneda de la cuenta; null si no se pudo leer. */
  spend: number | null;
  spendUsd: number | null;
  campaigns: number;
  /** Campañas con gasto en el período. */
  activeCampaigns: number;
  /** Gasto por día (moneda de la cuenta), o null si la fuente no trae días. */
  days: Array<{ date: string; spend: number }> | null;
  /** Motivo cuando la cuenta no se pudo leer o la fuente falló. */
  problem?: string;
}

export interface PlatformSubtotal {
  platform: "meta" | "tiktok";
  /** null si las cuentas usan monedas distintas. */
  currency: string | null;
  spend: number | null;
  spendUsd: number | null;
  /** false si alguna cuenta de la plataforma no se pudo leer. */
  complete: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysOf(account: MarketingAdsData, from: string, to: string): SpendAccountRow["days"] {
  const withSpend = account.campaigns.filter((c) => c.spend > 0);
  if (withSpend.length && withSpend.every((c) => Array.isArray(c.daily))) {
    const byDay = new Map<string, number>();
    for (const c of withSpend) for (const d of c.daily ?? []) if (d.date >= from && d.date <= to) byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.spend);
    return Array.from(byDay, ([date, spend]) => ({ date, spend: round2(spend) })).sort((a, b) => a.date.localeCompare(b.date));
  }
  if (account.dailySpend) {
    return account.dailySpend.days
      .filter((d) => d.date >= from && d.date <= to)
      .map((d) => ({ date: d.date, spend: round2(d.spend) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return null;
}

/** Una fila por cuenta, Meta primero; dentro, de mayor a menor gasto. */
export function buildSpendByAccount(
  sources: MarketingSources | null,
  fx: UsdRate | null,
  period: { from: string; to: string }
): { rows: SpendAccountRow[]; totalUsd: number | null; pending: boolean; subtotals: PlatformSubtotal[] } {
  const rows: SpendAccountRow[] = [];
  let pending = false;
  for (const platform of ["meta", "tiktok"] as const) {
    const source = sources?.[platform];
    if (!source || source.status === "pending") {
      pending = true;
      continue;
    }
    if (source.status === "error" || !source.data) {
      rows.push({
        key: `${platform}:error`,
        platform,
        accountId: "",
        accountName: platform === "meta" ? "Meta" : "TikTok",
        currency: "",
        spend: null,
        spendUsd: null,
        campaigns: 0,
        activeCampaigns: 0,
        days: null,
        problem: source.message || "No se pudo leer el gasto.",
      });
      continue;
    }
    const cuentas = source.data.accounts.map((a): SpendAccountRow => {
      const spend = round2(a.campaigns.reduce((n, c) => n + c.spend, 0));
      return {
        key: `${platform}:${a.accountId}`,
        platform,
        accountId: a.accountId,
        accountName: a.accountName || a.accountId,
        currency: a.currency,
        spend,
        spendUsd: asUsd(spend, a.currency, fx),
        campaigns: a.campaigns.length,
        activeCampaigns: a.campaigns.filter((c) => c.spend > 0).length,
        days: daysOf(a, period.from, period.to),
      };
    });
    cuentas.sort((a, b) => (b.spendUsd ?? b.spend ?? 0) - (a.spendUsd ?? a.spend ?? 0));
    rows.push(...cuentas);
    for (const u of source.data.unavailable ?? []) {
      rows.push({
        key: `${platform}:${u.accountId}`,
        platform,
        accountId: u.accountId,
        accountName: u.accountId,
        currency: "",
        spend: null,
        spendUsd: null,
        campaigns: 0,
        activeCampaigns: 0,
        days: null,
        problem: u.reason || "No se pudo leer esta cuenta.",
      });
    }
  }
  const usd = rows.map((r) => r.spendUsd);
  const complete = !pending && rows.length > 0 && rows.every((r) => !r.problem && r.spendUsd != null);
  const subtotals: PlatformSubtotal[] = [];
  for (const platform of ["meta", "tiktok"] as const) {
    const own = rows.filter((r) => r.platform === platform);
    if (!own.length) continue;
    const ok = own.filter((r) => !r.problem);
    const currencies = Array.from(new Set(ok.map((r) => r.currency)));
    subtotals.push({
      platform,
      currency: currencies.length === 1 ? currencies[0] : null,
      spend: currencies.length === 1 ? round2(ok.reduce((n, r) => n + (r.spend ?? 0), 0)) : null,
      spendUsd: ok.every((r) => r.spendUsd != null) ? round2(ok.reduce((n, r) => n + (r.spendUsd ?? 0), 0)) : null,
      complete: ok.length === own.length,
    });
  }
  return { rows, totalUsd: complete ? round2(usd.reduce<number>((n, v) => n + (v ?? 0), 0)) : null, pending, subtotals };
}

/** Fechas del período con al menos una cuenta con días, para la tabla por día. */
export function spendDates(rows: SpendAccountRow[]): string[] {
  const all = new Set<string>();
  for (const r of rows) for (const d of r.days ?? []) all.add(d.date);
  return Array.from(all).sort();
}
