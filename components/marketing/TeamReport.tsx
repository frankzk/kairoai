"use client";
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { CharlieReport, UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type { Coverage } from "@/lib/marketing-coverage";
import type { AccountsPayload } from "@/lib/marketing-insights-types";
import { buildMarketingIntelligence } from "@/lib/marketing-intelligence";
import { marketingDate, periodQuery, shiftDate } from "@/lib/marketing-dates";
import { productComparison, reportChannel } from "@/lib/marketing-team-report";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import {
  buildRealEstimate,
  channelOrders,
  realCpa,
} from "@/lib/marketing-real-cpa";
import { buildDailyPace } from "@/lib/marketing-pace";
import { buildKeywordIndex } from "@/lib/marketing-campaign-keywords";
import { highCpaAlerts, stockDaysRows } from "@/lib/marketing-report-alerts";
import {
  decimalText,
  periodIncludesToday,
  periodIsToday,
  periodLabelText,
} from "@/lib/marketing-copy";
import { periodGoals } from "@/lib/marketing-period-goals";
import { missingStockColumnsText } from "@/lib/marketing-inventory-decide";
import {
  useResource,
  type MarketingChanges,
  type MarketingInventoryStatus,
} from "./useMarketing";
import { count, money, percentage, shortDate } from "./format";
import r from "./team-report.module.css";
import { CampaignGroups } from "./TeamReportCampaigns";
import { WeekdayChart, TrendChart, AdDiagnostics } from "./TeamReportCharts";
import { ENTITY_COLORS } from "./charts";
import { DailyGoals } from "./DailyGoals";
import { CampaignActions } from "./CampaignActions";
import { CostCapControl } from "./CostCapControl";
import { InventoryUpload, inventoryStatusText } from "./InventoryUpload";
import { KeywordRules } from "./KeywordRules";
import { PixelCheck } from "./PixelCheck";
import { LaunchTracker } from "./LaunchTracker";
import { InventoryAlerts } from "./InventoryAlerts";
import { useInventoryDecision } from "./InventoryDecision";
import { AccountStatusBanner } from "./AccountStatusBanner";
import { useCampaignActions } from "./useCampaignActions";

type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
const usd = (value: number | null | undefined) =>
  value == null ? "Sin datos" : money(value, "USD");
const number = (value: number | null | undefined) =>
  value == null ? "Sin datos" : count(value);
const coverageChip = (coverage: Coverage) =>
  coverage.tone === "red"
    ? r.chipRed
    : coverage.tone === "yellow"
      ? r.chipYellow
      : coverage.tone === "ok"
        ? r.chipOk
        : r.chipMuted;
const scopeText = (p: {
  scope?: "all" | "selected";
  memberKeys?: string[];
  sku: string;
}) =>
  p.scope
    ? p.scope === "all"
      ? "Producto completo · todas las variantes"
      : `Selección · ${p.memberKeys?.length ?? 1} referencias`
    : p.sku || "Sin SKU";

export function TeamReport({
  data,
  sources,
  settings,
  fx,
  model,
  loading,
  revision,
  recent,
  control,
  periodControl,
  actions,
  changes,
  inventory,
  logChange,
  canUpload,
  onInventorySaved,
  canEdit,
  saving,
  saved,
  save,
  onAssign,
  accounts,
  onOpenAccounts,
  onOpenSources,
  periodName = null,
}: {
  data: MarketingSummary;
  sources: MarketingSources | null;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  model: MarketingIntelligence;
  loading: boolean;
  revision: number;
  recent: Resource<MarketingSources>;
  /** Real orders of today and the 13 previous days. */
  control: Resource<MarketingControl>;
  /** Real orders of the selected period. */
  periodControl: Resource<MarketingControl>;
  /** Sources with budgets, bids, lifetime and Meta activity (today−13..today). */
  actions: Resource<MarketingSources>;
  changes: Resource<MarketingChanges>;
  inventory: Resource<MarketingInventoryStatus>;
  logChange: (body: Record<string, unknown>) => Promise<string | null>;
  /** Marketing editor (not read-only): may upload the inventory and log changes. */
  canUpload: boolean;
  onInventorySaved: () => void;
  canEdit: boolean;
  saving: string;
  saved: string;
  save: Save;
  onAssign: () => void;
  /** Account status (M11), loaded after the report; banner only on problems. */
  accounts: Resource<AccountsPayload>;
  onOpenAccounts: () => void;
  /** Opens Fuentes, where the ShipHero connection lives. */
  onOpenSources?: () => void;
  /** Name of the top filter preset ("Este mes", "Últimos 7 días"); null for a custom range. */
  periodName?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [ascending, setAscending] = useState(false);
  const [allStock, setAllStock] = useState(false);
  const [stockKey, setStockKey] = useState("");
  const [campaignsOpen, setCampaignsOpen] = useState(false);
  const [adsOpen, setAdsOpen] = useState(false);
  const [comparisonPage, setComparisonPage] = useState(0);
  const today = marketingDate(),
    yesterday = shiftDate(today, -1);
  // The top filter names the period of the report ("Ayer", "1 al 6 nov");
  // the sections that are always today say so when the filter is not today.
  const periodText = periodLabelText(data.period, today);
  const isToday = periodIsToday(data.period, today);
  const includesToday = periodIncludesToday(data.period, today);
  const filterLabel = isToday ? null : periodText;
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
  const recentModel = useMemo(
    () => buildMarketingIntelligence(data, recent.data, settings),
    [data, recent.data, settings],
  );
  const keywordIndex = useMemo(
    () =>
      buildKeywordIndex(data.productFamilies ?? [], settings?.keywords ?? []),
    [data.productFamilies, settings?.keywords],
  );
  // Módulo 1: today's pace. The orders are as of the control request.
  const pace = useMemo(
    () =>
      control.data
        ? buildDailyPace({
            control: control.data,
            sources: recent.data,
            fx,
            now: new Date(control.data.generatedAt),
          })
        : null,
    [control.data, recent.data, fx],
  );
  // Módulos 2 y 3: one row per campaign with the suggested action.
  const { actionResult, actionRows, costCap, metaAccounts, campaignMembers } =
    useCampaignActions({ data, actions, control, changes, settings, fx });
  // Módulo 9: product names for launches registered by hand (no campaign row yet).
  const productName = useCallback(
    (key: string) =>
      data.productFamilies?.find((f) => f.key === key)?.name ??
      data.products.find((p) => p.key === key)?.name ??
      null,
    [data],
  );
  // Módulo 5 in the report: alerts and Esperando / En camino columns (no extra request).
  const inventoryDecision = useInventoryDecision({
    data,
    model,
    sources,
    settings,
    actionRows,
    campaignMembers,
  });
  const decisionRows = useMemo(
    () =>
      new Map(
        (inventoryDecision?.decision.rows ?? []).map((row) => [row.key, row]),
      ),
    [inventoryDecision],
  );
  const stockColumns = inventoryDecision?.inventory.columns;
  const showWaiting = Boolean(stockColumns?.backorder);
  const showIncoming =
    Boolean(stockColumns?.incoming) ||
    (inventoryDecision?.decision.rows.some(
      (row) => row.incomingSource === "plan",
    ) ??
      false);
  // A6: real orders by channel for the period (UTM + assignment).
  const channel = useMemo(() => {
    if (!periodControl.data || !sources) return null;
    const { estimates } = buildRealEstimate({
      summary: data,
      sources,
      settings,
      control: periodControl.data,
      fx,
    });
    return channelOrders(
      periodControl.data.days,
      estimates,
      data.period.from,
      data.period.to,
    );
  }, [periodControl.data, data, sources, settings, fx]);
  const meta = reportChannel(sources, "meta", fx),
    tiktok = reportChannel(sources, "tiktok", fx);
  const tiktokThrough = sources?.tiktok.data?.accounts
    .flatMap((a) =>
      a.campaigns.flatMap((c) => c.daily?.map((d) => d.date) ?? []),
    )
    .sort()
    .at(-1);
  const spend =
    meta.spend != null && tiktok.spend != null
      ? meta.spend + tiktok.spend
      : null;
  // Meta partial (an account could not be read): the CPA is orientative only.
  const aligned = Boolean(
    sources &&
    !sources.meta.data?.unavailable?.length &&
    (["meta", "tiktok"] as const).every(
      (p) =>
        sources[p].status === "ready" &&
        sources[p].data?.accounts.every((a) => a.timezone === data.timezone),
    ),
  );
  const cpa = realCpa(spend, data.totals.generated, data.totals.annulled);
  // The first block follows the top filter: the period against its goals
  // (daily goals × days). Today's pace only when the period is or reaches today.
  const goals = periodGoals({
    period: data.period,
    today,
    realOrders: cpa.real,
    spendUsd: spend,
    cpaReal: cpa.cpaReal,
  });
  const products = [
    ...(data.groupedProducts?.filter((p) => p.scope === "all") ??
      model.products),
  ].sort((a, b) => (ascending ? 1 : -1) * (a.orders - b.orders));
  const stock =
    model.products.find((p) => p.key === stockKey) ?? model.products[0];
  const stockRows = stockDaysRows(model.products, allStock);
  const lowStock = stockDaysRows(model.products);
  const filtered = comparisons
    .filter((p) =>
      `${p.name} ${p.sku} ${"memberKeys" in p ? (p.memberKeys as string[]).join(" ") : ""}`
        .toLocaleLowerCase("es")
        .includes(query.toLocaleLowerCase("es")),
    )
    .sort((a, b) => b.sevenDayOrders - a.sevenDayOrders);
  const pages = Math.max(1, Math.ceil(filtered.length / 5)),
    page = Math.min(comparisonPage, pages - 1),
    visible = filtered.slice(page * 5, page * 5 + 5);
  const cpaAlerts = highCpaAlerts(
    comparisons,
    actionResult ? [...actionResult.meta, ...actionResult.tiktok] : [],
  );
  // Revisar para escalar: CPA real (sin anulados) del período dentro de la
  // meta, con pedidos reales suficientes y stock (A1: el CPA real decide).
  const scaling = model.products.filter((p) => {
    const real = campaignModel.products.find((c) => c.key === p.key);
    return (
      !campaignModel.ads.partial &&
      settings != null &&
      campaignModel.unmapped.length === 0 &&
      p.coverage.days != null &&
      p.coverage.days >= t.stockYellowDays &&
      real != null &&
      real.currency === "USD" &&
      real.campaignCount > 0 &&
      real.cpa != null &&
      real.cpa > 0 &&
      real.cpa <= t.cpaUsd &&
      real.realOrders >= t.scaleMinRealOrders
    );
  });
  const inventoryLine = inventoryStatusText(inventory);
  const originsOk = periodControl.data?.origins === "ok";
  const channelNote = (
    c: NonNullable<typeof channel>["meta"],
    platform: string,
  ) =>
    [
      originsOk
        ? `${count(c.utm)} con UTM + ${count(Math.round(c.assigned))} por asignación de producto`
        : "Por asignación de producto · UTM no disponible",
      c.missingDates.length
        ? `${platform} sin datos de gasto del ${c.missingDates.map(shortDate).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const channelValue = (value: number | undefined) =>
    periodControl.loading || loading
      ? "…"
      : value == null
        ? "Sin datos"
        : count(Math.round(value));
  return (
    <div className={r.report}>
      <AccountStatusBanner
        accounts={accounts}
        settings={settings}
        onOpen={onOpenAccounts}
      />
      <div className={r.reportHeading}>
        <h2>Ventas, inversión y próximos pasos</h2>
        <span className={r.period}>
          {periodName && data.period.from !== data.period.to
            ? `${periodName} · `
            : ""}
          {periodLabelText(data.period, today, { withDate: true })} · USD
        </span>
      </div>
      {isToday ? (
        <DailyGoals
          pace={pace}
          loading={control.loading}
          spendLoading={recent.loading}
          error={control.error}
        />
      ) : (
        <section
          className={r.heroMetrics}
          aria-label={`Resultados del período contra la meta: ${periodText}`}
        >
          <Metric
            label="Pedidos reales"
            value={`${count(goals.orders.value)} de ${count(goals.orders.goal)}`}
            progress={goals.orders.progress}
            max={goals.orders.goal}
            valueNow={goals.orders.value}
            notes={[
              `Meta ${count(t.dailyOrders)} por día × ${count(goals.days)} ${goals.days === 1 ? "día" : "días"} · promedio ${count(Math.round(goals.orders.perDay))} por día`,
              `${count(data.totals.generated)} creados · ${count(data.totals.annulled)} anulados${goals.includesToday ? " · hoy sigue en curso" : ""}`,
            ]}
          />
          <Metric
            label="CPA real"
            value={
              loading
                ? "Consultando…"
                : `${!aligned && cpa.cpaReal != null ? "≈ " : ""}${usd(cpa.cpaReal)} · meta ${usd(t.cpaUsd)}`
            }
            progress={loading ? null : goals.cpa.progress}
            max={t.cpaUsd}
            valueNow={goals.cpa.value}
            risk={goals.cpa.over}
            notes={[
              cpa.cpaReal == null
                ? "Gasto completo y pedidos reales requeridos"
                : goals.cpa.over
                  ? `Sobre la meta por ${usd(cpa.cpaReal - t.cpaUsd)}`
                  : "Dentro de la meta",
              cpa.cpaReal == null
                ? ""
                : `${aligned ? "Gasto / pedidos reales (sin anulados)" : sources?.meta.data?.unavailable?.length ? "Orientativo: falta gasto de una cuenta de Meta" : "Orientativo: calendarios de cuenta distintos"} · con creados: ${usd(cpa.cpaCreated)}`,
            ]}
          />
          <Metric
            label="Gasto en pauta"
            value={
              loading
                ? "Consultando…"
                : spend == null
                  ? "Sin datos"
                  : `${usd(spend)} de ${usd(goals.spend.goal)}`
            }
            progress={loading ? null : goals.spend.progress}
            max={goals.spend.goal}
            valueNow={spend}
            notes={[
              `Meta + TikTok, en USD · meta ${usd(t.dailySpendUsd)} por día`,
              goals.spend.perDay == null
                ? ""
                : `Promedio ${usd(goals.spend.perDay)} por día`,
            ]}
          />
        </section>
      )}
      <section className={r.channelMetrics} aria-label="Desglose por canal">
        <Metric
          label="Pedidos Meta"
          swatch={ENTITY_COLORS.meta}
          value={channelValue(channel?.meta.total)}
          note={
            channel
              ? `${channelNote(channel.meta, "Meta")} · píxel: ${number(meta.purchases)} compras`
              : periodControl.error || "Pedidos reales no disponibles."
          }
        />
        <Metric
          label="Pedidos TikTok"
          swatch={ENTITY_COLORS.tiktok}
          value={channelValue(channel?.tiktok.total)}
          note={
            channel
              ? `${channelNote(channel.tiktok, "TikTok")} · TikTok: ${number(tiktok.conversions)} conversiones`
              : periodControl.error || "Pedidos reales no disponibles."
          }
        />
        <Metric
          label="Otros / sin campaña"
          swatch={ENTITY_COLORS.other}
          value={channelValue(channel?.other)}
          note="Productos sin campaña con gasto, otros orígenes u orgánicos. Sin UTM no implica orgánico."
        />
        <Metric
          label="Gasto · Meta Ads"
          swatch={ENTITY_COLORS.meta}
          value={loading ? "…" : usd(meta.spend)}
          note="Las cinco cuentas publicitarias"
        />
        <Metric
          label="Gasto · TikTok Ads"
          swatch={ENTITY_COLORS.tiktok}
          value={loading ? "…" : usd(tiktok.spend)}
          note={
            tiktokThrough
              ? `Último día recibido: ${shortDate(tiktokThrough)}`
              : "Datos enviados por Make o API"
          }
        />
      </section>
      {includesToday && !isToday && (
        <DailyGoals
          pace={pace}
          loading={control.loading}
          spendLoading={recent.loading}
          error={control.error}
          variant="inPeriod"
        />
      )}
      {!aligned && (
        <p className={r.explanation}>
          Los pedidos usan hora de Costa Rica; TikTok reporta con el calendario
          de su cuenta. El CPA marcado con ≈ es orientativo: divide el gasto
          consultado entre pedidos reales, con un desfase horario entre fuentes.
          Las compras del píxel no se suman como pedidos de Kairo.
        </p>
      )}

      <section className={r.coverage} aria-label="Cobertura y datos pendientes">
        <div>
          <h3>Completa el reporte</h3>
          <p>
            {recent.loading
              ? "Consultando campañas recientes…"
              : settings
                ? `${recentModel.unmapped.length} campañas con gasto sin producto (hoy y 7 días anteriores).`
                : "No se pudieron consultar las asignaciones."}{" "}
            Los costos parciales usan solo la pauta asignada.
          </p>
        </div>
        <button onClick={onAssign}>Asignar productos</button>
        <ul>
          {data.familyDataError && <li role="alert">{data.familyDataError}</li>}
          <li>
            <strong>Origen:</strong>{" "}
            {channel
              ? `${count(channel.withCampaign)} de ${count(channel.real)} pedidos reales con UTM de campaña (${percentage(channel.utmShare)}). El resto se reparte por producto asignado y gasto. Para mejorar: capturar los UTM en el formulario de iComfly.`
              : periodControl.loading
                ? "Consultando el origen de los pedidos…"
                : periodControl.error || "Cruce de origen no disponible."}
          </li>
          <li>
            <strong>Inventario:</strong>{" "}
            {sources?.shiphero.status === "ready"
              ? `${sources.shiphero.message || "Inventario consultado."} `
              : sources?.shiphero.connection
                ? `${sources.shiphero.message} `
                : "ShipHero sin conectar. "}
            {inventoryLine.text}
            {inventoryLine.warning && (
              <span className={r.warnText}> {inventoryLine.warning}</span>
            )}{" "}
            <a href="#inventario" className={r.inlineLink}>
              Ir al inventario
            </a>
            {onOpenSources &&
              (sources?.shiphero.data?.origin === "shiphero" ||
                sources?.shiphero.connection ||
                canUpload) && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className={r.inlineLink}
                    onClick={onOpenSources}
                  >
                    {sources?.shiphero.data?.origin === "shiphero" ||
                    sources?.shiphero.connection
                      ? "Ver conexión"
                      : "Conectar ShipHero"}
                  </button>
                </>
              )}
          </li>
          <li>
            <strong>CPA:</strong> CPA real = gasto / pedidos reales (sin
            anulados). ≈ indica horarios diferentes o cobertura parcial. Un
            costo parcial puede aumentar al asignar las campañas restantes.
          </li>
        </ul>
      </section>

      <CampaignActions
        result={actionResult}
        loading={actions.loading || control.loading}
        error={actions.error}
        metaAccounts={metaAccounts}
        labels={settings?.accountLabels ?? []}
        labelsError={settings?.keywordsError ?? ""}
        changes={{
          pending: changes.data?.status === "pending_migration",
          loading: changes.loading,
          error: changes.error,
        }}
        canEdit={canUpload}
        saving={saving}
        save={save}
        logChange={logChange}
        filterLabel={filterLabel}
      />
      <LaunchTracker
        rows={actionResult ? actionRows : null}
        manual={changes.data?.changes ?? []}
        manualPending={changes.data?.status === "pending_migration"}
        loading={actions.loading || control.loading}
        error={actions.error}
        fx={fx}
        productName={productName}
      />
      <CostCapControl
        control={costCap}
        loading={actions.loading || control.loading}
        error={actions.error}
        filterLabel={filterLabel}
      />
      <PixelCheck
        summary={data}
        actions={actions}
        control={control}
        settings={settings}
        fx={fx}
      />

      <section className={r.section}>
        <div className={r.sectionHead}>
          <div>
            <p className={r.kicker}>06 / Productos</p>
            <h2>Comparar para decidir</h2>
            <button className={r.assignLink} onClick={onAssign}>
              Asignar campañas para calcular el CPA
            </button>
            <p>
              Hoy ({shortDate(today)}) y ayer; los últimos 7 días completos
              hasta {shortDate(yesterday)}. Independiente del período superior
              {filterLabel ? ` (${filterLabel})` : ""}.
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
              Pauta de campañas asignadas / pedidos reales del producto (sin
              anulados). No atribuye cada venta.
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
                        <small>{scopeText(p)}</small>
                      </th>
                      {p.costs.map((cost, i) => (
                        <td
                          key={i}
                          className={
                            !cost.partial &&
                            !cost.approximate &&
                            cost.value != null &&
                            cost.value > t.cpaUsd
                              ? r.risk
                              : undefined
                          }
                        >
                          {recent.loading ? (
                            "…"
                          ) : cost.value == null ? (
                            <>
                              {cost.reason}
                              {cost.createdValue != null && (
                                <small>Creados: {usd(cost.createdValue)}</small>
                              )}
                            </>
                          ) : (
                            <>
                              {cost.partial || cost.approximate ? "≈ " : ""}
                              {usd(cost.value)}
                              <small>
                                Creados: {usd(cost.createdValue)} ·{" "}
                                {cost.partial
                                  ? `parcial: ${cost.reason.toLocaleLowerCase("es")}`
                                  : cost.approximate
                                    ? "orientativo: horarios distintos"
                                    : "pauta completa consultada"}
                              </small>
                            </>
                          )}
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
            <h3>Pedidos reales por producto</h3>
            <p className={r.caption}>
              Sin anulados; debajo, los creados. Las variantes del mismo
              producto se agrupan y cada pedido cuenta una vez. Las selecciones
              específicas pueden solaparse; las filas no se suman.
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
                        <small>{scopeText(p)}</small>
                      </th>
                      {(
                        [
                          [p.todayReal, p.todayOrders],
                          [p.yesterdayReal, p.yesterdayOrders],
                          [p.sevenDayReal, p.sevenDayOrders],
                        ] as const
                      ).map(([real, created], i) => (
                        <td key={i}>
                          {count(real)}
                          <small>{count(created)} creados</small>
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
        </div>
        <div className={r.pagination}>
          <p>
            {recent.error ||
              "Cada producto se calcula con sus campañas asignadas. Los importes parciales no representan el CPA completo. Sin pedidos o sin conversión de moneda no se inventa un costo."}
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
        id="inventario"
        className={`${r.section} ${r.inventoryGrid}`}
        aria-label="Ventas e inventario"
      >
        {inventoryDecision && (
          <InventoryAlerts
            alerts={inventoryDecision.decision.alerts}
          />
        )}
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
                  <small>
                    {scopeText(p as Parameters<typeof scopeText>[0])}
                  </small>
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
          {stock && (
            <p>
              Cobertura:{" "}
              <span className={`${r.chip} ${coverageChip(stock.coverage)}`}>
                {stock.coverage.label}
              </span>
            </p>
          )}
          <p className={r.caption}>
            {!stock || stock.coverage.available == null
              ? stock?.coverage.label === "SKU sin coincidencia única"
                ? "SKU sin coincidencia única en el inventario."
                : "Sube el product_table para ver los días de stock."
              : `Vende ${decimalText(stock.coverage.dailyUnits)} por día (últimos 7 días, sin anulados).`}
          </p>
          <InventoryUpload
            status={inventory}
            catalog={data.catalog}
            canEdit={canUpload}
            onSaved={onInventorySaved}
          />
        </div>
        <div>
          <div className={r.sectionHead}>
            <h3>Stock en días</h3>
            <button
              onClick={() => setAllStock(!allStock)}
              aria-pressed={allStock}
            >
              {allStock ? "Solo rojo y amarillo" : "Ver todos"}
            </button>
          </div>
          <p className={r.caption}>
            Disponible ÷ unidades vendidas por día (últimos 7 días, sin
            anulados). Rojo: menos de {t.stockRedDays} días. Amarillo: menos de{" "}
            {t.stockYellowDays}.
          </p>
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Stock en días de cobertura"
          >
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Disponible</th>
                  {showWaiting && <th>Esperando</th>}
                  {showIncoming && <th>En camino</th>}
                  <th>Venta diaria</th>
                  <th>Días</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map((p) => (
                  <tr key={p.key}>
                    <th scope="row">
                      {p.name}
                      <small>{p.sku || "Sin SKU"}</small>
                    </th>
                    <td>{number(p.coverage.available)}</td>
                    {showWaiting && (
                      <td
                        className={
                          (decisionRows.get(p.key)?.backorder ?? 0) > 0
                            ? r.risk
                            : undefined
                        }
                      >
                        {number(decisionRows.get(p.key)?.backorder)}
                      </td>
                    )}
                    {showIncoming && (
                      <td>
                        {number(decisionRows.get(p.key)?.incoming)}
                        {decisionRows.get(p.key)?.incomingSource === "plan" && (
                          <small>a mano</small>
                        )}
                      </td>
                    )}
                    <td>{decimalText(p.coverage.dailyUnits)}</td>
                    <td>
                      <span className={`${r.chip} ${coverageChip(p.coverage)}`}>
                        {p.coverage.label}
                      </span>
                    </td>
                  </tr>
                ))}
                {!stockRows.length && (
                  <tr>
                    <td
                      colSpan={4 + Number(showWaiting) + Number(showIncoming)}
                    >
                      {sources?.shiphero.status !== "ready"
                        ? "Sube el product_table para ver los días de stock."
                        : `Sin productos con menos de ${t.stockYellowDays} días de stock.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {inventoryDecision && (!showWaiting || !showIncoming) && (
            <p className={r.caption}>
              {missingStockColumnsText(
                inventoryDecision.inventory.origin === "csv" ? "csv" : "shiphero",
                { backorder: !showWaiting, incoming: !showIncoming },
              )}
            </p>
          )}
        </div>
      </section>

      <section className={r.section}>
        <div className={r.sectionHead}>
          <div>
            <p className={r.kicker}>07 / Pauta</p>
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
            <span>CPA · presupuesto diario · gasto · palabras clave</span>
          </summary>
          {campaignsOpen && (
            <>
              <KeywordRules
                rules={settings?.keywords ?? []}
                families={data.productFamilies ?? []}
                error={settings?.keywordsError ?? ""}
                canEdit={canEdit}
                saving={saving}
                save={save}
              />
              <p className={r.caption}>
                {budgets.loading
                  ? "Consultando presupuestos actuales; puedes revisar el gasto mientras se completa."
                  : budgets.error ||
                    (budgets.data?.meta.status === "error"
                      ? "No se pudieron cargar los presupuestos de Meta; se conserva el gasto consultado. "
                      : "") +
                      "CPA de campaña = gasto / compras reportadas por la plataforma (píxel). No equivale al CPA real."}
              </p>
              <CampaignGroups
                sources={campaignSources}
                model={campaignModel}
                catalog={data.catalog}
                families={data.productFamilies}
                fx={fx}
                ready={canEdit}
                loading={budgets.loading}
                saving={saving}
                saved={saved}
                save={save}
                keywords={keywordIndex}
                labels={settings?.accountLabels ?? []}
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
            <p className={r.kicker}>08 / Tendencias</p>
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
            <p className={r.kicker}>09 / Atención</p>
            <h2>Oportunidades y riesgos</h2>
            <p>
              CPA objetivo: {usd(t.cpaUsd)} con pedidos reales · Stock: rojo con
              menos de {t.stockRedDays} días, amarillo con menos de{" "}
              {t.stockYellowDays}.
            </p>
          </div>
        </div>
        <div className={r.alertGrid}>
          <div>
            <h3>Revisar para escalar</h3>
            {scaling.length ? (
              scaling.slice(0, 5).map((p) => (
                <p key={p.key} className={r.alert}>
                  <strong>{p.name}</strong>Stock para {t.stockYellowDays} días o
                  más; {t.scaleMinRealOrders} o más pedidos reales y CPA real ≤{" "}
                  {usd(t.cpaUsd)} en el período. Confirma en la tabla de
                  acciones antes de subir presupuesto.
                </p>
              ))
            ) : (
              <p className={r.alert}>
                Sin oportunidades verificables todavía. Se necesitan pedidos
                reales suficientes, campañas asignadas y stock confirmado.
              </p>
            )}
          </div>
          <div>
            <h3>CPA por encima del objetivo</h3>
            {[...cpaAlerts.products, ...cpaAlerts.campaigns]
              .slice(0, 8)
              .map((alert) => (
                <p key={alert.key} className={`${r.alert} ${r.alertRisk}`}>
                  <strong>{alert.title}</strong>
                  {alert.detail}
                  {alert.pixel && <small> · {alert.pixel}</small>}
                </p>
              ))}
            {!cpaAlerts.products.length && !cpaAlerts.campaigns.length && (
              <p className={r.alert}>
                {recent.loading || actions.loading || control.loading
                  ? "Consultando pedidos reales y campañas…"
                  : `Sin productos ni campañas sobre ${usd(t.cpaUsd)} con pedidos reales.`}
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
                {lowStock.length} productos con menos de {t.stockYellowDays}{" "}
                días de stock.
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
        Los pedidos reales excluyen los anulados en iComfly al momento de
        consultar; un pedido anulado más tarde cambia el CPA de días anteriores.
        El stock y los presupuestos son actuales. Los importes CRC y PEN se
        reexpresan en USD con la referencia indicada arriba; no representan
        cobros ni utilidad final.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  notes,
  progress,
  max,
  valueNow,
  risk = false,
  swatch,
}: {
  label: string;
  value: string;
  note?: string;
  notes?: string[];
  /** Entity color (Meta, TikTok, Otros): the same one every chart uses. */
  swatch?: string;
  /** With a goal: share of the goal reached (meter). */
  progress?: number | null;
  max?: number;
  valueNow?: number | null;
  risk?: boolean;
}) {
  const meter = progress !== undefined;
  const width = progress == null ? 0 : Math.min(1, Math.max(0, progress));
  return (
    <div className={r.metric}>
      <p>
        {swatch && (
          <span
            className={r.entitySwatch}
            style={{ background: swatch }}
            aria-hidden="true"
          />
        )}
        {label}
        {risk && (
          <span className={r.riskBadge}>
            <AlertTriangle aria-hidden="true" />
            Sobre la meta
          </span>
        )}
      </p>
      <strong>{value}</strong>
      {meter && (
        <div
          className={`${r.meter} ${r.metricMeter} ${risk ? r.meterRisk : ""}`}
          role="meter"
          aria-label={`${label} contra la meta`}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={
            valueNow == null ? undefined : Math.round(valueNow * 100) / 100
          }
          aria-valuetext={value}
        >
          <div className={r.meterFill} style={{ width: `${width * 100}%` }} />
        </div>
      )}
      {note && <small>{note}</small>}
      {notes?.filter(Boolean).map((line) => <small key={line}>{line}</small>)}
    </div>
  );
}
