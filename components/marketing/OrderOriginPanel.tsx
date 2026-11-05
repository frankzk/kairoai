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
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
const PRODUCTS = 15;

const SEGMENT: Record<OrderOrigin, string> = {
  shopify: r.originShopify,
  carrito: r.originCarrito,
  bot: r.originBot,
  ia: r.originIa,
  asesora: r.originAsesora,
  formulario: r.originFormulario,
};

function OriginLegend({ origins }: { origins: OrderOrigin[] }) {
  return (
    <ul className={r.originLegend} aria-label="Colores de cada origen">
      {origins.map((origin) => (
        <li key={origin}>
          <span className={SEGMENT[origin]} aria-hidden="true" />
          {ORDER_ORIGIN_LABEL[origin]}
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar per day (real orders by origin), with the numbers in text. */
function DailyOrigins({
  days,
  origins,
}: {
  days: OriginDay[];
  origins: OrderOrigin[];
}) {
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div
      className={r.cancelBarsWrap}
      tabIndex={0}
      role="region"
      aria-label="Pedidos reales por día y origen"
    >
      <ol className={r.cancelBars}>
        {days.map((day) => {
          const text = origins
            .filter((o) => day.byOrigin[o] > 0)
            .map((o) => `${ORDER_ORIGIN_LABEL[o]} ${count(day.byOrigin[o])}`)
            .join(", ");
          return (
            <li
              key={day.date}
              title={`${shortDate(day.date)}: ${text || "sin pedidos"}`}
            >
              <span className={r.cancelBarValue}>{count(day.total)}</span>
              <span className={r.originTrack} aria-hidden="true">
                {origins.map((origin) =>
                  day.byOrigin[origin] > 0 ? (
                    <span
                      key={origin}
                      className={SEGMENT[origin]}
                      style={{
                        height: `${(day.byOrigin[origin] / max) * 100}%`,
                      }}
                    />
                  ) : null,
                )}
              </span>
              <span className={r.cancelBarDate}>
                {shortDate(day.date)}
                <span className="sr-only">
                  : {text || "sin pedidos reales"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
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
          <p className={r.kicker}>04 / Origen y complementos</p>
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
          <OriginLegend origins={origins} />
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
