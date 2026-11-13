"use client";
import { useMemo, useState } from "react";
import type { OrderFactsPayload } from "@/lib/marketing-insights-types";
import {
  buildCancelReport,
  CANCEL_BUCKET_LABEL,
  CANCEL_BUCKETS,
  type CancelBucket,
  type CancelDay,
} from "@/lib/marketing-cancellations";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, percentage, shortDate } from "./format";
import { ChartLegend, ColumnChart } from "./charts";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
const PRODUCTS = 15;

const BUCKET_HINT: Record<CancelBucket, string> = {
  evitable: "Errores al tomar el pedido: se corrigen con el equipo.",
  no_perdida: "El pedido existe en otro lado o nunca fue de un cliente.",
  perdida: "El cliente no quiso, no se pudo o no se sabe por qué.",
};

const high = (rate: number | null) => rate != null && rate > t.cancelRateAlert;
const pct = (rate: number | null) => percentage(rate);

/** Status colors: the series means good/bad here (over the limit or not). */
const dayColor = (day: CancelDay) =>
  high(day.rate)
    ? "var(--mk-bad)"
    : day.open
      ? "var(--mk-axis)"
      : "var(--mk-other)";

/** Emphasis: days over the limit in the status color, the rest in gray. */
function DailyBars({ days }: { days: CancelDay[] }) {
  return (
    <>
      <ChartLegend
        items={[
          {
            key: "ok",
            name: `Hasta ${pct(t.cancelRateAlert)}`,
            color: "var(--mk-other)",
          },
          {
            key: "high",
            name: `▲ Más de ${pct(t.cancelRateAlert)}`,
            color: "var(--mk-bad)",
          },
          ...(days.some((d) => d.open)
            ? [
                {
                  key: "open",
                  name: "Día reciente (todavía se puede anular)",
                  color: "var(--mk-axis)",
                },
              ]
            : []),
        ]}
      />
      <ColumnChart
        ariaLabel="Anulación por día; cifras en la tabla inferior"
        integer={false}
        format={(value) => pct(value)}
        tickFormat={(value) => `${Math.round(value * 100)} %`}
        reference={{
          value: t.cancelRateAlert,
          label: `Límite ${pct(t.cancelRateAlert)}`,
        }}
        bins={days.map((day) => ({
          key: day.date,
          label: shortDate(day.date),
          title: shortDate(day.date),
          stacks: [
            [
              {
                key: "rate",
                label: "anulado",
                value: day.rate,
                color: dayColor(day),
              },
            ],
          ],
          notes: [
            `${count(day.annulled)} de ${count(day.base)} pedidos`,
            high(day.rate) ? `▲ Más de ${pct(t.cancelRateAlert)}` : "",
            day.open ? "Día reciente: todavía se puede anular" : "",
          ],
        }))}
      />
      <details className={r.chartData}>
        <summary>Ver datos del gráfico</summary>
        <div
          className={r.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Anulación por día"
        >
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Anulados</th>
                <th>Pedidos</th>
                <th>Tasa</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">
                    {shortDate(day.date)}
                    {day.open && " (abierto)"}
                  </th>
                  <td>{count(day.annulled)}</td>
                  <td>{count(day.base)}</td>
                  <td>
                    {high(day.rate) && "▲ "}
                    {pct(day.rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** "Cancelaciones" (módulo 7), section 03 of Análisis. */
export function CancellationsPanel({
  orders,
}: {
  orders: Resource<OrderFactsPayload>;
}) {
  const [allProducts, setAllProducts] = useState(false);
  const facts = orders.data;
  const report = useMemo(
    () => (facts ? buildCancelReport(facts, facts.from, facts.to) : null),
    [facts],
  );
  // Headline: closed days only; the open ones still get annulled.
  const headline =
    report && report.closed.base > 0 ? report.closed : null;
  const headlineRate = headline ? headline.rate : (report?.total.rate ?? null);
  const products = report
    ? allProducts
      ? report.byProduct
      : report.byProduct.slice(0, PRODUCTS)
    : [];
  return (
    <section
      id="analisis-cancelaciones"
      className={r.section}
      aria-labelledby="cancellations-title"
    >
      <div className={r.sectionHead}>
        <div>
          <p className={r.kicker}>03 / Cancelaciones</p>
          <h2 id="cancellations-title">Cancelaciones</h2>
          <p>
            Cuántos pedidos se anulan, por qué, de qué productos y de dónde
            vienen. Más de {pct(t.cancelRateAlert)} es alto.
          </p>
        </div>
        {report && (
          <span className={r.period}>
            {shortDate(report.from)} – {shortDate(report.to)}
          </span>
        )}
      </div>
      {orders.loading && !facts ? (
        <p role="status">Consultando las anulaciones de iComfly…</p>
      ) : !facts || !report ? (
        orders.error ? (
          <p role="alert" className={r.risk}>
            No se pudieron leer las anulaciones de iComfly. {orders.error}
          </p>
        ) : (
          <p className={r.alert}>
            Elige un período que termine hoy o antes para ver las anulaciones.
          </p>
        )
      ) : report.total.base === 0 ? (
        <p className={r.alert}>Sin pedidos en el período.</p>
      ) : (
        <>
          {facts.truncated && (
            <p role="alert" className={r.warnText}>
              Lectura incompleta: hay más pedidos de los que se pudieron leer.
              Elige un período más corto.
            </p>
          )}
          <div className={r.heroMetrics}>
            <div className={r.metric}>
              <p>Anulación</p>
              <strong className={high(headlineRate) ? r.risk : undefined}>
                {pct(headlineRate)}
              </strong>
              {high(headlineRate) && (
                <span className={`${r.chip} ${r.chipRed}`}>Alta</span>
              )}
              <small>
                {report.hasOpenDays
                  ? headline
                    ? `Días cerrados (${count(headline.annulled)} de ${count(headline.base)}). Con los días abiertos ${pct(report.total.rate)}. `
                    : "Solo días abiertos: todavía puede subir. "
                  : ""}
                {report.hasOpenDays ? "Período completo: sin" : "Sin"}{" "}
                duplicados {pct(report.total.rateWithoutDuplicates)} · como en
                Gestión {pct(report.total.rateGestion)}
              </small>
            </div>
            <div className={r.metric}>
              <p>Anulados</p>
              <strong>{count(report.total.annulled)}</strong>
              <small>de {count(report.total.base)} pedidos</small>
            </div>
            <div className={r.metric}>
              <p>Fuera de la tasa</p>
              <strong>
                {count(report.total.replaced + report.total.notCounted)}
              </strong>
              <small>
                {count(report.total.replaced)} reemplazos por upsell o pruebas ·{" "}
                {count(report.total.notCounted)} en Testeos o Producto Agotado
              </small>
            </div>
          </div>
          <p className={r.caption}>
            Tasa = anulados ÷ pedidos creados, sin contar reemplazos por upsell,
            pruebas ni pedidos en Testeos o Producto Agotado. «Como en Gestión»
            también saca duplicados, número errado, error en el pedido, lista
            negra, agotados y fraude. Estado de iComfly al consultar.
          </p>

          <h3 className="mt-6">Por día</h3>
          <DailyBars days={report.days} />
          <p className={r.caption}>
            Barra roja: más de {pct(t.cancelRateAlert)}.
            {report.hasOpenDays &&
              " Barras claras: días recientes, todavía se pueden anular."}
          </p>

          <div className={`${r.alertGrid} mt-6`}>
            {CANCEL_BUCKETS.map((bucket) => (
              <div key={bucket}>
                <h3>
                  {CANCEL_BUCKET_LABEL[bucket]}: {count(report.buckets[bucket])}
                </h3>
                <p className={r.caption}>{BUCKET_HINT[bucket]}</p>
                {report.bucketReasons[bucket].length ? (
                  <ul className={r.alertList}>
                    {report.bucketReasons[bucket].map((reason) => (
                      <li
                        key={reason.code}
                        className={
                          bucket === "perdida"
                            ? `${r.alert} ${r.alertRisk}`
                            : r.alert
                        }
                      >
                        <strong>
                          {reason.label}: {count(reason.count)}
                        </strong>
                        {pct(reason.share)} de los anulados
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={r.alert}>Ninguno.</p>
                )}
              </div>
            ))}
          </div>

          <h3 className="mt-6">Por producto</h3>
          <p className={r.caption}>
            Un pedido con varios productos cuenta en cada uno. Solo productos
            con al menos 10 pedidos. Evitables = número errado o error en el
            pedido.
          </p>
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Anulación por producto"
          >
            <table className={r.cancelTable}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Pedidos</th>
                  <th>Anulados</th>
                  <th>Tasa</th>
                  <th>Evitables</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" title={row.title}>
                      {row.name}
                    </th>
                    <td>{count(row.orders)}</td>
                    <td>{count(row.annulled)}</td>
                    <td className={high(row.rate) ? r.risk : undefined}>
                      {pct(row.rate)}
                    </td>
                    <td>{count(row.avoidable)}</td>
                  </tr>
                ))}
                {!products.length && (
                  <tr>
                    <td colSpan={5}>Ningún producto llega a 10 pedidos.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {report.byProduct.length > PRODUCTS && (
            <button
              type="button"
              className="mt-2"
              onClick={() => setAllProducts(!allProducts)}
              aria-expanded={allProducts}
            >
              {allProducts
                ? "Ver menos"
                : `Ver todos (${count(report.byProduct.length)})`}
            </button>
          )}

          <div className={`${r.twoColumns} mt-6`}>
            <div>
              <h3>Por motivo</h3>
              <div
                className={r.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Anulaciones por motivo"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Motivo</th>
                      <th>Anulados</th>
                      <th>Parte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.reasons.map((reason) => (
                      <tr key={reason.code}>
                        <th scope="row">
                          {reason.label}
                          <small>{CANCEL_BUCKET_LABEL[reason.bucket]}</small>
                        </th>
                        <td>{count(reason.count)}</td>
                        <td>{pct(reason.share)}</td>
                      </tr>
                    ))}
                    {!report.reasons.length && (
                      <tr>
                        <td colSpan={3}>Sin anulados en el período.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3>Por origen</h3>
              <div
                className={r.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Anulación por origen del pedido"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Origen</th>
                      <th>Pedidos</th>
                      <th>Anulados</th>
                      <th>Tasa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byOrigin.map((row) => (
                      <tr key={row.origin}>
                        <th scope="row">{row.label}</th>
                        <td>{count(row.orders)}</td>
                        <td>{count(row.annulled)}</td>
                        <td className={high(row.rate) ? r.risk : undefined}>
                          {pct(row.rate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
