"use client";
import { useMemo, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { OrderFactsPayload } from "@/lib/marketing-insights-types";
import { buildRealEstimate } from "@/lib/marketing-real-cpa";
import {
  simulateOrders,
  simulatorDefaults,
  type SimulatorInput,
} from "@/lib/marketing-simulator";
import { decimalText } from "@/lib/marketing-copy";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, money, percentage, shortDate } from "./format";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;

type Field = Exclude<keyof SimulatorInput, "goalOrders">;
const FIELDS: Array<{ key: Field; label: string; percent?: boolean }> = [
  { key: "spendUsd", label: "Gasto diario (USD)" },
  { key: "cpaRealUsd", label: "CPA real (USD)" },
  { key: "otherRealPerDay", label: "Pedidos sin campaña por día" },
  { key: "cancelRateNow", label: "Anulación hoy %", percent: true },
  { key: "cancelRateTarget", label: "Anulación meta %", percent: true },
  { key: "extraCartsPerDay", label: "Carritos recuperados extra por día" },
  { key: "extraRepeatPerDay", label: "Recompras extra por día" },
];

const SEGMENT_CLASS: Record<string, string> = {
  ads: r.simAds,
  other: r.simOther,
  carts: r.simCarts,
  repeat: r.simRepeat,
};

/** "19,6" for 0.196; "1700" for spend: plain numbers the team can edit. */
const editable = (value: number, percent?: boolean) =>
  String(Math.round((percent ? value * 100 : value) * 100) / 100).replace(
    ".",
    ",",
  );
const parse = (text: string): number | null => {
  const value = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) && value >= 0
    ? value
    : null;
};
const orders = (value: number) => count(Math.round(value));

