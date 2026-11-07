"use client";
import type { DailyPace } from "@/lib/marketing-pace";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { relativeChangeCopy } from "@/lib/kpi-comparison-copy";
import { count, money, percentage, shortDate } from "./format";
import r from "./team-report.module.css";

const usd = (value: number | null | undefined) => money(value, "USD");

/**
 * Today's pace: real orders, spend and real CPA against the day's goals.
 * - "primary": the selected period is today; it is the report's main block
 *   (the report heading already names the day).
 * - "inPeriod": the period reaches today but is longer (Este mes, 7 días):
 *   a secondary block under the period's results, named as today's part.
 * Periods that end before today do not show it.
 */
export function DailyGoals({
  pace,
  loading,
  spendLoading = false,
  error,
  variant = "primary",
}: {
  pace: DailyPace | null;
  loading: boolean;
  /** Meta and TikTok spend of the last 8 days still loading. */
  spendLoading?: boolean;
  error: string;
  variant?: "primary" | "inPeriod";
}) {
  const inPeriod = variant === "inPeriod";
  const goalText = `Meta del día: ${count(MARKETING_TARGETS.dailyOrders)} pedidos reales, ${usd(MARKETING_TARGETS.dailySpendUsd)} de gasto y CPA real de ${usd(MARKETING_TARGETS.cpaUsd)}.`;
  const updated = pace
    ? `Actualizado ${pace.asOf}, hora de Costa Rica. Pedidos reales al momento de consultar.`
    : goalText;
  return (
    <section
      className={inPeriod ? r.todayPart : r.todayMain}
      aria-labelledby={inPeriod ? "goals-title" : undefined}
      aria-label={inPeriod ? undefined : "Hoy contra la meta del día"}
    >
      {inPeriod ? (
        <div className={r.todayHead}>
          <h3 id="goals-title">Hoy, en curso</h3>
          <p>
            Parte del período de arriba. {updated}
          </p>
        </div>
      ) : (
        <p className={r.todayNote}>{updated}</p>
      )}
      {loading && !pace ? (
        <p role="status">Consultando los pedidos de hoy…</p>
      ) : !pace ? (
        <p role="alert" className={r.risk}>
          {error || "No se pudieron consultar los pedidos de hoy."}
        </p>
      ) : (
        <Goals pace={pace} spendLoading={spendLoading} />
      )}
    </section>
  );
}

function Goals({
  pace,
  spendLoading,
}: {
  pace: DailyPace;
  spendLoading: boolean;
}) {
  const { orders, spend, cpa } = pace;
  const tiktok = spend.tiktokEstimate;
  const spendNotes = spend.notes.filter((note) => !note.startsWith("TikTok ≈"));
  const cpaOver = cpa.real != null && cpa.real > cpa.goal;
  return (
    <>
      <div className={r.goals}>
        <Goal
          label="Pedidos reales"
          value={`${count(orders.real)} de ${count(orders.goal)}`}
          progress={orders.progress}
          valueNow={orders.real}
          max={orders.goal}
          comparison={relativeChangeCopy(orders.real, orders.yesterday?.real)}
          lines={[
            `${percentage(orders.progress)} de la meta · ${count(orders.created)} creados hoy`,
            orders.yesterday
              ? `Ayer a esta hora: ${count(orders.yesterday.real)} (creados ${count(orders.yesterday.created)})`
              : "Sin comparación con ayer a esta hora.",
          ]}
        />
        <Goal
          label="Gasto Meta + TikTok"
          value={
            spendLoading
              ? "Consultando…"
              : spend.total == null
                ? "Sin datos"
                : `${tiktok ? "≈ " : ""}${usd(spend.total)} de ${usd(spend.goal)}`
          }
          progress={spend.progress}
          valueNow={spend.total}
          max={spend.goal}
          lines={[
            spendLoading ? "Consultando el gasto de Meta y TikTok…" : "",
            `Meta ${usd(spend.meta)}${
              tiktok
                ? ` · TikTok ≈ ${usd(tiktok.soFar)} a esta hora (estimado con los ${usd(tiktok.value)} del ${shortDate(tiktok.fromDate)}; TikTok llega al día siguiente)`
                : ""
            }`,
            spend.sameHour
              ? `Meta hasta las ${spend.sameHour.through}: hoy ${usd(spend.sameHour.today)} · ayer ${usd(spend.sameHour.yesterday)}`
              : "",
            ...spendNotes,
          ]}
        />
        <Goal
          label="CPA real"
          value={`${usd(cpa.real)} · meta ${usd(cpa.goal)}`}
          progress={cpa.real == null ? null : cpa.real / cpa.goal}
          valueNow={cpa.real}
          max={cpa.goal}
          risk={cpaOver}
          lines={[
            cpa.real == null
              ? "Sin pedidos reales o sin gasto todavía."
              : cpaOver
                ? `Sobre la meta por ${usd(cpa.real - cpa.goal)}.`
                : "Dentro de la meta.",
            `Con pedidos creados: ${usd(cpa.created)}`,
          ]}
        />
      </div>
      <div className={r.goalLines}>
        <p>
          {orders.projected
            ? `A este ritmo cierras en ${count(orders.projected.real)} pedidos reales${
                spend.projected != null
                  ? ` y ≈ ${usd(spend.projected)}${cpa.projected != null ? ` (CPA ≈ ${usd(cpa.projected)})` : ""}`
                  : ""
              }.`
            : pace.notes.includes("Sin datos todavía")
              ? "Sin datos todavía."
              : "Muy temprano para proyectar."}
        </p>
        <p>
          {orders.gap > 0
            ? `Faltan ${count(orders.gap)} pedidos${
                spend.gap != null ? ` y ${usd(spend.gap)} de gasto` : ""
              }. A ${usd(cpa.goal)}, ${count(orders.gap)} pedidos son ${usd(pace.gapSpendAtGoalCpa)}.`
            : `Meta de ${count(orders.goal)} pedidos reales cumplida.`}
        </p>
        {pace.notes.includes("Proyección lineal (poco historial)") && (
          <p className={r.caption}>Proyección lineal (poco historial).</p>
        )}
      </div>
    </>
  );
}

function Goal({
  label,
  value,
  progress,
  valueNow,
  max,
  lines,
  comparison,
  risk = false,
}: {
  label: string;
  value: string;
  progress: number | null;
  valueNow: number | null;
  max: number;
  lines: string[];
  comparison?: ReturnType<typeof relativeChangeCopy>;
  risk?: boolean;
}) {
  const width = progress == null ? 0 : Math.min(1, Math.max(0, progress));
  return (
    <div className={r.goal}>
      <p>{label}</p>
      <strong>{value}</strong>
      <div
        className={`${r.meter} ${risk ? r.meterRisk : ""}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={
          valueNow == null ? undefined : Math.round(valueNow * 100) / 100
        }
        aria-valuetext={value}
      >
        <div className={r.meterFill} style={{ width: `${width * 100}%` }} />
      </div>
      {comparison && (
        <small className={r.goalComparison} data-trend={comparison.direction ?? "unavailable"}>
          {comparison.text}
        </small>
      )}
      {lines.filter(Boolean).map((line) => (
        <small key={line}>{line}</small>
      ))}
    </div>
  );
}
