export type MarketingView =
  | "report"
  | "summary"
  | "details"
  | "trends"
  | "sources"
  | "matrix"
  | "structure"
  | "subtraction";
/** The executive view must never depend on the account-wide creative catalogue. */
export function marketingLoadPlan(
  view: MarketingView,
  expandedOverview = false,
) {
  return {
    summary: ["report", "summary", "details", "trends"].includes(view),
    settings:
      view === "report" ||
      view === "details" ||
      view === "trends" ||
      (view === "summary" && expandedOverview),
    sourceScope:
      view === "report"
        ? ("report" as const)
        : view === "summary"
          ? ("overview" as const)
          : ["details", "trends", "structure"].includes(view)
            ? ("details" as const)
            : ("basic" as const),
    reportScope:
      view === "structure"
        ? ("structure" as const)
        : view === "matrix" || view === "subtraction"
          ? ("ads" as const)
          : null,
  };
}
