"use client";
import { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Hourglass,
  TrendingDown,
  TrendingUp,
  Target,
} from "lucide-react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { CharlieReport, UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type {
  AccountsPayload,
  OrderFactsPayload,
} from "@/lib/marketing-insights-types";
import type { MarketingView } from "@/lib/marketing-loading";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { marketingDate, shiftDate } from "@/lib/marketing-dates";
import {
  periodIncludesToday,
  periodIsToday,
  periodLabelText,
} from "@/lib/marketing-copy";
import { periodGoals } from "@/lib/marketing-period-goals";
import { buildDailyPace } from "@/lib/marketing-pace";
import { realCpa, buildRealEstimate } from "@/lib/marketing-real-cpa";
import { reportChannel } from "@/lib/marketing-team-report";
import { buildPixelReport } from "@/lib/marketing-pixel";
import { buildCancelReport } from "@/lib/marketing-cancellations";
import { DECISION_RULES } from "@/lib/marketing-decisions";
import {
  buildBrokenItems,
  buildProductHighlights,
  dailyRealSeries,
  periodProjection,
  unavailableMetaNames,
  type ProductHighlight,
} from "@/lib/marketing-resumen";
import { count, money, percentage, shortDate } from "./format";
import { Sparkline, SERIES_COLORS } from "./charts";
import { useCampaignActions } from "./useCampaignActions";
import { useDecisions } from "./useDecisions";
import { useInventoryDecision } from "./InventoryDecision";
import { useAccountStatus } from "./AccountStatus";
import type { MarketingChanges } from "./useMarketing";
import rs from "./resumen.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
type Tone = "good" | "warn" | "bad" | "neutral";
const t = MARKETING_TARGETS;
const usd = (value: number | null | undefined) =>
  value == null ? "Sin datos" : money(value, "USD");
const whole = (value: number) => count(Math.round(value));

function Status({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={rs.status} data-tone={tone}>
      {icon}
      {children}
    </span>
  );
}

function Meter({
  label,
  progress,
  tone,
  valueText,
  max,
  valueNow,
}: {
  label: string;
  progress: number | null;
  tone: "accent" | "bad";
  valueText: string;
  max: number;
  valueNow: number | null;
}) {
  const width = progress == null ? 0 : Math.min(1, Math.max(0, progress));
  return (
    <div
      className={rs.meter}
      data-tone={tone}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={
        valueNow == null ? undefined : Math.round(valueNow * 100) / 100
      }
      aria-valuetext={valueText}
    >
      <span style={{ width: `${width * 100}%` }} />
    </div>
  );
}

