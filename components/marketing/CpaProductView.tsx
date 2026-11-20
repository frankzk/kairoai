"use client";
// Pestaña "CPA por producto" de Marketing (20/11/2026): la tabla de CPA por
// producto y canal (Landing / WhatsApp), por orden y por unidad, a mano en su
// propia pestaña en vez de al fondo del Reporte completo. Usa el período de
// arriba; las reglas viven en lib/marketing-channel-cpa.ts.
import { useMemo } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import { productChannelCpa } from "@/lib/marketing-channel-cpa";
import { periodLabelText } from "@/lib/marketing-copy";
import { marketingDate } from "@/lib/marketing-dates";
import { ChannelCpaTable } from "./ChannelCpaTable";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };

export function CpaProductView({
  data,
  sources,
  settings,
  fx,
  periodControl,
  loading,
  onAssign,
}: {
  data: MarketingSummary;
  sources: MarketingSources | null;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  periodControl: Resource<MarketingControl>;
  loading: boolean;
  onAssign: () => void;
}) {
  const today = marketingDate();
  const report = useMemo(
    () =>
      sources && periodControl.data
        ? productChannelCpa({
            summary: data,
            sources,
            settings,
            control: periodControl.data,
            fx,
            from: data.period.from,
            to: data.period.to,
          })
        : null,
    [data, sources, settings, periodControl.data, fx],
  );
  return (
    <div className={r.report}>
      <ChannelCpaTable
        report={report}
        loading={loading || periodControl.loading}
        error={
          periodControl.error ||
          (data.period.to > today
            ? "El período incluye fechas futuras: elige un rango hasta hoy."
            : "")
        }
        periodText={periodLabelText(data.period, today)}
        onAssign={onAssign}
      />
    </div>
  );
}
