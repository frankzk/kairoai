"use client";
import { useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import type { MarketingSources } from "@/lib/marketing-source-types";
import { count, money, percentage, shortDate } from "./format";
import { OrdersChart, ProductTrend } from "./MarketingCharts";
import { CampaignPriorityList } from "./CampaignWorkspace";
import s from "./dashboard.module.css";

export function AlertList({
  model,
  limit = 6,
  expand = false,
}: {
  model: MarketingIntelligence;
  limit?: number;
  expand?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(limit);
  const alerts = model.alerts.filter(
    (alert) => !filter || alert.tone === filter,
  );
  return (
    <div>
      {expand && (
        <label className={`${s.field} mb-4`}>
          Tipo de señal
          <select
            className={`${s.control} w-fit`}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setVisible(limit);
            }}
          >
            <option value="">Todas las señales</option>
            <option value="risk">Riesgos</option>
            <option value="opportunity">Oportunidades</option>
            <option value="info">Datos por completar</option>
          </select>
        </label>
      )}
      {!alerts.length ? (
        <div className={s.empty}>
          No hay señales de este tipo con los datos disponibles. Las alertas de
          inventario necesitan ShipHero conectado y las de costo por producto
          necesitan campañas asignadas.
        </div>
      ) : (
        <ul className={s.list}>
          {alerts.slice(0, visible).map((alert) => (
            <li key={alert.key} className={s.listItem}>
              <span
                className={`${s.badge} ${alert.tone === "risk" ? s.warn : alert.tone === "opportunity" ? s.good : ""}`}
              >
                {alert.tone === "risk"
                  ? "Revisar"
                  : alert.tone === "opportunity"
                    ? "Oportunidad"
                    : "Completar datos"}
              </span>
              <h3 className={`${s.listTitle} mt-2`}>{alert.title}</h3>
              <p className={s.muted}>{alert.detail}</p>
            </li>
          ))}
        </ul>
      )}
      {expand && alerts.length > visible && (
        <button
          className={`${s.button} mt-4`}
          onClick={() => setVisible((value) => value + 20)}
        >
          Mostrar más señales ({alerts.length - visible})
        </button>
      )}
    </div>
  );
}
export function Overview({
  data,
  model,
  sourcesLoading,
  go,
}: {
  data: MarketingSummary;
  model: MarketingIntelligence;
  sourcesLoading: boolean;
  go: (view: "details" | "trends" | "sources") => void;
}) {
  const { totals } = data,
    { ads } = model;
  const growth =
    data.previous.generated > 0
      ? (totals.generated - data.previous.generated) / data.previous.generated
      : null;
  const top = [...model.products]
    .filter((product) => product.orders > 0)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 6);
  const coverage = ads.accountCount
    ? `${ads.providers.join(" + ")} · ${ads.accountCount} cuentas${ads.partial ? " · Parcial" : ""}`
    : "Sin cuentas consultables";
  return (
    <>
      <dl className={s.metrics}>
        {[
          [
            "Pedidos creados",
            count(totals.generated),
            growth == null
              ? "Sin base anterior comparable"
              : `${growth > 0 ? "+" : ""}${percentage(growth)} vs período anterior`,
          ],
          [
            "Costo / pedido creado",
            sourcesLoading
              ? "Consultando…"
              : money(ads.costPerGenerated, ads.currency),
            "Inversión consultada / todos los pedidos",
          ],
          [
            "Inversión publicitaria",
            sourcesLoading
              ? "Consultando…"
              : ads.breakdown.length > 1
                ? "Varias monedas"
                : money(ads.spend, ads.currency),
            coverage,
          ],
          [
            "Entregados",
            count(totals.delivered),
            `${percentage(totals.deliveryRate)} de los creados`,
          ],
          [
            "Pedidos sin cierre",
            count(totals.open),
            `${count(data.quality.recentOpen)} tienen menos de 14 días`,
          ],
        ].map(([label, value, note]) => (
          <div key={label} className={s.metric}>
            <dt>{label}</dt>
            <dd className={s.value}>{value}</dd>
            <dd>
              <small>{note}</small>
            </dd>
          </div>
        ))}
      </dl>
      <div className={s.split}>
        <section className={s.section}>
          <OrdersChart data={data} />
          <div className={`${s.toolbar} mt-6 justify-between`}>
            <span className={s.muted}>
              Anterior: {shortDate(data.previous.from)} al{" "}
              {shortDate(data.previous.to)} · {count(data.previous.generated)}{" "}
              pedidos
            </span>
            <span className={s.muted}>Hoy puede estar en curso</span>
          </div>
        </section>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.heading}>Atención de la operación</h2>
            <button className={s.link} onClick={() => go("trends")}>
              Ver todas
            </button>
          </div>
          <AlertList model={model} limit={3} />
        </section>
      </div>
      <div className={s.split}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.heading}>Productos que mueven la operación</h2>
            <button className={s.link} onClick={() => go("details")}>
              Productos y campañas
            </button>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <caption className="sr-only">
                Seis productos con más pedidos en el período
              </caption>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className={s.numeric}>Pedidos</th>
                  <th className={s.numeric}>Costo / pedido</th>
                  <th className={s.numeric}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {top.map((product) => (
                  <tr key={product.key}>
                    <td>
                      <span className="block font-medium">{product.name}</span>
                      <span className={s.muted}>
                        {product.sku || "Sin SKU"}
                      </span>
                    </td>
                    <td className={s.numeric}>{count(product.orders)}</td>
                    <td
                      className={`${s.numeric} ${product.currency === "USD" && (product.cpa ?? 0) > 8.5 ? s.warn : ""}`}
                    >
                      {money(product.cpa, product.currency)}
                    </td>
                    <td
                      className={`${s.numeric} ${product.available != null && product.available < 100 ? s.warn : ""}`}
                    >
                      {product.available == null
                        ? "Sin datos"
                        : count(product.available)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!top.length && (
            <div className={s.empty}>
              No hay pedidos con productos identificados en este período.
            </div>
          )}
        </section>
        <section className={s.section}>
          <h2 className={s.heading}>Inversión y cobertura</h2>
          <dl className={`${s.list} mt-4`}>
            {["meta", "tiktok"].map((key) => {
              const platform = key as "meta" | "tiktok";
              const rows = model.campaigns.filter(
                (campaign) => campaign.platform === platform,
              );
              const currencies = Array.from(
                new Set(rows.map((campaign) => campaign.currency)),
              );
              return (
                <div
                  key={key}
                  className={`${s.listItem} flex justify-between gap-4 text-xs`}
                >
                  <dt>{key === "meta" ? "Meta Ads" : "TikTok Ads"}</dt>
                  <dd className="text-right tabular-nums">
                    {sourcesLoading
                      ? "Consultando…"
                      : currencies.length
                        ? currencies.map((currency) => (
                            <span key={currency} className="block">
                              {money(
                                rows
                                  .filter((row) => row.currency === currency)
                                  .reduce((sum, row) => sum + row.spend, 0),
                                currency,
                              )}
                            </span>
                          ))
                        : "Sin reporte disponible"}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className={`${s.muted} mt-4`}>
            Los pedidos incluyen todos los canales. El origen Meta, TikTok,
            orgánico o upsell sigue sin atribuir hasta registrar ese vínculo en
            cada pedido. Las compras publicitarias no se suman como ventas
            únicas.
          </p>
          <button className={`${s.link} mt-3`} onClick={() => go("sources")}>
            Revisar fuentes y conexiones
          </button>
        </section>
      </div>
      <details className={`${s.section} border-t border-border pt-4`}>
        <summary className={s.link}>
          Estado de pedidos y registros financieros en CRC
        </summary>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <dl className={s.list}>
            {[
              ["Con guía", count(totals.withGuide)],
              ["No entregados", count(totals.failed)],
              ["Anulados", count(totals.annulled)],
              ["Neto en liquidaciones", money(totals.settlementNet, "CRC")],
              ["Publicidad manual", money(totals.registeredAdSpend, "CRC")],
              [
                "Margen registrado antes de publicidad",
                money(totals.recordedMargin, "CRC"),
              ],
              [
                "Saldo parcial después de publicidad manual",
                money(totals.partialBalance, "CRC"),
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className={`${s.listItem} flex justify-between gap-3 text-xs`}
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className={s.muted}>
            Con guía no acredita salida física. Las liquidaciones no prueban un
            depósito bancario. Los gastos manuales CRC permanecen separados de
            los reportes publicitarios para evitar duplicados y conversiones de
            moneda. El saldo es parcial, no utilidad final.
            <p className="mt-3">
              {count(data.quality.deliveredWithoutSettlement)} entregados sin
              liquidación; {count(data.quality.duplicateSettlements)} con
              liquidaciones múltiples, excluidos de importes;{" "}
              {count(data.quality.missingCosts)} liquidados sin costo completo.
            </p>
          </div>
        </div>
      </details>
    </>
  );
}
export function Trends({
  data,
  model,
}: {
  data: MarketingSummary;
  model: MarketingIntelligence;
}) {
  const max = Math.max(1, ...data.weekdays.map((day) => day.orders));
  return (
    <>
      <div className={s.split}>
        <section className={s.section}>
          <ProductTrend
            products={model.products}
            dates={data.daily.map((day) => day.date)}
          />
        </section>
        <section className={s.section}>
          <h2 className={s.heading}>Pedidos por día de la semana</h2>
          <p className={`${s.muted} mt-1`}>
            Totales del rango seleccionado. No son promedios por día.
          </p>
          <ul className="mt-4 space-y-3">
            {data.weekdays.map((day) => (
              <li
                key={day.name}
                className="grid grid-cols-[35px_1fr_55px] items-center gap-3 text-xs"
              >
                <span>{day.name}</span>
                <div className={s.bar}>
                  <div
                    className={s.barFill}
                    style={{ width: `${(day.orders / max) * 100}%` }}
                  />
                </div>
                <span className={s.numeric}>{count(day.orders)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className={s.split}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.heading}>Oportunidades y riesgos</h2>
            <span className={s.muted}>
              {count(model.alerts.length)} señales con datos disponibles
            </span>
          </div>
          <AlertList model={model} limit={20} expand />
        </section>
        <section className={s.section}>
          <CampaignPriorityList model={model} />
          <h3 className={`${s.heading} mt-7`}>Límites para decidir</h3>
          <p className={`${s.muted} mt-3`}>
            CPA máximo: USD 8.50. Stock mínimo: 100 unidades. Una tendencia
            favorable es una señal para revisar, no una orden de aumentar
            presupuesto. Los períodos que incluyen hoy están en curso y las
            entregas siguen cambiando.
          </p>
        </section>
      </div>
    </>
  );
}
export function SourceConnections({
  sources,
  loading,
}: {
  sources: MarketingSources | null;
  loading: boolean;
}) {
  const rows = [
    {
      key: "meta" as const,
      name: "Meta Ads",
      detail:
        "Cinco cuentas exclusivas de Costa Rica. Inversión por período, presupuesto diario actual, clics y compras reportadas.",
      needs: "Revisar token y acceso de lectura a las cinco cuentas.",
    },
    {
      key: "tiktok" as const,
      name: "TikTok Ads",
      detail:
        "Inversión, clics e impresiones en la moneda y calendario de su cuenta.",
      needs: "Falta el ID del anunciante y el acceso API.",
    },
    {
      key: "shiphero" as const,
      name: "ShipHero",
      detail:
        "Stock actual por coincidencia única de SKU. Se necesita para calcular cobertura y reposición.",
      needs:
        "Falta acceso API, cuenta y almacén de Costa Rica. El usuario y contraseña de la web no son un token API.",
    },
  ];
  return (
    <section className={s.section}>
      <h2 className={s.heading}>Fuentes y disponibilidad</h2>
      <p className={`${s.muted} mt-2 mb-5`}>
        Pedidos, logística y liquidaciones proceden de la conciliación de
        Gestión. Los anuncios y el stock se consultan con sus conexiones
        independientes.
      </p>
      <div className={s.tableWrap}>
        <table className={`${s.table} min-w-[650px]`}>
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Estado</th>
              <th>Datos disponibles</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const source = sources?.[row.key];
              return (
                <tr key={row.key}>
                  <td className="font-medium">{row.name}</td>
                  <td className={source?.status === "ready" ? s.good : s.warn}>
                    {loading
                      ? "Consultando…"
                      : source?.status === "ready"
                        ? "Conectado"
                        : source?.status === "error"
                          ? "Error de consulta"
                          : "Pendiente"}
                  </td>
                  <td className={s.muted}>
                    {row.detail}
                    {!loading && source?.status !== "ready" && (
                      <p className="mt-2">{row.needs}</p>
                    )}
                    {source?.checkedAt && (
                      <p className="mt-2 text-[10px]">
                        Última consulta:{" "}
                        {new Intl.DateTimeFormat("es-CR", {
                          timeZone: "America/Costa_Rica",
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(source.checkedAt))}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
