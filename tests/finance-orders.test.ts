import { describe, expect, it } from "vitest";
import { getReportingTrackingStatus } from "../lib/reporting-tracking-status";

describe("getReportingTrackingStatus", () => {
  it("prioriza el resultado final visible sobre un estado operativo cacheado", () => {
    expect(
      getReportingTrackingStatus({
        tracking_status: "pending",
        tracking_badge_status: "pending",
        tracking_label: "No entregado",
      })
    ).toBe("not_delivered");
  });

  it("conserva los estados finales consolidados del badge", () => {
    expect(
      getReportingTrackingStatus({
        tracking_status: "en_route",
        tracking_badge_status: "delivered",
        tracking_label: "Entregado",
      })
    ).toBe("delivered");
  });

  it("trata anulaciones como estado final para los reportes", () => {
    expect(
      getReportingTrackingStatus({
        tracking_status: "pending",
        tracking_badge_status: "annulled",
        tracking_label: "Anulado",
      })
    ).toBe("annulled");
  });

  it("mantiene el estado operativo cuando no existe un resultado final", () => {
    expect(
      getReportingTrackingStatus({
        tracking_status: "en_route_retry",
        tracking_badge_status: "en_route_retry",
        tracking_label: "Reintento (2)",
      })
    ).toBe("en_route_retry");
  });
});
