"use client";
import { useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingProductMetric } from "@/lib/marketing-intelligence";
import { count, shortDate } from "./format";
import s from "./dashboard.module.css";

export function OrdersChart({ data }: { data: MarketingSummary }) {
  const [selected, setSelected] = useState<string | null>(null);
  const bins =
    data.daily.length > 31
      ? data.weeks.map((week) => ({
          date: week.from,
          generated: week.generated,
        }))
      : data.daily;
  const max = Math.max(1, ...bins.map((day) => day.generated));
  const active = bins.find((day) => day.date === selected);
  return (
    <div>
      <div className={s.sectionHead}>
        <h2 className={s.heading}>Ritmo de pedidos</h2>
        <span className={s.muted} aria-live="polite">
          {active
            ? `${shortDate(active.date)}: ${count(active.generated)} pedidos`
            : `Máximo: ${count(max === 1 && !data.totals.generated ? 0 : max)}`}
        </span>
      </div>
      <div
        className={s.chart}
        style={{
          gridTemplateColumns: `repeat(${bins.length}, minmax(0, 1fr))`,
        }}
        aria-label={
          data.daily.length > 31
            ? "Pedidos por bloques de siete días"
            : "Pedidos por día"
        }
      >
        {bins.map((day) => (
          <button
            key={day.date}
            type="button"
            className={s.chartButton}
            aria-label={`${shortDate(day.date)}, ${day.generated} pedidos`}
            onMouseEnter={() => setSelected(day.date)}
            onFocus={() => setSelected(day.date)}
            onClick={() => setSelected(day.date)}
          >
            <span
              className={s.chartColumn}
              style={{ height: `${(day.generated / max) * 100}%` }}
            />
          </button>
        ))}
      </div>
      <div className={s.chartAxis}>
        <span>{shortDate(data.period.from)}</span>
        <span>
          {data.daily.length > 31
            ? "Bloques de 7 días"
            : "Pedidos creados por día"}
        </span>
        <span>{shortDate(data.period.to)}</span>
      </div>
      <details className="mt-3">
        <summary className={s.link}>Ver datos del gráfico</summary>
        <div className={`${s.tableWrap} mt-2 max-h-52`}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th className={s.numeric}>Pedidos</th>
                <th className={s.numeric}>Entregados</th>
                <th className={s.numeric}>Sin cierre</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((day) => (
                <tr key={day.date}>
                  <td>{shortDate(day.date)}</td>
                  <td className={s.numeric}>{count(day.generated)}</td>
                  <td className={s.numeric}>{count(day.delivered)}</td>
                  <td className={s.numeric}>{count(day.open)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
const colors = [
  "oklch(78% .11 165)",
  "oklch(79% .08 230)",
  "oklch(84% .12 85)",
];
export function ProductTrend({
  products,
  dates,
}: {
  products: MarketingProductMetric[];
  dates: string[];
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const selected = [...products]
    .filter((product) => product.orders > 0)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 3);
  const visible = selected.filter((product) => !hidden.includes(product.key));
  const max = Math.max(
    1,
    ...visible.flatMap((product) => product.daily.map((day) => day.orders)),
  );
  const x = (index: number) =>
    32 + (index / Math.max(1, dates.length - 1)) * 600;
  const y = (value: number) => 166 - (value / max) * 138;
  return (
    <div>
      <h2 className={s.heading}>Tendencia de productos</h2>
      <p className={s.muted}>
        Tres productos con más pedidos. Selecciona un nombre para mostrarlo u
        ocultarlo.
      </p>
      {!selected.length ? (
        <div className={`${s.empty} mt-4`}>
          El período no tiene pedidos con producto identificado.
        </div>
      ) : (
        <>
          <div className={s.legend}>
            {selected.map((product, index) => (
              <button
                key={product.key}
                className="text-left focus-visible:outline focus-visible:outline-2"
                aria-pressed={!hidden.includes(product.key)}
                onClick={() =>
                  setHidden((old) =>
                    old.includes(product.key)
                      ? old.filter((key) => key !== product.key)
                      : [...old, product.key],
                  )
                }
                style={{ opacity: hidden.includes(product.key) ? 0.4 : 1 }}
              >
                <span className={s.dot} style={{ background: colors[index] }} />
                {product.name}
              </button>
            ))}
          </div>
          <svg
            viewBox="0 0 660 200"
            role="img"
            aria-label="Pedidos diarios por producto, valores disponibles en la tabla inferior"
            className="w-full"
          >
            {[0, 0.5, 1].map((tick) => (
              <g key={tick}>
                <line
                  x1="32"
                  x2="632"
                  y1={y(max * tick)}
                  y2={y(max * tick)}
                  stroke="hsl(var(--border))"
                />
                <text
                  x="20"
                  y={y(max * tick) + 3}
                  fill="currentColor"
                  textAnchor="end"
                  fontSize="10"
                >
                  {Math.round(max * tick)}
                </text>
              </g>
            ))}
            {visible.map((product) => (
              <polyline
                key={product.key}
                points={product.daily
                  .map((day, index) => `${x(index)},${y(day.orders)}`)
                  .join(" ")}
                fill="none"
                stroke={
                  colors[selected.findIndex((item) => item.key === product.key)]
                }
                strokeWidth="2"
                strokeLinejoin="round"
              />
            ))}
            {dates.length === 1 &&
              visible.map((product) => (
                <circle
                  key={product.key}
                  cx={x(0)}
                  cy={y(product.orders)}
                  r="4"
                  fill={
                    colors[
                      selected.findIndex((item) => item.key === product.key)
                    ]
                  }
                />
              ))}
            <text x="32" y="192" fill="currentColor" fontSize="10">
              {shortDate(dates[0])}
            </text>
            <text
              x="632"
              y="192"
              fill="currentColor"
              textAnchor="end"
              fontSize="10"
            >
              {shortDate(dates[dates.length - 1])}
            </text>
          </svg>
          <details>
            <summary className={s.link}>Ver valores por producto</summary>
            <div className={`${s.tableWrap} max-h-60`}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    {selected.map((product) => (
                      <th key={product.key} className={s.numeric}>
                        {product.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dates.map((date) => (
                    <tr key={date}>
                      <td>{shortDate(date)}</td>
                      {selected.map((product) => (
                        <td key={product.key} className={s.numeric}>
                          {product.daily.find((day) => day.date === date)
                            ?.orders ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
