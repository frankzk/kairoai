"use client";
import type { ReactNode } from "react";
import { Hourglass, Target, TrendingDown, TrendingUp } from "lucide-react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { CharlieReport, UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import {
  DECISION_RULES,
  type CampaignDecision,
  type CreativeDecision,
} from "@/lib/marketing-decisions";
import { decimalText } from "@/lib/marketing-copy";
import { count, money } from "./format";
import { CampaignActions } from "./CampaignActions";
import { CostCapControl } from "./CostCapControl";
import { useCampaignActions } from "./useCampaignActions";
import { useDecisions } from "./useDecisions";
import type { MarketingChanges } from "./useMarketing";
import r from "./team-report.module.css";
import rs from "./resumen.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
const usd = (value: number | null) => money(value, "USD");
const orders = (value: number | null) =>
  value == null
    ? "Sin datos"
    : Number.isInteger(value)
      ? count(value)
      : decimalText(value);

/**
 * Acciones (vista del media buyer). Parte 1: la lista de decisiones que
 * cuentan los contadores del Resumen y, debajo, las tablas que ya existían
 * ("Qué hacer hoy con cada campaña" y "Control de las COST CAP").
 */
export function ActionsView({
  data,
  settings,
  fx,
  actions,
  control,
  changes,
  costCapAds,
  canEdit,
  saving,
  save,
  logChange,
  filterLabel,
}: {
  data: MarketingSummary;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  actions: Resource<MarketingSources>;
  control: Resource<MarketingControl>;
  changes: Resource<MarketingChanges>;
  costCapAds: Resource<CharlieReport>;
  canEdit: boolean;
  saving: string;
  save: Save;
  logChange: (body: Record<string, unknown>) => Promise<string | null>;
  filterLabel: string | null;
}) {
  const { actionResult, actionRows, costCap, metaAccounts } =
    useCampaignActions({ data, actions, control, changes, settings, fx });
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
  const of = (action: CampaignDecision["action"]) =>
    decisions.campaigns?.filter((c) => c.action === action) ?? [];
  return (
    <div className={r.report}>
      <section className={r.section} aria-labelledby="decisiones-title">
        <div className={r.sectionHead}>
          <div>
            <p className={r.kicker}>Decisiones de hoy</p>
            <h2 id="decisiones-title">Qué tocar hoy</h2>
            <p>
              CPA real de los últimos {count(DECISION_RULES.windowDays)} días
              completos (gasto ÷ pedidos reales de iComfly, sin anulados), por
              campaña. Los pedidos reales se reparten por producto (≈). Hoy solo
              avisa.
            </p>
          </div>
        </div>
        {decisions.loading && !decisions.campaigns ? (
          <p role="status">Consultando campañas y pedidos reales…</p>
        ) : !decisions.campaigns ? (
          <p role="alert" className={r.risk}>
            {decisions.error || "No se pudieron evaluar las campañas."}
          </p>
        ) : (
          <div className={r.alertGrid}>
            <Group
              id="decisiones-escalar"
              title="Escalar"
              icon={<TrendingUp aria-hidden="true" />}
              rows={of("escalar")}
              empty="Ninguna campaña cumple CPA real ≤ meta con 5 o más pedidos reales."
            />
            <Group
              id="decisiones-bajar"
              title="Bajar o apagar"
              icon={<TrendingDown aria-hidden="true" />}
              rows={[...of("apagar"), ...of("bajar")]}
              empty="Ninguna campaña sobre la meta."
            />
            <div id="decisiones-costcap">
              <h3 className={rs.groupTitle}>
                <Target aria-hidden="true" />
                Pasar a COST CAP
                {decisions.creatives
                  ? ` · ${count(decisions.creatives.length)}`
                  : ""}
              </h3>
              {decisions.creativesStatus !== "ready" ? (
                <p className={r.alert}>
                  {decisions.creativesStatus === "loading"
                    ? "Consultando anuncios de los últimos 3 días…"
                    : decisions.creativesError ||
                      "Anuncios no disponibles."}
                </p>
              ) : decisions.creatives?.length ? (
                decisions.creatives.map((c) => (
                  <CreativeLine key={c.key} creative={c} />
                ))
              ) : (
                <p className={r.alert}>
                  Ningún anuncio con más de{" "}
                  {count(DECISION_RULES.costCapMoreThanOrders)} pedidos reales y
                  CPA real menor a {usd(DECISION_RULES.costCapMaxCpaUsd)}.
                </p>
              )}
            </div>
          </div>
        )}
        {of("aprendizaje").length > 0 && (
          <Group
            id="decisiones-aprendizaje"
            title="En aprendizaje (no se escalan todavía)"
            icon={<Hourglass aria-hidden="true" />}
            rows={of("aprendizaje")}
            empty=""
          />
        )}
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
        canEdit={canEdit}
        saving={saving}
        save={save}
        logChange={logChange}
        filterLabel={filterLabel}
      />
      <CostCapControl
        control={costCap}
        loading={actions.loading || control.loading}
        error={actions.error}
        filterLabel={filterLabel}
      />
    </div>
  );
}

function Group({
  id,
  title,
  icon,
  rows,
  empty,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  rows: CampaignDecision[];
  empty: string;
}) {
  return (
    <div id={id}>
      <h3 className={rs.groupTitle}>
        {icon}
        {title} · {count(rows.length)}
      </h3>
      {rows.length ? (
        rows.map((d) => (
          <p
            key={d.key}
            className={`${r.alert} ${d.action === "apagar" || d.action === "bajar" ? r.alertRisk : ""}`}
          >
            <strong>
              {d.label} · {d.name}
            </strong>
            {d.accountLabel}
            {d.product ? ` · ${d.product}` : ""} · {d.detail}
            {d.approximate ? " (≈)" : ""}
            {d.levelNote && <small> {d.levelNote}</small>}
            {d.todayAlert && <small> {d.todayAlert}</small>}
          </p>
        ))
      ) : (
        <p className={r.alert}>{empty}</p>
      )}
    </div>
  );
}

function CreativeLine({ creative: c }: { creative: CreativeDecision }) {
  return (
    <p className={r.alert}>
      <strong>{c.adName}</strong>
      {c.accountLabel} · {c.campaignName}
      {c.product ? ` · ${c.product}` : ""} · {c.basis === "estimado" ? "≈ " : ""}
      {orders(c.real)} pedidos reales, CPA real{" "}
      {c.basis === "estimado" ? "≈ " : ""}
      {usd(c.cpaReal)} con {usd(c.spendUsd)} en 3 días.
    </p>
  );
}
