"use client";
import { useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { CharlieReport } from "@/lib/marketing-charlie-types";
import { count, shortDate } from "./format";
import { ChartLegend, ColumnChart, LineChart, SERIES_COLORS } from "./charts";
import r from "./team-report.module.css";
export function WeekdayChart({ data }: { data: MarketingSummary }) {
  return (
    <div>
      <h3>Pedidos por día de la semana</h3>
      <p className={r.caption}>Suma de cada día dentro del período.</p>
      <ColumnChart
        ariaLabel="Pedidos por día de la semana; valores en la tabla inferior"
        bins={data.weekdays.map((d) => ({
          key: d.name,
          label: d.name,
          title: d.name,
          stacks: [
            [
              {
                key: "orders",
                label: "pedidos",
                value: d.orders,
                color: "var(--mk-series-1)",
              },
            ],
          ],
        }))}
      />
      <details className={r.chartData}>
        <summary>Ver datos del gráfico</summary>
        <table>
          <tbody>
            {data.weekdays.map((d) => (
              <tr key={d.name}>
                <th scope="row">{d.name}</th>
                <td>{count(d.orders)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
export function TrendChart({ data }: { data: MarketingSummary }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const products = [
    ...(data.groupedProducts?.filter((p) => p.scope === "all") ??
      data.products),
  ]
    .sort((a, b) => b.orders - a.orders)
    .filter((p) => p.orders > 0)
    .slice(0, 3);
  // Color by rank among the three, so hiding one never repaints the rest.
  const color = (p: (typeof products)[number]) =>
    SERIES_COLORS[products.indexOf(p)];
  const visible = products.filter((p) => !hidden.includes(p.key));
  return (
    <div>
      <h3>Tendencia de pedidos por producto</h3>
      <p className={r.caption}>
        Los tres productos con más pedidos del período.
      </p>
      <ChartLegend
        label="Productos del gráfico"
        items={products.map((p) => ({
          key: p.key,
          name: p.name,
          color: color(p),
          mark: "line",
          hidden: hidden.includes(p.key),
        }))}
        onToggle={(key) =>
          setHidden((old) =>
            old.includes(key) ? old.filter((k) => k !== key) : [...old, key],
          )
        }
      />
      {products.length ? (
        <>
          <LineChart
            dates={data.daily.map((d) => d.date)}
            dateLabel={shortDate}
            ariaLabel="Tendencia diaria por producto; valores en la tabla inferior"
            series={visible.map((p) => ({
              key: p.key,
              name: p.name,
              color: color(p),
              values: data.daily.map((_, i) => p.daily[i]?.orders ?? 0),
            }))}
          />
          <details className={r.chartData}>
            <summary>Ver datos del gráfico</summary>
            <div
              className={r.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Valores diarios por producto"
            >
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    {products.map((p) => (
                      <th key={p.key}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d, i) => (
                    <tr key={d.date}>
                      <th scope="row">{shortDate(d.date)}</th>
                      {products.map((p) => (
                        <td key={p.key}>{p.daily[i]?.orders ?? 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p>Sin pedidos con producto identificado.</p>
      )}
    </div>
  );
}
export function AdDiagnostics({
  report,
  loading,
  error,
}: {
  report: CharlieReport | null;
  loading: boolean;
  error: string;
}) {
  const [page, setPage] = useState(0);
  const rows =
    report?.data?.accounts
      .flatMap((a) =>
        a.ads.map((ad) => {
          const clicks = ad.daily.reduce((n, d) => n + d.clicks, 0),
            purchases = ad.daily.reduce((n, d) => n + d.purchases, 0);
          return {
            key: `${a.id}:${ad.id}`,
            name: ad.name,
            account: a.name,
            clicks,
            purchases,
            rate: clicks ? purchases / clicks : 0,
          };
        }),
      )
      .filter((ad) => ad.clicks >= 100 && ad.rate < 0.01)
      .sort((a, b) => b.clicks - a.clicks) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 15)),
    current = Math.min(page, pages - 1);
  return (
    <>
      <p className={r.caption}>
        Señal de revisión: al menos 100 clics y menos de 1% de compras
        reportadas por clic. Incluye clics de la plataforma; no confirma visitas
        al sitio ni un problema de checkout.
      </p>
      {loading ? (
        <p role="status">
          Consultando métricas por anuncio. El resto del reporte está
          disponible.
        </p>
      ) : error || report?.status !== "ready" ? (
        <p role="alert">
          {error || report?.message || "No se pudo consultar el detalle."}
        </p>
      ) : (
        <>
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Anuncios con baja conversión"
          >
            <table>
              <thead>
                <tr>
                  <th>Anuncio</th>
                  <th>Cuenta</th>
                  <th>Clics</th>
                  <th>Compras reportadas</th>
                  <th>Compras / clics</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(current * 15, current * 15 + 15).map((ad) => (
                  <tr key={ad.key}>
                    <th scope="row">{ad.name}</th>
                    <td>{ad.account}</td>
                    <td>{count(ad.clicks)}</td>
                    <td>{count(ad.purchases)}</td>
                    <td>{(ad.rate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={5}>
                      No hay anuncios con esta señal en los datos consultados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={r.pagination}>
            <p>{rows.length} anuncios para revisar</p>
            <button
              disabled={!current}
              onClick={() => setPage(current - 1)}
              aria-label="Anuncios anteriores"
            >
              ←
            </button>
            <span>
              {current + 1}/{pages}
            </span>
            <button
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
              aria-label="Anuncios siguientes"
            >
              →
            </button>
          </div>
        </>
      )}
    </>
  );
}
