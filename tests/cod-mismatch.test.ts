import { describe, expect, it } from "vitest";
import { isCodMismatch } from "../lib/finance-orders";

// Detector de discrepancia COD: el COD liquidado vs el total Shopify. Tolerancia
// relativa del 5% (estricta: 5% exacto NO marca). El ingreso siempre usa el COD
// liquidado; esto solo levanta una alerta de verificacion manual.
describe("isCodMismatch", () => {
  it("no marca cuando los montos coinciden o difieren poco", () => {
    expect(isCodMismatch(10000, 10000)).toBe(false);
    expect(isCodMismatch(10000, 10400)).toBe(false); // 4%
    expect(isCodMismatch(10500, 10000)).toBe(false); // 5% exacto (no es > 5%)
  });

  it("marca cuando difieren mas que la tolerancia", () => {
    expect(isCodMismatch(11000, 10000)).toBe(true); // +10%
    expect(isCodMismatch(9000, 10000)).toBe(true); // -10%
    expect(isCodMismatch(10600, 10000)).toBe(true); // 6%
  });

  it("no marca si no hubo COD cobrado o no hay total Shopify", () => {
    expect(isCodMismatch(0, 10000)).toBe(false);
    expect(isCodMismatch(10000, 0)).toBe(false);
    expect(isCodMismatch(-500, 10000)).toBe(false); // retorno: COD <= 0
  });
});
