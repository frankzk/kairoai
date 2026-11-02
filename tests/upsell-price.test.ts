import { describe, expect, it } from "vitest";
import { parseUpsellPrice } from "../lib/upsell-price";

describe("precio escrito del upsell", () => {
  it.each(["10900", "10.900", "10,900", "10 900", "10\u00a0900", "10\u202f900", " 10.900 "])("conserva los miles: %s", text => {
    expect(parseUpsellPrice(text)).toBe(10900);
  });
  it.each(["10900,50", "10900.50", "10.900,50", "10,900.50", "10 900,50"])("conserva centavos: %s", text => {
    expect(parseUpsellPrice(text)).toBe(10900.5);
  });
  it.each(["10.9", "10,90"])("permite decimales explícitos: %s", text => expect(parseUpsellPrice(text)).toBe(10.9));
  it.each(["", "0", "-10900", "1e4", "10.90.0", "10,900,50", "1 09 00", "10.900abc", "NaN", "Infinity", "9007199254740992", null, 10900])("rechaza importes inválidos: %s", text => {
    expect(parseUpsellPrice(text)).toBeNaN();
  });
  it("reproduce el pedido reportado sin dividir el upsell entre mil", () => {
    expect(39999 + parseUpsellPrice("10.900")).toBe(50899);
  });
});
