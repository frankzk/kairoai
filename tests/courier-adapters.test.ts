import { describe, expect, it } from "vitest";
import {
  getBuiltInCourierAdapter,
  normalizeCourierStatus,
  normalizeForzaGuideGeneric,
  normalizeGuideDefault,
} from "../lib/courier-adapters";

describe("courier adapters", () => {
  it("normaliza estados comunes de couriers a grupos internos", () => {
    expect(normalizeCourierStatus("Entregado")).toBe("delivered");
    expect(normalizeCourierStatus("No entregado")).toBe("not_delivered");
    expect(normalizeCourierStatus("Incidencia en la entrega", "FAILED")).toBe("incident");
    expect(normalizeCourierStatus("Recolectado")).toBe("en_route");
    expect(normalizeCourierStatus("Guia cancelada")).toBe("cancelled");
  });

  it("normaliza guias sin perder prefijos especificos", () => {
    expect(normalizeGuideDefault(" guia-123 ")).toBe("GUIA-123");
    expect(normalizeForzaGuideGeneric("26827471")).toBe("FD26827471");
    expect(normalizeForzaGuideGeneric("fd26827471")).toBe("FD26827471");
  });

  it("expone adapters built-in para Moovin, Forza, WYN y Boxful", () => {
    expect(getBuiltInCourierAdapter("moovin")?.supportsApiTracking).toBe(true);
    expect(getBuiltInCourierAdapter("forza")?.trackingUrl?.("123")).toContain("FD123");
    expect(getBuiltInCourierAdapter("wyn")?.trackingUrl?.("mlcr000051603sd")).toContain(
      "MLCR000051603SD"
    );
    expect(getBuiltInCourierAdapter("boxful")?.supportsFileImport).toBe(true);
    expect(getBuiltInCourierAdapter("unknown")).toBeNull();
  });
});
