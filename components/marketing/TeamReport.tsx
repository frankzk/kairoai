"use client";
import { useMemo, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { CharlieReport, UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import { buildMarketingIntelligence } from "@/lib/marketing-intelligence";
import { marketingDate, periodQuery, shiftDate } from "@/lib/marketing-dates";
import { asUsd } from "@/lib/marketing-usd-rate";
import { productComparison, reportChannel } from "@/lib/marketing-team-report";
import { useResource } from "./useMarketing";
import { count, money, shortDate } from "./format";
import r from "./team-report.module.css";
import { CampaignGroups } from "./TeamReportCampaigns";
import { WeekdayChart, TrendChart, AdDiagnostics } from "./TeamReportCharts";

type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
const usd = (value: number | null | undefined) =>
  value == null ? "Sin datos" : money(value, "USD");
const number = (value: number | null | undefined) =>
  value == null ? "Sin datos" : count(value);
export function TeamReport({
  data,
  sources,
  settings,
  fx,
  model,
  loading,
  revision,
  recent,
  canEdit,
  saving,
  saved,
  save,
}: {
  data: MarketingSummary;
  sources: MarketingSources | null;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  model: MarketingIntelligence;
  loading: boolean;
  revision: number;
  recent: { data: MarketingSources | null; loading: boolean; error: string };
  canEdit: boolean;
  saving: string;
  saved: string;
  save: Save;
}) {
  const [query, setQuery] = useState("");
  const [ascending, setAscending] = useState(false);
  const [stockAscending, setStockAscending] = useState(true);
  const [stockKey, setStockKey] = useState("");
  const [campaignsOpen, setCampaignsOpen] = useState(false);
  const [adsOpen, setAdsOpen] = useState(false);
  const [comparisonPage, setComparisonPage] = useState(0);
  const today = marketingDate(),
    yesterday = shiftDate(today, -1);
  const budgets = useResource<MarketingSources>(
    campaignsOpen
      ? `/api/marketing/sources?${periodQuery(data.period)}&scope=details`
      : null,
    revision,
  );
  const ads = useResource<CharlieReport>(
    adsOpen
      ? `/api/marketing/charlie?${periodQuery(data.period)}&scope=ads`
      : null,
    revision,
  );
  const campaignSources = useMemo(
    () =>
      !budgets.data
        ? sources
        : {
            ...budgets.data,
            meta:
              budgets.data.meta.status === "ready"
                ? budgets.data.meta
                : (sources?.meta ?? budgets.data.meta),
            tiktok:
              budgets.data.tiktok.status === "ready"
                ? budgets.data.tiktok
                : (sources?.tiktok ?? budgets.data.tiktok),
          },
    [budgets.data, sources],
  );
  const campaignModel = useMemo(
    () => buildMarketingIntelligence(data, campaignSources, settings),
    [data, campaignSources, settings],
  );
  const comparisons = useMemo(
    () => productComparison(data, recent.data, settings, fx),
    [data, recent.data, settings, fx],
  );
  const meta = reportChannel(sources, "meta", fx),
    tiktok = reportChannel(sources, "tiktok", fx);
  const spend =
    meta.spend != null && tiktok.spend != null
      ? meta.spend + tiktok.spend
      : null;
  const aligned = Boolean(
    sources &&
    (["meta", "tiktok"] as const).every(
      (p) =>
        sources[p].status === "ready" &&
        sources[p].data?.accounts.every((a) => a.timezone === data.timezone),
    ),
  );
  const cpa =
    aligned && spend != null && data.totals.generated > 0
      ? spend / data.totals.generated
      : null;
  const products = [...model.products].sort(
    (a, b) => (ascending ? 1 : -1) * (a.orders - b.orders),
  );
  const stock =
    model.products.find((p) => p.key === stockKey) ?? model.products[0];
  const lowStock = [...model.products]
    .filter((p) => p.available != null && p.available < 100)
    .sort((a, b) => (stockAscending ? 1 : -1) * (a.available! - b.available!));
  const filtered = comparisons
    .filter((p) =>
      `${p.name} ${p.sku}`
        .toLocaleLowerCase("es")
        .includes(query.toLocaleLowerCase("es")),
    )
    .sort((a, b) => b.sevenDayOrders - a.sevenDayOrders);
  const pages = Math.max(1, Math.ceil(filtered.length / 5)),
    page = Math.min(comparisonPage, pages - 1),
    visible = filtered.slice(page * 5, page * 5 + 5);
  const highCpa = campaignModel.campaigns.filter((c) => {
    const value = asUsd(c.platformCpa, c.currency, fx);
    return value != null && value > 8.5;
  });
  const scaling = model.products.filter((p) => {
    const related = campaignModel.campaigns.filter(
      (c) => c.mapping?.product_key === p.key && c.spend > 0,
    );
    return (
      !model.ads.partial &&
      settings != null &&
      campaignModel.unmapped.length === 0 &&
      p.available != null &&
      p.available >= 100 &&
      related.length > 0 &&
      related.every(
        (c) =>
          c.purchases != null &&
          c.purchases >= 20 &&
          (asUsd(c.platformCpa, c.currency, fx) ?? Infinity) <= 8.5,
      )
    );
  });
  return (
    <div className={r.report}>
      <div className={r.reportHeading}>
        <div>
          <p className={r.kicker}>Reporte del equipo</p>
          <h2>Ventas, inversión y próximos pasos</h2>
        </div>
        <span className={r.period}>
          {shortDate(data.period.from)} — {shortDate(data.period.to)} · USD
        </span>
      </div>
      <section
        className={r.heroMetrics}
        aria-label="Resultados principales del período"
      >
        <Metric
          label="Total de ventas"
          value={count(data.totals.generated)}
          note="Pedidos creados · todas las fuentes"
        />
        <Metric
          label="CPA por pedido creado"
          value={loading ? "Consultando…" : usd(cpa)}
          note={
            aligned
              ? "Gasto total / pedidos creados"
              : "Calendarios de Meta y TikTok diferentes"
          }
        />
        <Metric
          label="Total de gasto en pauta"
          value={loading ? "Consultando…" : usd(spend)}
          note="Meta + TikTok · convertido a USD"
        />
      </section>
      <section className={r.channelMetrics} aria-label="Desglose por canal">
        <Metric
          label="Compras reportadas · Meta"
          value={loading ? "…" : number(meta.purchases)}
          note="Atribución de Meta, no pedidos de Kairo"
        />
        <Metric
          label="Conversiones reportadas · TikTok"
          value={loading ? "…" : number(tiktok.conversions)}
          note="Evento de conversión; no confirma una compra"
        />
        <Metric
          label="Orgánico / upsell"
          value="Sin atribuir"
          note="Origen pendiente de identificar"
        />
        <Metric
          label="Gasto · Meta Ads"
          value={loading ? "…" : usd(meta.spend)}
          note="Las cinco cuentas publicitarias"
        />
        <Metric
          label="Gasto · TikTok Ads"
          value={loading ? "…" : usd(tiktok.spend)}
          note="Datos enviados por Make o API"
        />
      </section>
      {!aligned && (
        <p className={r.explanation}>
          Los pedidos usan hora de Costa Rica; TikTok reporta con el calendario
          de su cuenta. El gasto se muestra convertido, pero el CPA combinado
          queda pendiente de alinear los días. Las compras de las plataformas no
          se suman como ventas de Kairo.
        </p>
      )}

      <section className={r.section}>
        <div className={r.sectionHead}>
          <div>
            <p className={r.kicker}>01 / Productos</p>
            <h2>Comparar para decidir</h2>
            <p>
              Hoy y ayer; los últimos 7 días completos hasta{" "}
              {shortDate(yesterday)}. Independiente del período superior.
            </p>
          </div>
          <label className={r.field}>
            Buscar producto
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setComparisonPage(0);
              }}
              placeholder="Nombre o SKU"
              type="search"
            />
          </label>
        </div>
        <div className={r.twoColumns}>
          <div>
            <h3>CPA general por producto</h3>
            <p className={r.caption}>
              Pauta de campañas asignadas / pedidos del producto. No atribuye
              cada venta.
            </p>
            <div
              className={r.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="CPA general por producto"
            >
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    {["Hoy", "Ayer", "7 días"].map((v) => (
                      <th key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.key}>
                      <th scope="row">
                        {p.name}
                        <small>{p.sku || "Sin SKU"}</small>
                      </th>
                      {p.cpas.map((v, i) => (
                        <td
                          key={i}
                          className={v != null && v > 8.5 ? r.risk : undefined}
                        >
                          {recent.loading ? "…" : usd(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!visible.length && (
                    <tr>
                      <td colSpan={4}>No hay productos que coincidan.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3>Cantidad de pedidos por producto</h3>
            <p className={r.caption}>
              Un pedido con varios productos aparece en cada producto; las filas
              no son aditivas.
            </p>
            <div
              className={r.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Pedidos por producto"
            >
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Hoy</th>
                    <th>Ayer</th>
                    <th>7 días</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.key}>
                      <th scope="row">
                        {p.name}
                        <small>{p.sku || "Sin SKU"}</small>
                      </th>
                      <td>{count(p.todayOrders)}</td>
                      <td>{count(p.yesterdayOrders)}</td>
                      <td>{count(p.sevenDayOrders)}</td>
                    </tr>
                  ))}
                  {!visible.length && (
                    <tr>
                      <td colSpan={4}>No hay productos que coincidan.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className={r.pagination}>
          <p>
            {recent.error ||
              "El CPA requiere asignaciones completas, moneda convertible y fechas comparables. Un dato pendiente no representa costo cero."}
          </p>
          <button
            disabled={page === 0}
            onClick={() => setComparisonPage(page - 1)}
            aria-label="Productos anteriores"
          >
            ←
          </button>
          <span>
            {page + 1} / {pages}
          </span>
          <button
            disabled={page === pages - 1}
            onClick={() => setComparisonPage(page + 1)}
            aria-label="Productos siguientes"
          >
            →
          </button>
        </div>
      </section>
      <section
        className={`${r.section} ${r.inventoryGrid}`}
        aria-label="Ventas e inventario"
      >
        <div>
          <div className={r.sectionHead}>
            <h3>Top en ventas</h3>
            <button
              onClick={() => setAscending(!ascending)}
              aria-label="Cambiar orden del ranking"
            >
              {ascending ? "Menor a mayor ↑" : "Mayor a menor ↓"}
            </button>
          </div>
          <ol className={r.ranking}>
            {products.slice(0, 5).map((p, i) => (
              <li key={p.key}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <span className={r.productName} title={p.name}>
                    {p.name}
                  </span>
                  <small>{p.sku || "Sin SKU"}</small>
                </div>
                <strong>{count(p.orders)}</strong>
              </li>
            ))}
          </ol>
          {!products.length && <p>Sin productos identificados en pedidos.</p>}
        </div>
        <div className={r.stockPanel}>
          <p className={r.kicker}>Inventario disponible</p>
          <h3>Stock para vender</h3>
          <label className={r.field}>
            Producto
            <select
              value={stock?.key ?? ""}
              onChange={(e) => setStockKey(e.target.value)}
            >
              {model.products.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <strong className={r.stockNumber}>{number(stock?.available)}</strong>
          <p>unidades disponibles · stock actual</p>
          <p className={r.caption}>
            {stock?.available == null
              ? "ShipHero pendiente o SKU sin coincidencia única."
              : stock.coverageDays != null
                ? `Cobertura estimada: ${stock.coverageDays.toFixed(1)} días con la demanda reciente.`
                : "Sin demanda reciente para estimar cobertura."}
          </p>
        </div>
        <div>
          <h3>Falta de stock</h3>
          <p className={r.caption}>Menos de 100 unidades disponibles.</p>
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Productos con stock bajo"
          >
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>
                    <button onClick={() => setStockAscending(!stockAscending)}>
                      Unidades {stockAscending ? "↑" : "↓"}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((p) => (
                  <tr key={p.key}>
                    <th scope="row">{p.name}</th>
                    <td className={r.risk}>{count(p.available!)}</td>
                  </tr>
                ))}
                {!lowStock.length && (
                  <tr>
                    <td colSpan={2}>
                      {sources?.shiphero.status !== "ready"
                        ? "Inventario pendiente de conexión."
                        : "Sin alertas entre los SKU identificados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={r.section}>
        <div className={r.sectionHead}>
          <div>
            <p className={r.kicker}>02 / Pauta</p>
            <h2>Campañas, presupuesto y producto</h2>
            <p>
              Las cinco cuentas de Meta y TikTok. Presupuesto diario vigente,
              aunque el período sea histórico.
            </p>
          </div>
          <span className={r.pill}>
            {campaignModel.assignedCampaigns} campañas asignadas
          </span>
        </div>
        <details
          className={r.disclosure}
          onToggle={(e) => setCampaignsOpen(e.currentTarget.open)}
        >
          <summary>
            Ver cuentas y asignar productos{" "}
            <span>CPA · presupuesto diario · gasto</span>
          </summary>
          {campaignsOpen && (
            <>
              <p className={r.caption}>
                {budgets.loading
                  ? "Consultando presupuestos actuales; puedes revisar el gasto mientras se completa."
                  : budgets.error ||
                    (budgets.data?.meta.status === "error"
                      ? "No se pudieron cargar los presupuestos de Meta; se conserva el gasto consultado. "
                      : "") +
                      "CPA de campaña = gasto / compras reportadas por la plataforma. No equivale al CPA por pedido creado."}
              </p>
              <CampaignGroups
                sources={campaignSources}
                model={campaignModel}
                catalog={data.catalog}
                fx={fx}
                ready={canEdit}
                loading={budgets.loading}
                saving={saving}
                saved={saved}
                save={save}
              />
              {!campaignModel.campaigns.length && (
                <p>Sin campañas consultables para este período.</p>
              )}
            </>
          )}
        </details>
      </section>
      <section className={r.section}>
        <div className={r.sectionHead}>
          <div>
            <p className={r.kicker}>03 / Tendencias</p>
            <h2>Cómo se mueve la demanda</h2>
            <p>
              Pedidos creados en el período seleccionado · hora de Costa Rica.
            </p>
          </div>
        </div>
        <div className={r.twoColumns}>
          <WeekdayChart data={data} />
          <TrendChart data={data} />
        </div>
      </section>
      <section className={r.section}>
        <div className={r.sectionHead}>
          <div>
            <p className={r.kicker}>04 / Atención</p>
            <h2>Oportunidades y riesgos</h2>
            <p>CPA objetivo: US$8.50 · Stock mínimo: 100 unidades.</p>
          </div>
        </div>
        <div className={r.alertGrid}>
          <div>
            <h3>Revisar para escalar</h3>
            {scaling.length ? (
              scaling.slice(0, 5).map((p) => (
                <p key={p.key} className={r.alert}>
                  <strong>{p.name}</strong>Stock ≥100; campañas con ≥20 compras
                  reportadas y CPA ≤US$8.50. Validar margen y atribución antes
                  de subir presupuesto.
                </p>
              ))
            ) : (
              <p className={r.alert}>
                Sin oportunidades verificables todavía. Se necesitan compras
                suficientes, campañas asignadas y stock confirmado.
              </p>
            )}
          </div>
          <div>
            <h3>CPA por encima del objetivo</h3>
            {highCpa.length ? (
              highCpa.slice(0, 5).map((c) => (
                <p key={c.key} className={`${r.alert} ${r.alertRisk}`}>
                  <strong>{c.name}</strong>
                  {usd(asUsd(c.platformCpa, c.currency, fx))} por compra
                  reportada · {c.accountName}
                </p>
              ))
            ) : (
              <p className={r.alert}>
                {loading
                  ? "Consultando campañas…"
                  : "Sin alertas en las campañas con CPA consultable."}
              </p>
            )}
          </div>
          <div>
            <h3>Preparar reposición</h3>
            {model.products
              .filter((p) => (p.suggestedUnits ?? 0) > 0)
              .slice(0, 5)
              .map((p) => (
                <p key={p.key} className={r.alert}>
                  <strong>{p.name}</strong>
                  {count(p.suggestedUnits!)} unidades sugeridas ·{" "}
                  {p.plan?.supplier || "Proveedor pendiente"}
                </p>
              ))}
            <p className={r.caption}>
              Configura proveedor, plazo y cobertura en «Tendencias y
              reposición». La sugerencia requiere stock real; no genera compras
              automáticas.
            </p>
            {lowStock.length > 0 && (
              <p className={r.risk}>
                {lowStock.length} productos por debajo del mínimo.
              </p>
            )}
          </div>
        </div>
        <details
          className={r.disclosure}
          onToggle={(e) => setAdsOpen(e.currentTarget.open)}
        >
          <summary>
            Anuncios con muchos clics y pocas compras{" "}
            <span>Consultar detalle por anuncio</span>
          </summary>
          {adsOpen && (
            <AdDiagnostics
              report={ads.data}
              loading={ads.loading}
              error={ads.error}
            />
          )}
        </details>
      </section>
      <p className={r.explanation}>
        Las ventas son pedidos creados e incluyen anulados. El stock y los
        presupuestos son actuales. Los importes CRC y PEN se reexpresan en USD
        con la referencia indicada arriba; no representan cobros ni utilidad
        final.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className={r.metric}>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
