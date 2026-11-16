"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Loader2 } from "lucide-react";
import { periodQuery } from "@/lib/marketing-dates";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import { buildSpendByAccount, spendDates, type SpendAccountRow } from "@/lib/marketing-spend-accounts";
import { money, shortDate } from "./format";
import rs from "./resumen.module.css";

// Gasto del período por cuenta publicitaria (Meta y TikTok): para cotejar con
// el administrador de anuncios que Kairo lee cada cuenta y el gasto correcto.

const PLATAFORMA = { meta: "Meta", tiktok: "TikTok" } as const;

function Monto({ row }: { row: SpendAccountRow }) {
  if (row.problem) return <span className="text-amber-300">No se leyó</span>;
  return <>{money(row.spend, row.currency || null)}</>;
}

export function SpendByAccount({
  sources,
  loading,
  fx,
  period,
}: {
  sources: MarketingSources | null;
  loading: boolean;
  fx: UsdRate | null;
  period: { from: string; to: string };
}) {
  const [porDia, setPorDia] = useState(false);
  // El Resumen lee solo el total del período (lo más liviano). Los días se
  // piden aparte, al abrir "Ver gasto por día", y solo para este período.
  const [diario, setDiario] = useState<{ key: string; sources: MarketingSources | null; error: string } | null>(null);
  const [cargandoDias, setCargandoDias] = useState(false);
  const periodKey = `${period.from}|${period.to}`;
  const { rows, totalUsd, pending, subtotals } = useMemo(() => buildSpendByAccount(sources, fx, period), [sources, fx, period]);
  const diarioVigente = diario?.key === periodKey ? diario : null;
  const filasDia = useMemo(
    () => (diarioVigente?.sources ? buildSpendByAccount(diarioVigente.sources, fx, period).rows : rows),
    [diarioVigente, fx, period, rows]
  );
  const dates = useMemo(() => spendDates(filasDia), [filasDia]);
  const conDias = filasDia.filter((r) => r.days);

  async function abrirPorDia() {
    const abrir = !porDia;
    setPorDia(abrir);
    if (!abrir || diarioVigente || rows.every((r) => r.problem || r.days)) return;
    setCargandoDias(true);
    try {
      const res = await fetch(`/api/marketing/sources?${periodQuery(period)}&scope=dias`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as (MarketingSources & { error?: string }) | null;
      if (!res.ok || !json?.meta) throw new Error(json?.error || "No se pudo leer el gasto por día.");
      setDiario({ key: periodKey, sources: json, error: "" });
    } catch (e) {
      setDiario({ key: periodKey, sources: null, error: e instanceof Error ? e.message : "No se pudo leer el gasto por día." });
    } finally {
      setCargandoDias(false);
    }
  }
  const rango = period.from === period.to ? shortDate(period.from) : `${shortDate(period.from)} al ${shortDate(period.to)}`;

  return (
    <section className={rs.card} aria-labelledby="resumen-cuentas-gasto">
      <div className={rs.cardHead}>
        <h2 id="resumen-cuentas-gasto">Gasto por cuenta publicitaria</h2>
        <p>{rango}, como lo lee Kairo</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{loading || pending ? "Consultando el gasto de las cuentas…" : "Sin cuentas configuradas."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <caption className="sr-only">Gasto del período por cuenta publicitaria</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border [&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
                <th scope="col">Cuenta</th>
                <th scope="col">Plataforma</th>
                <th scope="col" className="text-right">Gasto (moneda de la cuenta)</th>
                <th scope="col" className="text-right">En USD</th>
                <th scope="col" className="text-right">Campañas con gasto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border/60 last:border-b-0 [&>td]:px-2 [&>td]:py-2">
                  <th scope="row" className="px-2 py-2 text-left font-medium text-foreground">
                    {r.accountName}
                    {r.accountId && r.accountId !== r.accountName && (
                      <span className="block text-xs font-normal tabular-nums text-muted-foreground">{r.accountId}</span>
                    )}
                    {r.problem && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {r.problem}
                      </span>
                    )}
                  </th>
                  <td className="text-muted-foreground">{PLATAFORMA[r.platform]}</td>
                  <td className="text-right tabular-nums text-foreground">
                    <Monto row={r} />
                  </td>
                  <td className="text-right tabular-nums">{r.problem ? "—" : r.spendUsd == null ? "Sin tipo de cambio" : money(r.spendUsd, "USD")}</td>
                  <td className="text-right tabular-nums">{r.problem ? "—" : `${r.activeCampaigns} de ${r.campaigns}`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {subtotals.map((t) => (
                <tr key={t.platform} className="border-t border-border text-foreground [&>td]:px-2 [&>td]:py-2">
                  <th scope="row" className="px-2 py-2 text-left font-medium">
                    Total {PLATAFORMA[t.platform]}
                    {!t.complete && <span className="block text-xs font-normal text-amber-300">Falta una cuenta</span>}
                  </th>
                  <td />
                  <td className="text-right tabular-nums">{t.currency ? money(t.spend, t.currency) : "Varias monedas"}</td>
                  <td className="text-right tabular-nums">{t.spendUsd == null ? "Sin tipo de cambio" : money(t.spendUsd, "USD")}</td>
                  <td />
                </tr>
              ))}
              <tr className="border-t border-border font-medium text-foreground [&>td]:px-2 [&>td]:py-2">
                <th scope="row" className="px-2 py-2 text-left font-medium">Total Meta + TikTok</th>
                <td />
                <td />
                <td className="text-right tabular-nums">{totalUsd == null ? "Incompleto" : money(totalUsd, "USD")}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rows.some((r) => !r.problem) && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void abrirPorDia()}
            aria-expanded={porDia}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {porDia ? "Ocultar gasto por día" : "Ver gasto por día"}
          </button>
          {porDia && cargandoDias && (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Consultando el gasto de cada día…
            </p>
          )}
          {porDia && !cargandoDias && diarioVigente?.error && (
            <p className="mt-2 text-[13px] text-amber-300">{diarioVigente.error}</p>
          )}
          {porDia && !cargandoDias && !diarioVigente?.error && dates.length === 0 && (
            <p className="mt-2 text-[13px] text-muted-foreground">Sin gasto por día en este período.</p>
          )}
          {porDia && !cargandoDias && dates.length > 0 && (
            <div className="mt-2 max-h-[360px] overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[480px] text-[13px]">
                <caption className="sr-only">Gasto por día y cuenta, en la moneda de cada cuenta</caption>
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border [&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
                    <th scope="col">Día</th>
                    {conDias.map((r) => (
                      <th key={r.key} scope="col" className="text-right">
                        {r.accountName} <span className="font-normal">({r.currency})</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date) => (
                    <tr key={date} className="border-b border-border/60 last:border-b-0 [&>td]:px-2 [&>td]:py-1.5">
                      <th scope="row" className="px-2 py-1.5 text-left font-normal text-foreground">{shortDate(date)}</th>
                      {conDias.map((r) => {
                        const d = r.days?.find((x) => x.date === date);
                        return (
                          <td key={r.key} className="text-right tabular-nums">
                            {d ? money(d.spend, r.currency) : <span className="text-muted-foreground">0</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <p className={rs.foot}>
        Meta se lee de su API al momento; TikTok, de lo que manda Make cada mañana (el día de hoy llega mañana). Si una cuenta dice
        «No se leyó», su gasto no está en el total.
        {porDia && filasDia.some((r) => !r.problem && !r.days) && " Las cuentas sin columna en «por día» solo traen el total del período."}
      </p>
    </section>
  );
}
