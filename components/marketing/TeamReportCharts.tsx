"use client";
import { useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { CharlieReport } from "@/lib/marketing-charlie-types";
import { count, shortDate } from "./format";
import r from "./team-report.module.css";
export function WeekdayChart({ data }: { data: MarketingSummary }) {
  const max = Math.max(1, ...data.weekdays.map((d) => d.orders));
  return (
    <div>
      <h3>Pedidos por día de la semana</h3>
      <p className={r.caption}>Suma de cada día dentro del período.</p>
      <div className={r.weekdays}>
        {data.weekdays.map((d) => (
          <div key={d.name}>
            <strong>{count(d.orders)}</strong>
            <div className={r.barTrack}>
              <div style={{ height: `${(d.orders / max) * 100}%` }} />
            </div>
            <span>{d.name}</span>
          </div>
        ))}
      </div>
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
const colors = ["var(--mk-chart-1)", "var(--mk-chart-2)", "var(--mk-chart-3)"];
export function TrendChart({ data }: { data: MarketingSummary }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const products = [
    ...(data.groupedProducts?.filter((p) => p.scope === "all") ??
      data.products),
  ]
    .sort((a, b) => b.orders - a.orders)
    .filter((p) => p.orders > 0)
    .slice(0, 3);
  const visible = products.filter((p) => !hidden.includes(p.key)),
    max = Math.max(1, ...visible.flatMap((p) => p.daily.map((d) => d.orders)));
  const x = (i: number) => 34 + (i / Math.max(1, data.daily.length - 1)) * 540,
    y = (v: number) => 170 - (v / max) * 140;
  return (
    <div>
      <h3>Tendencia de pedidos por producto</h3>
      <p className={r.caption}>
        Los tres productos con más pedidos del período.
      </p>
      <div className={r.legend}>
        {products.map((p, i) => (
          <button
            key={p.key}
            aria-pressed={!hidden.includes(p.key)}
            onClick={() =>
              setHidden((old) =>
                old.includes(p.key)
                  ? old.filter((k) => k !== p.key)
                  : [...old, p.key],
              )
            }
          >
            <span
              style={{
                background: colors[i],
                opacity: hidden.includes(p.key) ? 0.25 : 1,
              }}
            />
            {p.name}
          </button>
        ))}
      </div>
      {products.length ? (
        <>
          <svg
            viewBox="0 0 600 200"
            className={r.trend}
            role="img"
            aria-label="Tendencia diaria por producto; valores en la tabla inferior"
          >
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line
                  x1={34}
                  x2={574}
                  y1={y(max * t)}
                  y2={y(max * t)}
                  stroke="var(--mk-border)"
                />
                <text
                  x={25}
                  y={y(max * t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--mk-muted)"
                >
                  {Math.round(max * t)}
                </text>
              </g>
            ))}
            {visible.map((p) => (
              <g key={p.key}>
                <polyline
                  points={p.daily
                    .map((d, i) => `${x(i)},${y(d.orders)}`)
                    .join(" ")}
                  fill="none"
                  stroke={colors[products.indexOf(p)]}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                />
                {data.daily.length === 1 && (
                  <circle
                    cx={x(0)}
                    cy={y(p.orders)}
                    r={4}
                    fill={colors[products.indexOf(p)]}
                  />
                )}
              </g>
            ))}
            <text x={34} y={194} fontSize={11} fill="var(--mk-muted)">
              {shortDate(data.period.from)}
            </text>
            <text
              x={574}
              y={194}
              textAnchor="end"
              fontSize={11}
              fill="var(--mk-muted)"
            >
              {shortDate(data.period.to)}
            </text>
          </svg>
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