/** "Camino a 200" (módulo 10), section 05 of Análisis. */
export function PathTo200({
  data,
  settings,
  fx,
  actions,
  control,
  orders: facts,
}: {
  data: MarketingSummary;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  actions: Resource<MarketingSources>;
  control: Resource<MarketingControl>;
  orders: Resource<OrderFactsPayload>;
}) {
  const defaults = useMemo(() => {
    if (!actions.data || !control.data) return null;
    const { spend, estimates } = buildRealEstimate({
      summary: data,
      sources: actions.data,
      settings,
      control: control.data,
      fx,
    });
    return simulatorDefaults({
      days: control.data.days,
      estimates,
      spend,
      facts: facts.data,
      today: control.data.today,
    });
  }, [actions.data, control.data, data, settings, fx, facts.data]);
  const [edited, setEdited] = useState<Record<Field, string> | null>(null);
  const texts = useMemo(() => {
    if (edited) return edited;
    const values = defaults?.values;
    return Object.fromEntries(
      FIELDS.map((f) => [f.key, values ? editable(values[f.key], f.percent) : ""]),
    ) as Record<Field, string>;
  }, [edited, defaults]);
  const parsed = Object.fromEntries(
    FIELDS.map((f) => {
      const value = parse(texts[f.key]);
      return [f.key, value == null ? null : f.percent ? value / 100 : value];
    }),
  ) as Record<Field, number | null>;
  const invalid = FIELDS.filter((f) => {
    const value = parsed[f.key];
    return value == null || (f.percent && value >= 1);
  }).map((f) => f.key);
  const result =
    defaults && !invalid.length
      ? simulateOrders({
          ...(parsed as Record<Field, number>),
          goalOrders: t.dailyOrders,
        })
      : null;
  const missingPlatforms = actions.data
    ? (["meta", "tiktok"] as const).filter(
        (p) => actions.data?.[p].status !== "ready",
      )
    : [];
  const reference = defaults?.reference;
  const scale = result ? Math.max(result.total, result.goal, 1) : 1;
  const spend = parsed.spendUsd ?? 0;
  return (
    <section
      id="analisis-camino"
      className={r.section}
      aria-labelledby="path-title"
    >
      <div className={r.sectionHead}>
        <div>
          <p className={r.kicker}>05 / Camino a {t.dailyOrders}</p>
          <h2 id="path-title">Simulador del camino a {t.dailyOrders}</h2>
          <p>
            Cambia el gasto, el CPA, la anulación o las palancas y mira cuántos
            pedidos reales salen por día.
          </p>
        </div>
        {defaults?.window.from && defaults.window.to && (
          <span className={r.period}>
            {shortDate(defaults.window.from)} – {shortDate(defaults.window.to)}
          </span>
        )}
      </div>
      {(actions.loading || control.loading) && !defaults ? (
        <p role="status">Consultando gasto y pedidos de los últimos 7 días…</p>
      ) : !defaults ? (
        <p role="alert" className={r.risk}>
          {control.error || !control.data
            ? "Pedidos reales no disponibles."
            : "No se pudo consultar el gasto de Meta y TikTok."}
        </p>
      ) : (
        <>
          {missingPlatforms.length > 0 && (
            <p role="alert" className={r.warnText}>
              Sin datos de{" "}
              {missingPlatforms
                .map((p) => (p === "meta" ? "Meta" : "TikTok"))
                .join(" ni ")}
              : el gasto y el CPA de partida quedan incompletos.
            </p>
          )}
          <form
            className={r.simGrid}
            onSubmit={(event) => event.preventDefault()}
            aria-label="Supuestos del simulador"
          >
            {FIELDS.map((f) => (
              <label key={f.key} className={r.field}>
                {f.label}
                <input
                  type="text"
                  inputMode="decimal"
                  value={texts[f.key]}
                  aria-invalid={invalid.includes(f.key) || undefined}
                  onChange={(event) =>
                    setEdited({ ...texts, [f.key]: event.target.value })
                  }
                />
              </label>
            ))}
            <div className={r.simActions}>
              <button
                type="button"
                onClick={() => setEdited(null)}
                disabled={!edited}
              >
                Volver a los datos reales
              </button>
            </div>
          </form>
          {invalid.length > 0 && (
            <p role="alert" className={r.warnText}>
              Revisa{" "}
              {invalid
                .map((key) => FIELDS.find((f) => f.key === key)?.label)
                .join(", ")}
              : números de 0 en adelante (anulación menor a 100 %).
            </p>
          )}
          {result && (
            <div className={r.simResult} aria-live="polite">
              <p className={r.simHeadline}>
                Con {money(spend)} a CPA {money(parsed.cpaRealUsd)} salen{" "}
                <strong>{orders(result.adOrders)}</strong> pedidos reales +{" "}
                <strong>{orders(result.otherOrders)}</strong> sin campaña
                {result.leverOrders > 0 && (
                  <>
                    {" "}
                    + <strong>{orders(result.leverOrders)}</strong> de carritos
                    y recompras
                  </>
                )}{" "}
                = <strong>{orders(result.total)}</strong>.
              </p>
              <div
                className={r.simBar}
                role="img"
                aria-label={`${orders(result.total)} de ${count(result.goal)} pedidos: ${result.breakdown
                  .filter((b) => b.orders > 0)
                  .map((b) => `${b.label} ${orders(b.orders)}`)
                  .join(", ")}`}
              >
                {result.breakdown.map((b) =>
                  b.orders > 0 ? (
                    <span
                      key={b.code}
                      className={SEGMENT_CLASS[b.code]}
                      style={{ width: `${(b.orders / scale) * 100}%` }}
                    />
                  ) : null,
                )}
                <span
                  className={r.simGoal}
                  style={{ left: `${(result.goal / scale) * 100}%` }}
                  aria-hidden="true"
                />
              </div>
              <ul className={r.originLegend}>
                {result.breakdown
                  .filter((b) => b.orders > 0)
                  .map((b) => (
                    <li key={b.code}>
                      <span
                        className={SEGMENT_CLASS[b.code]}
                        aria-hidden="true"
                      />
                      {b.label}: {orders(b.orders)}
                    </li>
                  ))}
                <li>
                  <span className={r.simGoalKey} aria-hidden="true" />
                  Meta: {count(result.goal)}
                </li>
              </ul>
              {result.gap > 0 ? (
                <p className={`${r.simAnswer} ${r.risk}`}>
                  Para {count(result.goal)} te faltan{" "}
                  {orders(result.gap)} pedidos.
                  {result.spendForGoal != null &&
                    ` A este CPA te faltan ${money(result.spendForGoal - spend)} de gasto (${money(result.spendForGoal)} por día).`}
                  {result.cpaForGoal != null &&
                    ` Con este gasto llegas a ${count(result.goal)} con un CPA de ${money(result.cpaForGoal)}.`}
                </p>
              ) : (
                <p className={r.simAnswer}>
                  Llegas a {count(result.goal)}
                  {result.total - result.goal >= 0.5 &&
                    ` y te sobran ${orders(result.total - result.goal)} pedidos`}
                  .
                  {result.cpaForGoal != null &&
                    ` Con este gasto alcanza un CPA de hasta ${money(result.cpaForGoal)}.`}
                  {result.spendForGoal != null &&
                    result.spendForGoal < spend &&
                    ` A este CPA bastan ${money(result.spendForGoal)} por día.`}
                </p>
              )}
              {result.k !== 1 && (
                <p className={r.caption}>
                  Bajar la anulación de{" "}
                  {percentage(parsed.cancelRateNow)} a{" "}
                  {percentage(parsed.cancelRateTarget)} multiplica los pedidos
                  reales por {result.k.toFixed(2).replace(".", ",")} con los mismos pedidos
                  creados.
                </p>
              )}
            </div>
          )}
          {reference && (
            <p className={r.caption}>
              {reference.cartsPerDay != null && reference.botPerDay != null
                ? `Hoy: ${decimalText(reference.cartsPerDay)} carritos recuperados, ${decimalText(reference.botPerDay)} ventas del bot${
                    reference.repeatPerDay != null
                      ? ` y ${decimalText(reference.repeatPerDay)} recompras`
                      : ""
                  } por día (pedidos reales${
                    reference.from && reference.to
                      ? `, ${shortDate(reference.from)} – ${shortDate(reference.to)}`
                      : ""
                  }). `
                : facts.loading
                  ? "Consultando carritos, bot y recompras… "
                  : "Sin datos de carritos, bot ni recompras para el período. "}
              {reference.repeatStatus === "pending_migration"
                ? "Recompra sin dato (pendiente aplicar migración). "
                : reference.repeatStatus === "error"
                  ? "Recompra sin dato (no se pudo leer). "
                  : ""}
              Recompra = clientes que ya habían comprado antes (por teléfono, al
              menos {t.repeatMinDays} días antes). No se sabe cuántas vienen de
              mensajes de WhatsApp.
            </p>
          )}
          <p className={r.caption}>
            Datos de partida: promedio de {count(defaults.window.days)} días
            completos con el gasto de Meta y TikTok en USD. CPA real = gasto ÷
            pedidos reales de las campañas (≈ UTM + reparto por producto
            {defaults.utmShare != null
              ? `, ${percentage(defaults.utmShare)} con UTM`
              : ""}
            ). Anulación de hoy con{" "}
            {defaults.cancelWindow.from && defaults.cancelWindow.to
              ? `${shortDate(defaults.cancelWindow.from)} – ${shortDate(defaults.cancelWindow.to)}`
              : "los días cerrados"}{" "}
            (sin los últimos {t.cancelOpenDays} días, que todavía se pueden
            anular{defaults.cancelSource === "cancelaciones"
              ? "; se cuenta igual que en Cancelaciones"
              : ""}). Las palancas son pedidos creados: se les resta la anulación
            meta.
          </p>
          {defaults.notes.map((note) => (
            <p key={note} className={r.caption}>
              {note}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
