export type MarketingView =
  | "resumen"
  | "acciones"
  | "report"
  | "summary"
  | "details"
  | "trends"
  | "sources"
  | "matrix"
  | "structure"
  | "subtraction"
  | "analysis";
/** The executive view must never depend on the account-wide creative catalogue. */
export function marketingLoadPlan(
  view: MarketingView,
  expandedOverview = false,
) {
  return {
    // Subtraction needs the product catalogue and the assignments to turn
    // orders into real orders per ad (UTM + share by product).
    summary: [
      "resumen",
      "acciones",
      "report",
      "summary",
      "details",
      "trends",
      "subtraction",
      "analysis",
    ].includes(view),
    settings:
      view === "resumen" ||
      view === "acciones" ||
      view === "report" ||
      view === "details" ||
      view === "trends" ||
      view === "subtraction" ||
      view === "analysis" ||
      (view === "summary" && expandedOverview),
    // Resumen and Acciones only need the period's campaign totals (no daily
    // rows, no hourly spend, no budgets): the lightest Meta read.
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
    /**
     * Today and the 7 previous days with hourly spend (today's pace): always
     * in the full report; in Resumen only when the period reaches today.
     */
    recent:
      view === "report"
        ? ("always" as const)
        : view === "resumen"
          ? ("includesToday" as const)
          : ("never" as const),
    /** Real orders of today and the 13 previous days (goals, actions, COST CAP). */
    control:
      view === "resumen" ||
      view === "acciones" ||
      view === "report" ||
      view === "analysis",
    /** Real orders of the selected period (channel cards, subtraction). */
    periodControl: view === "report" || view === "subtraction",
    /** Campaign actions: budgets, bids, lifetime and Meta activity of the last 14 days. */
    actions:
      view === "resumen" ||
      view === "acciones" ||
      view === "report" ||
      view === "analysis",
    changes: view === "resumen" || view === "acciones" || view === "report",
    inventory: view === "report" || view === "analysis",
    /** Account status and applied rates; in the report and Resumen it loads after the main resources. */
    accounts: view === "resumen" || view === "report" || view === "analysis",
    /** Anonymous order facts of the period (cancellations, origin, provinces). */
    ordersInsights: view === "analysis",
    /**
     * Resumen: order facts of the last 7 closed days for the cancellation
     * check, deferred like the account status (cached by the route).
     */
    cancellations: view === "resumen",
    /**
     * Resumen and Acciones: ads of the last 3 complete days (no creative
     * catalogue) for "creativos listos para COST CAP", deferred after the
     * main resources.
     */
    costCapAds: view === "resumen" || view === "acciones",
    /** Per-variant weekly units and waiting orders (finance dataset). */
    productsInsights: view === "analysis",
  };
}

/** The three top-level tabs of the Marketing page. */
export type MarketingTab = "resumen" | "acciones" | "detalle";

/** Detalle's sub-tabs, in order: everything that existed before the redesign. */
export const DETAIL_VIEWS: ReadonlyArray<[MarketingView, string]> = [
  ["report", "Reporte completo"],
  ["summary", "Decisión financiera"],
  ["matrix", "Matriz 4Pi"],
  ["structure", "Control y Testing"],
  ["subtraction", "Sustracción"],
  ["analysis", "Análisis"],
  ["trends", "Tendencias y reposición"],
  ["details", "Asignar productos"],
  ["sources", "Fuentes"],
];

export const MARKETING_VIEWS: readonly MarketingView[] = [
  "resumen",
  "acciones",
  ...DETAIL_VIEWS.map(([view]) => view),
];

export function marketingTab(view: MarketingView): MarketingTab {
  return view === "resumen" || view === "acciones" ? view : "detalle";
}

/**
 * `?view=` of the URL → view. Every value that existed keeps working and
 * opens the same content (view=report is "Detalle › Reporte completo"); the
 * aliases `detalle` and `reporte` open the full report; anything else or
 * nothing opens Resumen.
 */
export function viewFromParam(value: string | null | undefined): MarketingView {
  const v = (value ?? "").trim().toLowerCase();
  if ((MARKETING_VIEWS as readonly string[]).includes(v))
    return v as MarketingView;
  if (v === "detalle" || v === "reporte") return "report";
  return "resumen";
}
