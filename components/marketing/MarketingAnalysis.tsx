"use client";
import { useMemo } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type {
  AccountsPayload,
  OrderFactsPayload,
  ProductInsightsPayload,
  SegmentationPayload,
} from "@/lib/marketing-insights-types";
import { buildCampaignActionRows } from "@/lib/marketing-actions";
import { assignedCampaigns } from "@/lib/marketing-real-cpa";
import { shortDate } from "./format";
import { InventoryDecision, useInventoryDecision } from "./InventoryDecision";
import { UnadvertisedStock } from "./UnadvertisedStock";
import { CancellationsPanel } from "./CancellationsPanel";
import { OrderOriginPanel } from "./OrderOriginPanel";
import { PathTo200 } from "./PathTo200";
import { AccountStatus } from "./AccountStatus";
import { SegmentationPanel } from "./SegmentationPanel";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };

/** In-page index of the tab. Each slice appends its section here. */
const SECTIONS: Array<[id: string, label: string]> = [
  ["analisis-inventario", "01 Inventario"],
  ["analisis-sin-publicidad", "02 Stock sin publicidad"],
  ["analisis-cancelaciones", "03 Cancelaciones"],
  ["analisis-origen", "04 Origen y complementos"],
  ["analisis-camino", "05 Camino a 200"],
  ["analisis-cuentas", "06 Estado de las cuentas"],
  ["analisis-segmentacion", "07 Segmentación"],
];

export interface MarketingAnalysisProps {
  data: MarketingSummary;
  model: MarketingIntelligence;
  /** Basic sources: spend of the period and the inventory (CSV or ShipHero). */
  sources: Resource<MarketingSources>;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  /** Sources with budgets, status, lifetime and daily pixel (today−13..today). */
  actions: Resource<MarketingSources>;
  /** Real orders of today and the 13 previous days. */
  control: Resource<MarketingControl>;
  /** Per-variant units and waiting orders (finance dataset). */
  productsInsights: Resource<ProductInsightsPayload>;
  /** Anonymous order facts of the dashboard period (M7, M8, M10, M12). */
  ordersInsights: Resource<OrderFactsPayload>;
  /** Account status and applied rates (M11). */
  accounts: Resource<AccountsPayload>;
  segmentation: Resource<SegmentationPayload>;
  loadSegmentation: (from: string, to: string) => Promise<void>;
  saveRate: (
    currency: "CRC" | "PEN",
    rate: number | null,
  ) => Promise<string | null>;
  /** Marketing editor (not read-only). */
  canEdit: boolean;
}

/** "Análisis para decidir": the heavier modules (5–12), each with its own loading state. */
export function MarketingAnalysis(props: MarketingAnalysisProps) {
  const { data, model, sources, settings, fx, actions, control } = props;
  // Campaign rows (status, recent spend, product) shared by the sections.
  const actionResult = useMemo(
    () =>
      actions.data && !control.loading
        ? buildCampaignActionRows({
            summary: data,
            sources: actions.data,
            control: control.data,
            settings,
            manualChanges: [],
            fx,
          })
        : null,
    [actions.data, control.loading, control.data, data, settings, fx],
  );
  const actionRows = useMemo(
    () => (actionResult ? [...actionResult.meta, ...actionResult.tiktok] : []),
    [actionResult],
  );
  const campaignMembers = useMemo(
    () =>
      actions.data
        ? new Map(
            assignedCampaigns(data, actions.data, settings).map((c) => [
              c.key,
              c.members,
            ]),
          )
        : null,
    [actions.data, data, settings],
  );
  const inventory = useInventoryDecision({
    data,
    model,
    sources: sources.data,
    settings,
    actionRows,
    campaignMembers,
    insights: props.productsInsights.data,
  });
  return (
    <div className={r.report}>
      <div className={r.reportHeading}>
        <div>
          <p className={r.kicker}>Análisis</p>
          <h2>Análisis para decidir</h2>
        </div>
        <span className={r.period}>
          Período: {shortDate(data.period.from)} – {shortDate(data.period.to)}
        </span>
      </div>
      <nav className={r.analysisNav} aria-label="Secciones del análisis">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <InventoryDecision
        decision={inventory}
        sources={sources.data}
        sourcesLoading={sources.loading}
        actionsLoading={actions.loading || control.loading}
        insights={props.productsInsights}
      />
      <UnadvertisedStock
        data={data}
        model={model}
        sources={sources}
        settings={settings}
        fx={fx}
        actions={actions}
        insights={props.productsInsights}
      />
      <CancellationsPanel orders={props.ordersInsights} />
      <OrderOriginPanel orders={props.ordersInsights} />
      <PathTo200
        data={data}
        settings={settings}
        fx={fx}
        actions={actions}
        control={control}
        orders={props.ordersInsights}
      />
      <AccountStatus
        accounts={props.accounts}
        settings={settings}
        fx={fx}
        canEdit={props.canEdit}
        saveRate={props.saveRate}
      />
      <SegmentationPanel
        period={data.period}
        orders={props.ordersInsights}
        segmentation={props.segmentation}
        loadSegmentation={props.loadSegmentation}
        accounts={props.accounts}
        settings={settings}
        fx={fx}
      />
    </div>
  );
}
