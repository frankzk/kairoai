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
    // Subtraction needs the product catalogue and the assignments to turn
    // orders into real orders per ad (UTM + share by product).
    summary: ["report", "summary", "details", "trends", "subtraction"].includes(
      view,
    ),
    settings:
      view === "report" ||
      view === "details" ||
      view === "trends" ||
      view === "subtraction" ||
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
    /** Real orders of today and the 13 previous days (goals, actions, COST CAP). */
    control: view === "report",
    /** Real orders of the selected period (channel cards, subtraction). */
    periodControl: view === "report" || view === "subtraction",
    /** Campaign actions: budgets, bids, lifetime and Meta activity of the last 14 days. */
    actions: view === "report",
    changes: view === "report",
    inventory: view === "report",
  };
}
