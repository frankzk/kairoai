"use client";
import { useState } from "react";
import { periodQuery, type MarketingPeriod } from "@/lib/marketing-dates";
import type {
  CharlieReport,
  CharlieSettings,
} from "@/lib/marketing-charlie-types";
import type { CharlieRevenue } from "@/lib/marketing-charlie-revenue";
import { useResource } from "./useMarketing";
export function useCharlie(
  period: MarketingPeriod | null,
  revision: number,
  active: boolean,
) {
  const [businessRevision, setBusinessRevision] = useState(0);
  const query = period && active ? periodQuery(period) : null;
  const settings = useResource<CharlieSettings>(
    period ? "/api/marketing/charlie-settings?store=mireva-cr" : null,
    revision,
  );
  const report = useResource<CharlieReport>(
    query ? `/api/marketing/charlie?${query}` : null,
    revision,
  );
  const business = useResource<CharlieRevenue>(
    query ? `/api/marketing/charlie-business?${query}` : null,
    revision + businessRevision,
  );
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  async function save(key: string, body: Record<string, unknown>) {
    setSaving(key);
    setError("");
    try {
      const response = await fetch(
        "/api/marketing/charlie-settings?store=mireva-cr",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "No se pudo guardar.",
        );
      }
      const refreshed = await fetch(
        "/api/marketing/charlie-settings?store=mireva-cr",
        { cache: "no-store" },
      );
      if (!refreshed.ok)
        throw new Error(
          "El cambio se guardó. Pulsa Actualizar para verificar la configuración.",
        );
      settings.setState({
        data: await refreshed.json(),
        loading: false,
        error: "",
      });
      if (body.kind === "config") setBusinessRevision((value) => value + 1);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
      return false;
    } finally {
      setSaving("");
    }
  }
  return { settings, report, business, saving, error, save };
}
