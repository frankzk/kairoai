import type { KpiRange, KpiWindow } from "./kpi-windows";

export interface KpiComparisonCopy {
  direction: "up" | "down" | "flat" | null;
  changeText: string;
  versusText: string;
  baselineText: string;
}

export function comparisonPeriodCopy(
  range: KpiRange,
  window: Pick<KpiWindow, "cutoffLabel">,
) {
  switch (range) {
    case "today":
      return { versus: "vs. ayer", baseline: "Ayer a esta hora" };
    case "yesterday":
      return { versus: "vs. anteayer", baseline: "Anteayer" };
    case "7d":
      return {
        versus: "vs. 7 días previos",
        baseline: "7 días previos a este corte",
      };
    case "30d":
      return {
        versus: "vs. 30 días previos",
        baseline: "30 días previos a este corte",
      };
    case "month":
      return {
        versus: "vs. mes anterior",
        baseline: "Mes anterior a este corte",
      };
    case "custom":
      return {
        versus: "vs. período previo",
        baseline: window.cutoffLabel
          ? "Período previo a este corte"
          : "Período previo",
      };
    default:
      return null;
  }
}

/** Text only: no change to the comparison window or metric calculation. */
export function buildKpiComparisonCopy(input: {
  range: KpiRange;
  window: Pick<KpiWindow, "prevStart" | "prevEnd" | "cutoffLabel">;
  deltaLabel: string | null;
  previousValue: string | null;
  unavailableText?: string;
}): KpiComparisonCopy | null {
  const period = comparisonPeriodCopy(input.range, input.window);
  if (
    !period ||
    input.window.prevStart == null ||
    input.window.prevEnd == null ||
    input.previousValue == null
  )
    return null;
  const magnitude = input.deltaLabel?.replace(/^[+−-]/, "") ?? null;
  const zero =
    magnitude != null && parseFloat(magnitude.replace(",", ".")) === 0;
  return {
    direction:
      magnitude == null
        ? null
        : zero
          ? "flat"
          : /^[−-]/.test(input.deltaLabel!)
            ? "down"
            : "up",
    changeText:
      magnitude == null
        ? (input.unavailableText ?? "Sin base comparable")
        : zero
          ? "Sin cambio"
          : magnitude,
    versusText: period.versus,
    baselineText: `${period.baseline}: ${input.previousValue}`,
  };
}

/** Used by Marketing: real orders today vs real orders yesterday, never created vs real. */
export function relativeChangeCopy(
  current: number,
  previous: number | null | undefined,
): { text: string; direction: "up" | "down" | "flat" | null } | null {
  if (
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  )
    return null;
  if (previous === 0)
    return {
      text:
        current === 0
          ? "Sin cambio vs. ayer a esta hora"
          : "Sin base porcentual: ayer a esta hora había 0 pedidos reales",
      direction: current === 0 ? "flat" : null,
    };
  const change = (current / previous - 1) * 100;
  const percent = new Intl.NumberFormat("es-CR", {
    maximumFractionDigits: 1,
  }).format(Math.abs(change));
  const flat = Number(Math.abs(change).toFixed(1)) === 0;
  return {
    text: flat
      ? "Sin cambio vs. ayer a esta hora"
      : `${change > 0 ? "↑" : "↓"} ${percent}% vs. ayer a esta hora`,
    direction: flat ? "flat" : change > 0 ? "up" : "down",
  };
}