export function ResumenView({
  data,
  model,
  sources,
  sourcesLoading,
  settings,
  fx,
  control,
  actions,
  changes,
  recent,
  accounts,
  cancellations,
  costCapAds,
  periodName = null,
  onNavigate,
}: {
  data: MarketingSummary;
  model: MarketingIntelligence;
  sources: MarketingSources | null;
  sourcesLoading: boolean;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  control: Resource<MarketingControl>;
  actions: Resource<MarketingSources>;
  changes: Resource<MarketingChanges>;
  recent: Resource<MarketingSources>;
  accounts: Resource<AccountsPayload>;
  cancellations: Resource<OrderFactsPayload>;
  costCapAds: Resource<CharlieReport>;
  periodName?: string | null;
  onNavigate: (view: MarketingView, anchor?: string) => void;
}) {
  const today = marketingDate();
  const isToday = periodIsToday(data.period, today);
  const includesToday = periodIncludesToday(data.period, today);

  // 1. ¿Llegamos a la meta? (period against its goals; today's pace inside it)
  const pace = useMemo(
    () =>
      includesToday && control.data
        ? buildDailyPace({
            control: control.data,
            sources: recent.data,
            fx,
            now: new Date(control.data.generatedAt),
          })
        : null,
    [includesToday, control.data, recent.data, fx],
  );
  const meta = reportChannel(sources, "meta", fx),
    tiktok = reportChannel(sources, "tiktok", fx);
  const spend =
    meta.spend != null && tiktok.spend != null
      ? meta.spend + tiktok.spend
      : null;
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
  const goals = periodGoals({
    period: data.period,
    today,
    realOrders: cpa.real,
    spendUsd: spend,
    cpaReal: cpa.cpaReal,
  });
  const pixelCpa =
    meta.spend != null && meta.purchases != null && meta.purchases > 0
      ? meta.spend / meta.purchases
      : null;
  const series = useMemo(
    () => dailyRealSeries(data.daily, today),
    [data.daily, today],
  );

  // Today alone: the hero is today's pace (as of the control request).
  const hero = isToday
    ? {
        orders: pace?.orders.real ?? null,
        ordersGoal: t.dailyOrders,
        spend: pace?.spend.total ?? null,
        spendGoal: t.dailySpendUsd,
        spendApprox: Boolean(pace?.spend.tiktokEstimate),
        cpa: pace?.cpa.real ?? null,
        cpaApprox: Boolean(pace?.spend.tiktokEstimate),
        loading: control.loading || recent.loading,
      }
    : {
        orders: goals.orders.value,
        ordersGoal: goals.orders.goal,
        spend,
        spendGoal: goals.spend.goal,
        spendApprox: false,
        cpa: cpa.cpaReal,
        cpaApprox: !aligned,
        loading: sourcesLoading,
      };
  const ordersProgress =
    hero.orders == null ? null : hero.orders / hero.ordersGoal;
  const cpaOver = hero.cpa != null && hero.cpa > t.cpaUsd;
  const spendProgress = hero.spend == null ? null : hero.spend / hero.spendGoal;
  const projected = pace?.orders.projected?.real ?? null;
  const periodClose = isToday
    ? null
    : periodProjection({
        periodReal: goals.orders.value,
        todayReal: pace?.orders.real ?? 0,
        todayProjected: projected,
      });
  const projectionLine = !includesToday
    ? null
    : control.loading && !pace
      ? "Consultando el ritmo de hoy…"
      : !pace
        ? null
        : projected == null
          ? `Hoy van ${count(pace.orders.real)} pedidos reales (${pace.asOf}). Muy temprano para proyectar.`
          : isToday
            ? `A este ritmo cierras hoy en ${count(projected)} pedidos reales${
                pace.spend.projected != null
                  ? ` y ≈ ${usd(pace.spend.projected)}${pace.cpa.projected != null ? ` (CPA real ≈ ${usd(pace.cpa.projected)})` : ""}`
                  : ""
              }. Meta: ${count(t.dailyOrders)}.`
            : `Hoy van ${count(pace.orders.real)} pedidos reales (${pace.asOf}). A este ritmo cierras hoy en ${count(projected)} y el período en ${count(periodClose ?? goals.orders.value)} de ${count(goals.orders.goal)}.`;
  const ordersStatus =
    ordersProgress == null ? null : ordersProgress >= 1 ? (
      <Status tone="good" icon={<CheckCircle2 aria-hidden="true" />}>
        Meta cumplida
      </Status>
    ) : !includesToday ? (
      <Status tone="warn" icon={<AlertTriangle aria-hidden="true" />}>
        Faltaron {whole(hero.ordersGoal - (hero.orders ?? 0))} pedidos
      </Status>
    ) : (
      <Status tone="neutral" icon={<Hourglass aria-hidden="true" />}>
        En curso · {percentage(ordersProgress)}
      </Status>
    );

  // 2. Decisiones pendientes (same rows as the actions table).
  const { actionResult, actionRows, campaignMembers } = useCampaignActions({
    data,
    actions,
    control,
    changes,
    settings,
    fx,
  });
  const decisions = useDecisions({
    data,
    actions,
    control,
    changes,
    settings,
    fx,
    actionRows: actionResult ? actionRows : null,
    costCapAds,
  });

  // 3. Productos.
  const products = useMemo(
    () =>
      buildProductHighlights({
        summary: data,
        campaigns: model.campaigns,
        stock:
          sources?.shiphero.status === "ready"
            ? (sources.shiphero.data?.stock ?? null)
            : null,
        fx,
        settingsReady: Boolean(settings),
        aligned,
      }),
    [data, model.campaigns, sources, fx, settings, aligned],
  );

  // 4. Qué está roto.
  const inventoryDecision = useInventoryDecision({
    data,
    model,
    sources,
    settings,
    actionRows,
    campaignMembers,
  });
  const accountStatus = useAccountStatus(accounts, settings);
  const pixelHealth = useMemo(() => {
    if (!actions.data || !control.data) return [];
    const estimate = buildRealEstimate({
      summary: data,
      sources: actions.data,
      settings,
      control: control.data,
      fx,
    });
    return buildPixelReport({
      campaigns: estimate.campaigns,
      estimates: estimate.estimates,
      days: control.data.days,
      labels: settings?.accountLabels ?? [],
      fx,
      today: control.data.today || today,
    }).health;
  }, [actions.data, control.data, data, settings, fx, today]);
  const cancel = useMemo(() => {
    const facts = cancellations.data;
    if (!facts) return null;
    const closed = buildCancelReport(facts, facts.from, facts.to).closed;
    return closed.base > 0 ? closed : null;
  }, [cancellations.data]);
  const broken = buildBrokenItems({
    accountProblems: accountStatus?.problems ?? [],
    sources,
    metaUnavailable: unavailableMetaNames(
      sources,
      settings?.accountLabels ?? [],
    ),
    pixelHealth,
    cancellations: cancel,
    inventoryAlerts: inventoryDecision?.decision.alerts ?? [],
    today,
  });
  const checking =
    sourcesLoading ||
    accounts.loading ||
    actions.loading ||
    control.loading ||
    cancellations.loading;

  const periodText = `${periodName && data.period.from !== data.period.to ? `${periodName} · ` : ""}${periodLabelText(data.period, today, { withDate: true })}`;
  const counts = decisions.counts;
  const lowerOff = counts ? counts.bajar + counts.apagar : null;
  const window3 = `${shortDate(shiftDate(today, -DECISION_RULES.windowDays))} al ${shortDate(shiftDate(today, -1))}`;
  const go = (view: MarketingView, anchor?: string) => () =>
    onNavigate(view, anchor);

  return (
    <div className={rs.resumen}>
      <section className={rs.goalSection} aria-labelledby="resumen-meta">
        <div className={rs.head}>
          <h2 id="resumen-meta">¿Llegamos a la meta?</h2>
          <span className={rs.period}>{periodText} · USD</span>
        </div>
        <div className={rs.tiles}>
          <div className={`${rs.tile} ${rs.heroTile}`}>
            <p className={rs.label}>Pedidos reales</p>
            <p className={rs.figure}>
              <strong className={rs.hero}>
                {hero.orders == null
                  ? hero.loading
                    ? "…"
                    : "Sin datos"
                  : count(hero.orders)}
              </strong>
              <span className={rs.of}>de {count(hero.ordersGoal)}</span>
            </p>
            <Meter
              label="Pedidos reales contra la meta"
              progress={ordersProgress}
              tone="accent"
              max={hero.ordersGoal}
              valueNow={hero.orders}
              valueText={`${hero.orders == null ? "Sin datos" : count(hero.orders)} de ${count(hero.ordersGoal)}`}
            />
            <div className={rs.statusRow}>
              {ordersStatus}
              <small>
                Meta {count(t.dailyOrders)} por día
                {goals.days > 1 && !isToday
                  ? ` × ${count(goals.days)} días`
                  : ""}{" "}
                · sin anulados
              </small>
            </div>
            {!isToday && series.length > 1 && (
              <div className={rs.spark}>
                <p className={rs.sparkLabel}>Por día</p>
                <Sparkline
                  ariaLabel="Pedidos reales por día"
                  reference={{
                    value: t.dailyOrders,
                    label: `Meta ${count(t.dailyOrders)}`,
                  }}
                  points={series.map((p) => ({
                    key: p.date,
                    value: p.real,
                    title: shortDate(p.date),
                    open: p.inProgress,
                    rows: [
                      {
                        key: "real",
                        color: SERIES_COLORS[0],
                        value: count(p.real),
                        label: "pedidos reales",
                      },
                      {
                        key: "created",
                        value: count(p.created),
                        label: "creados",
                      },
                    ],
                  }))}
                />
              </div>
            )}
          </div>
          <div className={rs.tile}>
            <p className={rs.label}>CPA real</p>
            <p className={rs.figure}>
              <strong className={rs.value}>
                {hero.loading && hero.cpa == null
                  ? "…"
                  : `${hero.cpaApprox && hero.cpa != null ? "≈ " : ""}${usd(hero.cpa)}`}
              </strong>
              <span className={rs.of}>meta {usd(t.cpaUsd)}</span>
            </p>
            <Meter
              label="CPA real contra la meta"
              progress={hero.cpa == null ? null : hero.cpa / t.cpaUsd}
              tone={cpaOver ? "bad" : "accent"}
              max={t.cpaUsd}
              valueNow={hero.cpa}
              valueText={`${usd(hero.cpa)}, meta ${usd(t.cpaUsd)}`}
            />
            <div className={rs.statusRow}>
              {hero.cpa == null ? (
                <small>
                  {hero.loading
                    ? "Consultando el gasto…"
                    : "Necesita gasto completo y pedidos reales."}
                </small>
              ) : cpaOver ? (
                <Status tone="bad" icon={<AlertTriangle aria-hidden="true" />}>
                  Sobre la meta por {usd(hero.cpa - t.cpaUsd)}
                </Status>
              ) : (
                <Status tone="good" icon={<CheckCircle2 aria-hidden="true" />}>
                  Dentro de la meta
                </Status>
              )}
            </div>
            <small className={rs.note}>
              Gasto ÷ pedidos reales de iComfly (sin anulados)
              {hero.cpaApprox
                ? isToday
                  ? ". TikTok de hoy es estimado (≈)."
                  : sources?.meta.data?.unavailable?.length
                    ? ". Orientativo: falta gasto de una cuenta de Meta (≈)."
                    : ". Orientativo: calendarios de cuenta distintos (≈)."
                : "."}
            </small>
            {!isToday && pixelCpa != null && (
              <small className={rs.note}>
                Referencia: píxel de Meta {usd(pixelCpa)} por compra.
              </small>
            )}
          </div>
          <div className={rs.tile}>
            <p className={rs.label}>Gasto en pauta</p>
            <p className={rs.figure}>
              <strong className={rs.value}>
                {hero.loading && hero.spend == null
                  ? "…"
                  : `${hero.spendApprox && hero.spend != null ? "≈ " : ""}${usd(hero.spend)}`}
              </strong>
              <span className={rs.of}>de {usd(hero.spendGoal)}</span>
            </p>
            <Meter
              label="Gasto contra la meta"
              progress={spendProgress}
              tone="accent"
              max={hero.spendGoal}
              valueNow={hero.spend}
              valueText={`${usd(hero.spend)} de ${usd(hero.spendGoal)}`}
            />
            <div className={rs.statusRow}>
              {spendProgress != null && spendProgress > 1 ? (
                <Status tone="warn" icon={<AlertTriangle aria-hidden="true" />}>
                  Sobre el gasto previsto
                </Status>
              ) : spendProgress != null ? (
                <small>{percentage(spendProgress)} del gasto previsto</small>
              ) : (
                <small>
                  {hero.loading ? "Consultando el gasto…" : "Gasto incompleto."}
                </small>
              )}
            </div>
            <small className={rs.note}>
              Meta + TikTok · meta {usd(t.dailySpendUsd)} por día
              {isToday && pace?.spend.tiktokEstimate
                ? ` · TikTok ≈ con el ${shortDate(pace.spend.tiktokEstimate.fromDate)}`
                : ""}
              .
            </small>
          </div>
        </div>
        {projectionLine && (
          <p className={rs.projection}>
            <TrendingUp aria-hidden="true" />
            {projectionLine}
          </p>
        )}
      </section>

      <div className={rs.columns}>
        <section className={rs.card} aria-labelledby="resumen-decisiones">
          <div className={rs.cardHead}>
            <h2 id="resumen-decisiones">Decisiones pendientes</h2>
            <p>CPA real del {window3}</p>
          </div>
          <ul className={rs.counters}>
            <Counter
              value={counts?.escalar ?? null}
              loading={decisions.loading}
              label="Campañas para escalar"
              detail={`CPA real ≤ ${usd(DECISION_RULES.targetCpaUsd)} y ${count(DECISION_RULES.scaleMinRealOrders)}+ pedidos reales`}
              icon={<TrendingUp aria-hidden="true" />}
              tone="good"
              onClick={go("acciones", "decisiones-escalar")}
            />
            <Counter
              value={lowerOff}
              loading={decisions.loading}
              label="Para bajar o apagar"
              detail={
                counts
                  ? `${count(counts.bajar)} bajar · ${count(counts.apagar)} apagar`
                  : `CPA real sobre ${usd(DECISION_RULES.targetCpaUsd)}`
              }
              icon={<TrendingDown aria-hidden="true" />}
              tone="bad"
              onClick={go("acciones", "decisiones-bajar")}
            />
            <Counter
              value={
                decisions.creativesStatus === "ready"
                  ? (counts?.costCap ?? 0)
                  : null
              }
              loading={decisions.creativesStatus === "loading"}
              label="Creativos listos para COST CAP"
              detail={
                decisions.creativesStatus === "unavailable"
                  ? "Anuncios no disponibles"
                  : `≈ más de ${count(DECISION_RULES.costCapMoreThanOrders)} pedidos reales y CPA real < ${usd(DECISION_RULES.costCapMaxCpaUsd)}`
              }
              icon={<Target aria-hidden="true" />}
              tone="neutral"
              onClick={go("acciones", "decisiones-costcap")}
            />
          </ul>
          {decisions.error && !decisions.loading ? (
            <p className={rs.quiet} role="alert">
              {decisions.error}
            </p>
          ) : (
            counts &&
            (counts.aprendizaje > 0 || counts.todayAlerts > 0) && (
              <p className={rs.aside}>
                {counts.aprendizaje > 0 && (
                  <span>
                    <Hourglass aria-hidden="true" />
                    {count(counts.aprendizaje)} en aprendizaje: no se escalan
                    todavía.
                  </span>
                )}
                {counts.todayAlerts > 0 && (
                  <span>
                    <CircleAlert aria-hidden="true" />
                    Hoy: {count(counts.todayAlerts)}{" "}
                    {counts.todayAlerts === 1
                      ? "campaña con alerta"
                      : "campañas con alerta"}
                    .
                  </span>
                )}
              </p>
            )
          )}
          <p className={rs.foot}>
            Por campaña, con los pedidos reales repartidos por producto (≈).
            Hoy solo avisa; no cambia la acción.
          </p>
        </section>

        <section className={rs.card} aria-labelledby="resumen-productos">
          <div className={rs.cardHead}>
            <h2 id="resumen-productos">Productos</h2>
            <p>Los 5 con más pedidos reales del período</p>
          </div>
          <ProductList
            rows={products}
            loading={sourcesLoading}
            max={Math.max(1, ...products.map((p) => p.realOrders))}
          />
          <p className={rs.foot}>
            Empujar: CPA real ≤ {usd(t.cpaUsd)} y stock para{" "}
            {count(t.stockYellowDays)} días o más. Frenar: CPA real sobre la
            meta o stock para menos de {count(t.stockRedDays)} días.
          </p>
        </section>
      </div>

      {broken.length ? (
        <section
          className={rs.card}
          aria-labelledby="resumen-roto"
        >
          <div className={rs.cardHead}>
            <h2 id="resumen-roto">Qué está roto</h2>
          </div>
          <ul className={rs.brokenList}>
            {broken.map((item) => (
              <li key={item.key} data-tone={item.tone}>
                {item.tone === "risk" ? (
                  <AlertTriangle aria-hidden="true" />
                ) : (
                  <CircleAlert aria-hidden="true" />
                )}
                <div>
                  <strong>
                    <span className="sr-only">
                      {item.tone === "risk" ? "Urgente: " : "Revisar: "}
                    </span>
                    {item.title}
                  </strong>
                  <span>{item.detail}</span>
                </div>
                <button
                  type="button"
                  onClick={go(item.target.view, item.target.anchor)}
                >
                  {item.link}
                  <ArrowRight aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className={rs.allGood} role="status">
          {checking ? (
            <>
              <Hourglass aria-hidden="true" />
              Revisando cuentas, fuentes, píxel, cancelaciones e inventario…
            </>
          ) : (
            <>
              <CheckCircle2 aria-hidden="true" />
              Todo en orden: cuentas, fuentes, píxel, cancelaciones e
              inventario.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Counter({
  value,
  loading,
  label,
  detail,
  icon,
  tone,
  onClick,
}: {
  value: number | null;
  loading: boolean;
  label: string;
  detail: string;
  icon: ReactNode;
  tone: Tone;
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" className={rs.counter} onClick={onClick}>
        <span className={rs.counterIcon} data-tone={tone}>
          {icon}
        </span>
        <span className={rs.counterText}>
          <strong>{value == null ? (loading ? "…" : "—") : count(value)}</strong>
          <span>{label}</span>
          <small>{detail}</small>
        </span>
        <ArrowRight className={rs.counterArrow} aria-hidden="true" />
        <span className="sr-only">Ver en Acciones</span>
      </button>
    </li>
  );
}

const TAG: Record<ProductHighlight["tag"], { text: string; tone: Tone }> = {
  empujar: { text: "Empujar", tone: "good" },
  frenar: { text: "Frenar", tone: "bad" },
  neutral: { text: "Neutral", tone: "neutral" },
};

function ProductList({
  rows,
  loading,
  max,
}: {
  rows: ProductHighlight[];
  loading: boolean;
  max: number;
}) {
  if (!rows.length)
    return <p className={rs.quiet}>Sin pedidos con producto en el período.</p>;
  return (
    <ol className={rs.products}>
      <li className={rs.productHead} aria-hidden="true">
        <span>Producto</span>
        <span>Pedidos reales</span>
        <span>CPA real</span>
        <span>Stock</span>
        <span />
      </li>
      {rows.map((p) => {
        const tag = TAG[p.tag];
        const cpaText = loading
          ? "…"
          : p.cpaReal == null
            ? (p.cpaNote ?? "Sin datos")
            : Number.isFinite(p.cpaReal)
              ? `${p.approximate ? "≈ " : ""}${usd(p.cpaReal)}`
              : "Sin pedidos reales";
        const stockText = loading ? "…" : p.coverage.label;
        return (
          <li key={p.key} className={rs.product}>
            <div className={rs.productName}>
              <span title={p.name}>{p.name}</span>
              <span className={rs.bar} aria-hidden="true">
                <span style={{ width: `${(p.realOrders / max) * 100}%` }} />
              </span>
            </div>
            <span className={rs.cell}>
              <small className={rs.cellLabel}>Pedidos reales</small>
              {count(p.realOrders)}
            </span>
            <span
              className={rs.cell}
              data-risk={
                p.cpaReal != null && p.cpaReal > t.cpaUsd ? "true" : undefined
              }
            >
              <small className={rs.cellLabel}>CPA real</small>
              {cpaText}
            </span>
            <span
              className={rs.cell}
              data-risk={p.coverage.tone === "red" ? "true" : undefined}
            >
              <small className={rs.cellLabel}>Stock</small>
              {stockText}
            </span>
            <span className={rs.tagCell}>
              <Status
                tone={tag.tone}
                icon={
                  p.tag === "empujar" ? (
                    <TrendingUp aria-hidden="true" />
                  ) : p.tag === "frenar" ? (
                    <TrendingDown aria-hidden="true" />
                  ) : (
                    <span className={rs.dash} aria-hidden="true" />
                  )
                }
              >
                {tag.text}
              </Status>
              <small className={rs.reason}>{p.reason}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
