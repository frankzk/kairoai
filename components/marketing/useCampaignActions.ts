"use client";
import { useMemo } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import { accountLabel, buildCampaignActionRows } from "@/lib/marketing-actions";
import { buildCostCapControl } from "@/lib/marketing-cost-cap";
import { assignedCampaigns } from "@/lib/marketing-real-cpa";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import type { MarketingChanges } from "./useMarketing";

type Resource<T> = { data: T | null; loading: boolean; error: string };

/**
 * "Qué hacer hoy con cada campaña" rows, the COST CAP control and the Meta
 * accounts of the action sources: one computation shared by the full report,
 * Resumen and Acciones (no extra request: actions + control + changes).
 */
export function useCampaignActions(input: {
  data: MarketingSummary;
  actions: Resource<MarketingSources>;
  control: Resource<MarketingControl>;
  changes: Resource<MarketingChanges>;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
}) {
  const { data, actions, control, changes, settings, fx } = input;
  const actionResult = useMemo(
    () =>
      actions.data && !control.loading
        ? buildCampaignActionRows({
            summary: data,
            sources: actions.data,
            control: control.data,
            settings,
            manualChanges: changes.data?.changes ?? [],
            fx,
          })
        : null,
    [
      actions.data,
      control.loading,
      control.data,
      data,
      settings,
      changes.data,
      fx,
    ],
  );
  const actionRows = useMemo(
    () => (actionResult ? [...actionResult.meta, ...actionResult.tiktok] : []),
    [actionResult],
  );
  const costCap = useMemo(
    () =>
      actionResult
        ? buildCostCapControl(actionRows, MARKETING_TARGETS, { fx })
        : null,
    [actionResult, actionRows, fx],
  );
  const metaAccounts = useMemo(
    () =>
      (actions.data?.meta.data?.accounts ?? []).map((a) => ({
        accountId: a.accountId,
        accountName: a.accountName || a.accountId,
        auto: accountLabel("meta", a.accountId, a.accountName || "", []),
      })),
    [actions.data],
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
  return { actionResult, actionRows, costCap, metaAccounts, campaignMembers };
}
