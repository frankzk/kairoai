"use client";
import { useMemo } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type { CharlieReport, UsdRate } from "@/lib/marketing-charlie-types";
import type { CampaignActionRow } from "@/lib/marketing-actions";
import { buildRealEstimate } from "@/lib/marketing-real-cpa";
import {
  buildCampaignDecisions,
  buildCreativeDecisions,
  decisionChanges,
  decisionCounts,
} from "@/lib/marketing-decisions";
import type { MarketingChanges } from "./useMarketing";

type Resource<T> = { data: T | null; loading: boolean; error: string };

/**
 * Pending decisions (Resumen counters, Acciones list): campaigns by the
 * 3-day real CPA and ads ready for a COST CAP. Uses the action rows already
 * built from actions + control; the ads come from the deferred 3-day report.
 */
export function useDecisions(input: {
  data: MarketingSummary;
  actions: Resource<MarketingSources>;
  control: Resource<MarketingControl>;
  changes: Resource<MarketingChanges>;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  /** null until the action rows are built. */
  actionRows: CampaignActionRow[] | null;
  costCapAds: Resource<CharlieReport>;
}) {
  const { data, actions, control, changes, settings, fx, actionRows } = input;
  const campaigns = useMemo(
    () =>
      actionRows && control.data
        ? buildCampaignDecisions({
            rows: actionRows,
            changes: decisionChanges(
              actions.data?.meta.data?.accounts ?? [],
              changes.data?.changes ?? [],
            ),
            now: new Date(control.data.generatedAt),
          })
        : null,
    [actionRows, control.data, actions.data, changes.data],
  );
  const estimates = useMemo(
    () =>
      actions.data && control.data
        ? buildRealEstimate({
            summary: data,
            sources: actions.data,
            settings,
            control: control.data,
            fx,
          }).estimates
        : null,
    [actions.data, control.data, data, settings, fx],
  );
  const report = input.costCapAds.data;
  const creatives = useMemo(
    () =>
      actionRows && estimates && control.data && report?.status === "ready"
        ? buildCreativeDecisions({
            report,
            rows: actionRows,
            estimates,
            days: control.data.days,
            fx,
            now: new Date(control.data.generatedAt),
          })
        : null,
    [actionRows, estimates, control.data, report, fx],
  );
  const loading = actions.loading || control.loading || changes.loading;
  const creativesStatus: "ready" | "loading" | "unavailable" = creatives
    ? "ready"
    : loading || input.costCapAds.loading
      ? "loading"
      : "unavailable";
  const counts = useMemo(
    () => (campaigns ? decisionCounts(campaigns, creatives) : null),
    [campaigns, creatives],
  );
  return {
    campaigns,
    creatives,
    counts,
    loading,
    creativesStatus,
    error:
      actions.error ||
      control.error ||
      (actions.data && !control.data && !control.loading
        ? "Pedidos reales no disponibles."
        : ""),
    creativesError:
      input.costCapAds.error ||
      (report && report.status !== "ready" ? report.message : ""),
  };
}
