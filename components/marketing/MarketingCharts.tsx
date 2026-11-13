"use client";
import { useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingProductMetric } from "@/lib/marketing-intelligence";
import { count, shortDate } from "./format";
import { ChartLegend, ColumnChart, LineChart, SERIES_COLORS } from "./charts";
import s from "./dashboard.module.css";

export function OrdersChart({ data }: { data: MarketingSummary }) {
  const [selected, setSelected] = useState<string | null>(null);
  const weekly = data.daily.length > 31;
  const bins: Array<{
    date: string;
    generated: number;
    delivered?: number;
    open?: number;
  }> = weekly
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
      <ColumnChart
        bins={bins.map((day) => ({
          key: day.date,
          label: shortDate(day.date),
          title: weekly ? `Semana del ${shortDate(day.date)}` : shortDate(day.date),
          stacks: [
            [
              {
                key: "generated",
                label: "pedidos",
                value: day.generated,
                color: "var(--mk-series-1)",
              },
            ],
          ],
          notes:
            day.delivered != null
              ? [
                  `${count(day.delivered)} entregados · ${count(day.open ?? 0)} sin cierre`,
                ]
              : undefined,
        }))}
        ariaLabel={weekly ? "Pedidos por bloques de siete días" : "Pedidos por día"}
        onActive={(index) => setSelected(index == null ? null : bins[index].date)}
      />
      <p className={s.chartAxis}>
        {weekly ? "Bloques de 7 días" : "Pedidos creados por día"}
      </p>
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
  // The color follows the product (its rank among the three), not the visible
  // count: hiding one never repaints the others.
  const color = (key: string) =>
    SERIES_COLORS[selected.findIndex((item) => item.key === key)];
  const visible = selected.filter((product) => !hidden.includes(product.key));
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
          <ChartLegend
            label="Productos del gráfico"
            items={selected.map((product) => ({
              key: product.key,
              name: product.name,
              color: color(product.key),
              mark: "line",
              hidden: hidden.includes(product.key),
            }))}
            onToggle={(key) =>
              setHidden((old) =>
                old.includes(key)
                  ? old.filter((item) => item !== key)
                  : [...old, key],
              )
            }
          />
          <LineChart
            dates={dates}
            dateLabel={shortDate}
            ariaLabel="Pedidos diarios por producto, valores disponibles en la tabla inferior"
            series={visible.map((product) => ({
              key: product.key,
              name: product.name,
              color: color(product.key),
              values: dates.map(
                (date) =>
                  product.daily.find((day) => day.date === date)?.orders ?? 0,
              ),
            }))}
          />
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
