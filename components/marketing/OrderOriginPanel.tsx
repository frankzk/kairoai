"use client";
import { useMemo, useState } from "react";
import {
  ORDER_ORIGINS,
  ORDER_ORIGIN_LABEL,
  type OrderFactsPayload,
  type OrderOrigin,
} from "@/lib/marketing-insights-types";
import {
  buildComplements,
  buildOriginMix,
  type OriginDay,
} from "@/lib/marketing-origin-mix";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, percentage, shortDate } from "./format";
import { ChartLegend, ColumnChart } from "./charts";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
const PRODUCTS = 15;

/**
 * Fixed color per origin (stacked bottom → top in ORDER_ORIGINS order). Shopify
 * takes the background gray; the four others follow the categorical order,
 * validated as neighbors in this stack. "Carrito recuperado" shares slot 2 with
 * the simulator's recovered carts.
 */
const ORIGIN_COLOR: Record<OrderOrigin, string> = {
  shopify: "var(--mk-other)",
  carrito: "var(--mk-series-2)",
  bot: "var(--mk-series-1)",
  asesora: "var(--mk-series-3)",
  formulario: "var(--mk-series-4)",
};

/** One stacked column per day (real orders by origin) and its table. */
function DailyOrigins({
  days,
  origins,
}: {
  days: OriginDay[];
  origins: OrderOrigin[];
}) {
  return (
    <>
      <ChartLegend
        label="Colores de cada origen"
        items={origins.map((origin) => ({
          key: origin,
          name: ORDER_ORIGIN_LABEL[origin],
          color: ORIGIN_COLOR[origin],
        }))}
      />
      <ColumnChart
        ariaLabel="Pedidos reales por día y origen; cifras en la tabla inferior"
        bins={days.map((day) => ({
          key: day.date,
          label: shortDate(day.date),
          title: shortDate(day.date),
          stacks: [
            origins.map((origin) => ({
              key: origin,
              label: ORDER_ORIGIN_LABEL[origin],
              value: day.byOrigin[origin],
              color: ORIGIN_COLOR[origin],
            })),
          ],
          notes: day.total ? undefined : ["Sin pedidos reales"],
        }))}
      />
      <details className={r.chartData}>
        <summary>Ver datos del gráfico</summary>
        <div
          className={r.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Pedidos reales por día y origen"
        >
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                {origins.map((origin) => (
                  <th key={origin}>{ORDER_ORIGIN_LABEL[origin]}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{shortDate(day.date)}</th>
                  {origins.map((origin) => (
                    <td key={origin}>{count(day.byOrigin[origin])}</td>
                  ))}
                  <td>{count(day.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

/** "Origen de los pedidos y complementos" (módulo 8), section 04 of Análisis. */
export function OrderOriginPanel({
  orders,
}: {
  orders: Resource<OrderFactsPayload>;
}) {
  const [allProducts, setAllProducts] = useState(false);
  const facts = orders.data;
  const mix = useMemo(
    () => (facts ? buildOriginMix(facts, facts.from, facts.to) : null),
    [facts],
  );
  const complements = useMemo(
    () =>
      facts ? buildComplements(facts, facts.from, facts.to, facts.today) : null,
    [facts],
  );
  const origins = useMemo(
    () =>
      mix
        ? ORDER_ORIGINS.filter((o) => mix.rows.some((row) => row.origin === o))
        : [],
    [mix],
  );
  const mostly = complements?.products.filter((p) => p.mostlyComplement) ?? [];
  const products = complements
    ? allProducts
      ? complements.products
      : complements.products.slice(0, PRODUCTS)
    : [];
  return (
    <section
      id="analisis-origen"
      className={r.section}
      aria-labelledby="origin-title"
    >
      <div className={r.sectionHead}>
        <div>
          <h2 id="origin-title">Origen de los pedidos y complementos</h2>
          <p>
            De dónde entran los pedidos reales y qué productos se venden solos o
            como complemento de otro.
          </p>
        </div>
        {mix && (
          <span className={r.period}>
            {shortDate(mix.from)} – {shortDate(mix.to)}
          </span>
        )}
      </div>
      {orders.loading && !facts ? (
        <p role="status">Consultando los pedidos de iComfly…</p>
      ) : !facts || !mix || !complements ? (
        orders.error ? (
          <p role="alert" className={r.risk}>
            No se pudieron leer los pedidos de iComfly. {orders.error}
          </p>
        ) : (
          <p className={r.alert}>
            Elige un período que termine hoy o antes para ver el origen de los
            pedidos.
          </p>
        )
      ) : mix.total === 0 ? (
        <p className={r.alert}>Sin pedidos en el período.</p>
      ) : (
        <>
          {facts.truncated && (
            <p role="alert" className={r.warnText}>
              Lectura incompleta: hay más pedidos de los que se pudieron leer.
              Elige un período más corto.
            </p>
          )}
          {complements.drops.length > 0 && (
            <ul className={r.alertList} aria-label="Avisos de complementos">
              {complements.drops.map((drop) => (
                <li
                  key={drop.id}
                  className={`${r.alert} ${r.alertRisk}`}
                  title={drop.fullName}
                >
                  <span className={`${r.chip} ${r.chipRed}`}>Cayó</span>{" "}
                  <strong>{drop.title}</strong>
                  {drop.detail}
                </li>
              ))}
            </ul>
          )}

          <div className={`${r.twoColumns} mt-6`}>
            <div>
              <h3>Origen de los pedidos</h3>
              <div
                className={r.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Pedidos por origen"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Origen</th>
                      <th>Pedidos reales</th>
                      <th>%</th>
                      <th>Creados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mix.rows.map((row) => (
                      <tr key={row.origin}>
                        <th scope="row">{row.label}</th>
                        <td>{count(row.real)}</td>
                        <td>{percentage(row.share)}</td>
                        <td>{count(row.created)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={r.caption}>
                {count(mix.real)} pedidos reales de {count(mix.total)} creados
                (sin anulados ni Testeos o Producto Agotado).
                {mix.shopifyEnded &&
                  ` Último pedido de Shopify: ${shortDate(mix.shopifyEnded)}; desde ahí todo entra por iComfly.`}
              </p>
            </div>
            <div>
              <h3>Combos</h3>
              <div className={r.heroMetrics}>
                <div className={r.metric}>
                  <p>Pedidos con combo</p>
                  <strong>{percentage(complements.comboRate)}</strong>
                  <small>
                    {count(complements.combos)} de {count(complements.orders)}{" "}
                    pedidos reales
                  </small>
                </div>
              </div>
              <h3 className="mt-6">Pares más vendidos</h3>
              {complements.pairs.length ? (
                <ol className={r.pairList}>
                  {complements.pairs.map((pair) => (
                    <li key={`${pair.principalId}:${pair.complementId}`}>
                      <span>
                        {pair.principal} + {pair.complement}
                      </span>
                      <strong>{count(pair.orders)}</strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={r.alert}>Sin pedidos con combo en el período.</p>
              )}
            </div>
          </div>

          <h3 className="mt-6">Pedidos reales por día</h3>
          <DailyOrigins days={mix.daily} origins={origins} />

          <h3 className="mt-6">Cómo se vende cada producto</h3>
          {mostly.length > 0 && (
            <ul className={r.alertList} aria-label="Se venden como complemento">
              {mostly.map((p) => (
                <li key={p.id} className={r.alert} title={p.fullName}>
                  <span className={`${r.chip} ${r.chipYellow}`}>
                    Complemento
                  </span>{" "}
                  <strong>
                    {p.name}: {percentage(p.complementShare)} como complemento
                  </strong>
                  Se vende como complemento: el CPA de su campaña engaña.
                </li>
              ))}
            </ul>
          )}
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Cómo se vende cada producto"
          >
            <table className={r.cancelTable}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Pedidos</th>
                  <th>Como principal</th>
                  <th>Como complemento</th>
                  <th>% complemento</th>
                </tr>
              </thead>
              <tbody>
                {products.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" title={row.fullName}>
                      {row.name}
                      {row.mostlyComplement && (
                        <div className={r.chips}>
                          <span className={`${r.chip} ${r.chipYellow}`}>
                            Se vende como complemento
                          </span>
                        </div>
                      )}
                    </th>
                    <td>{count(row.orders)}</td>
                    <td>{count(row.asPrincipal)}</td>
                    <td>{count(row.asComplement)}</td>
                    <td>{percentage(row.complementShare)}</td>
                  </tr>
                ))}
                {!products.length && (
                  <tr>
                    <td colSpan={5}>Sin productos en los pedidos reales.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {complements.products.length > PRODUCTS && (
            <button
              type="button"
              className="mt-2"
              onClick={() => setAllProducts(!allProducts)}
              aria-expanded={allProducts}
            >
              {allProducts
                ? "Ver menos"
                : `Ver todos (${count(complements.products.length)})`}
            </button>
          )}
          <p className={r.caption}>
            Principal = primer producto del pedido en iComfly; complemento = los
            demás. El mismo producto varias veces es oferta de cantidad, no
            combo. «Se vende como complemento»:{" "}
            {percentage(t.complementShareHigh)} o más de sus pedidos (desde{" "}
            {count(t.complementMinOrders)}).
            {complements.dropWeeks
              ? ` Caída: semana del ${shortDate(complements.dropWeeks.from)} al ${shortDate(complements.dropWeeks.to)} contra el promedio de las 4 anteriores; avisa si baja a la mitad o menos (desde ${count(t.complementDropMinWeekly)} por semana).`
              : " Sin 5 semanas de pedidos para comparar caídas."}{" "}
            Origen según etiquetas y canal de iComfly (Venta por bot, Carrito
            abandonado recuperado) y quién creó el pedido.
          </p>
        </>
      )}
    </section>
  );
}
