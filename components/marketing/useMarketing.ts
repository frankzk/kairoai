"use client";
import { useEffect, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import {
  marketingDate,
  marketingPeriod,
  shiftDate,
  periodQuery,
  type MarketingPeriod,
} from "@/lib/marketing-dates";
import type { MarketingAttribution } from "@/lib/marketing-attribution";
import type { CharlieRevenue } from "@/lib/marketing-charlie-revenue";
import { marketingLoadPlan, type MarketingView } from "@/lib/marketing-loading";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type { ManualCampaignChange } from "@/lib/marketing-source-types";

/** Manual change log (`/api/marketing/changes`). */
export interface MarketingChanges {
  status: "ok" | "pending_migration";
  message?: string;
  changes: ManualCampaignChange[];
}
/** Uploaded product_table snapshots (`/api/marketing/inventory`), without items. */
export interface InventorySnapshotMeta {
  snapshotDate: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  rowCount: number;
  errorCount: number;
  availableColumn: string;
  skus: number;
}
export interface MarketingInventoryStatus {
  status: "ok" | "pending_migration";
  message?: string;
  today: string;
  latest: InventorySnapshotMeta | null;
  previous: InventorySnapshotMeta | null;
  restocked: Array<{ sku: string; delta: number }>;
}

/** JSON request to a Marketing route; the error is the route's Spanish message. */
export async function sendMarketing<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        error:
          typeof result.error === "string"
            ? result.error
            : "No se pudo guardar. Vuelve a intentarlo.",
      };
    return { ok: true, data: result as T };
  } catch {
    return { ok: false, error: "No se pudo guardar. Revisa la conexión." };
  }
}

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string;
}
export function useResource<T>(url: string | null, revision: number) {
  const [state, setState] = useState<
    Resource<T> & { requestKey: string | null }
  >({ data: null, loading: true, error: "", requestKey: null });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState({ data: null, loading: true, error: "", requestKey: url });
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "No se pudo consultar esta información. Vuelve a actualizar.",
          );
        return (await response.json()) as T;
      })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: "", requestKey: url });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            data: null,
            loading: false,
            error:
              "No se pudo consultar esta información. Vuelve a actualizar.",
            requestKey: url,
          });
      });
    return () => controller.abort();
  }, [url, revision]);
  const current = !url
    ? { data: null, loading: false, error: "" }
    : state.requestKey !== url
      ? { data: null, loading: true, error: "" }
      : state;
  return {
    ...current,
    setState: (next: Resource<T>) => setState({ ...next, requestKey: url }),
  };
}
export function useMarketing(
  period: MarketingPeriod | null,
  revision: number,
  view: MarketingView = "summary",
  expandedOverview = false,
  financialRevision = 0,
) {
  const query = period ? periodQuery(period) : null;
  const plan = marketingLoadPlan(view, expandedOverview);
  const summary = useResource<
    MarketingSummary & {
      charlieBusiness?: CharlieRevenue | null;
      charlieError?: string;
      attribution?: MarketingAttribution | null;
      attributionError?: string;
    }
  >(
    query && plan.summary
      ? // The report's channel cards use /api/marketing/control (A6), not the 4 s attribution.
        `/api/marketing/summary?${query}&include_charlie=1`
      : null,
    revision + financialRevision,
  );
  const sources = useResource<MarketingSources>(
    query ? `/api/marketing/sources?${query}&scope=${plan.sourceScope}` : null,
    revision,
  );
  const today = marketingDate();
  const recentPeriod = marketingPeriod(shiftDate(today, -7), today)!;
  const recent = useResource<MarketingSources>(
    period && view === "report"
      ? `/api/marketing/sources?${periodQuery(recentPeriod)}&scope=report`
      : null,
    revision,
  );
  const settings = useResource<MarketingSettings>(
    period && plan.settings ? "/api/marketing/settings?store=mireva-cr" : null,
    revision,
  );
  // Real orders: today and the 13 previous days (goals, actions, COST CAP),
  // and the selected period (channel cards, subtraction). A period inside the
  // 14-day window reuses the first request.
  const windowPeriod = marketingPeriod(shiftDate(today, -13), today)!;
  const control = useResource<MarketingControl>(
    period && plan.control
      ? `/api/marketing/control?${periodQuery(windowPeriod)}`
      : null,
    revision,
  );
  const inWindow = Boolean(
    period &&
    plan.control &&
    period.from >= windowPeriod.from &&
    period.to <= windowPeriod.to,
  );
  const ownPeriodControl = useResource<MarketingControl>(
    period && plan.periodControl && !inWindow && period.to <= today
      ? `/api/marketing/control?${periodQuery(period)}`
      : null,
    revision,
  );
  const periodControl = inWindow ? control : ownPeriodControl;
  const actions = useResource<MarketingSources>(
    period && plan.actions
      ? `/api/marketing/sources?${periodQuery(windowPeriod)}&scope=actions`
      : null,
    revision,
  );
  const [changesRevision, setChangesRevision] = useState(0);
  const changes = useResource<MarketingChanges>(
    period && plan.changes
      ? "/api/marketing/changes?store=mireva-cr&days=30"
      : null,
    revision + changesRevision,
  );
  const inventory = useResource<MarketingInventoryStatus>(
    period && plan.inventory
      ? "/api/marketing/inventory?store=mireva-cr"
      : null,
    revision,
  );
  /** Saves a manual campaign change and reloads the change log. */
  async function logChange(body: Record<string, unknown>) {
    const result = await sendMarketing(
      "/api/marketing/changes?store=mireva-cr",
      "POST",
      body,
    );
    if (result.ok) setChangesRevision((value) => value + 1);
    return result.ok ? null : result.error;
  }
  const [saving, setSaving] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState("");
  async function save(key: string, body: Record<string, unknown>) {
    setSaving(key);
    setSaveError("");
    setSaved("");
    try {
      const response = await fetch("/api/marketing/settings?store=mireva-cr", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          ...(body.kind === "mapping" && period
            ? { from: period.from, to: period.to }
            : {}),
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No se pudo guardar.",
        );
      }
      const result = await response.json().catch(() => ({}));
      if (
        result.productMetric &&
        summary.data &&
        result.period?.from === summary.data.period.from &&
        result.period?.to === summary.data.period.to
      )
        summary.setState({
          data: {
            ...summary.data,
            groupedProducts: [
              ...(summary.data.groupedProducts ?? []).filter(
                (p) => p.key !== result.productMetric.key,
              ),
              result.productMetric,
            ],
          },
          loading: false,
          error: "",
        });
      const refreshed = await fetch("/api/marketing/settings?store=mireva-cr", {
        cache: "no-store",
      });
      if (!refreshed.ok)
        throw new Error(
          "El cambio se guardó, pero no se pudo actualizar la vista. Pulsa Actualizar.",
        );
      settings.setState({
        data: await refreshed.json(),
        loading: false,
        error: "",
      });
      setSaved(key);
      return true;
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar. Vuelve a intentarlo.",
      );
      return false;
    } finally {
      setSaving("");
    }
  }
  return {
    summary,
    sources,
    recent,
    settings,
    control,
    periodControl,
    actions,
    changes,
    inventory,
    logChange,
    saving,
    saveError,
    saved,
    save,
  };
}
