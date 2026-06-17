import { describe, expect, it } from "vitest";
import { isCodMismatch } from "../lib/finance-orders";

// Detector de discrepancia COD: el COD liquidado debe coincidir EXACTAMENTE con
// el total Shopify (a nivel centavo). Cualquier diferencia >= 1 centavo marca.
// El ingreso siempre usa el COD liquidado; esto solo levanta una alerta de
// verificacion manual.
describe("isCodMismatch", () => {
  it("no marca cuando coinciden exactamente (a nivel centavo)", () => {
    expect(isCodMismatch(10000, 10000)).toBe(false);
    expect(isCodMismatch(10000.004, 10000)).toBe(false); // ruido sub-centavo
    expect(isCodMismatch(12345.67, 12345.67)).toBe(false);
  });

  it("marca cualquier diferencia de 1 centavo o mas", () => {
    expect(isCodMismatch(10000, 10000.01)).toBe(true); // 1 centavo
    expect(isCodMismatch(10000, 10400)).toBe(true); // 4%
    expect(isCodMismatch(10500, 10000)).toBe(true); // 5%
    expect(isCodMismatch(9999, 10000)).toBe(true);
  });

  it("no marca si no hubo COD cobrado o no hay total Shopify", () => {
    expect(isCodMismatch(0, 10000)).toBe(false);
    expect(isCodMismatch(10000, 0)).toBe(false);
    expect(isCodMismatch(-500, 10000)).toBe(false); // retorno: COD <= 0
  });
});
