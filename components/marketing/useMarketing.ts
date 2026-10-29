"use client";
import { useEffect, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import { periodQuery, type MarketingPeriod } from "@/lib/marketing-dates";

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
  const current =
    url && state.requestKey !== url
      ? { data: null, loading: true, error: "" }
      : state;
  return {
    ...current,
    setState: (next: Resource<T>) => setState({ ...next, requestKey: url }),
  };
}
export function useMarketing(period: MarketingPeriod | null, revision: number) {
  const query = period ? periodQuery(period) : null;
  const summary = useResource<MarketingSummary>(
    query ? `/api/marketing/summary?${query}` : null,
    revision,
  );
  const sources = useResource<MarketingSources>(
    query ? `/api/marketing/sources?${query}` : null,
    revision,
  );
  const settings = useResource<MarketingSettings>(
    period ? "/api/marketing/settings?store=mireva-cr" : null,
    revision,
  );
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
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No se pudo guardar.",
        );
      }
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
  return { summary, sources, settings, saving, saveError, saved, save };
}
