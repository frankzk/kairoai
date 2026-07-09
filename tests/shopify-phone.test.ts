import { describe, expect, it } from "vitest";
import {
  extractPhoneFromShopifyOrderRaw,
  normalizePhoneValue,
} from "../lib/shopify-phone";

describe("normalizePhoneValue", () => {
  it("acepta solo telefonos de Costa Rica cuando la tienda es CR", () => {
    expect(normalizePhoneValue("50684254181", { countryCode: "CR" })).toBe("+50684254181");
    expect(normalizePhoneValue("84254181", { countryCode: "CR" })).toBe("+50684254181");
    expect(normalizePhoneValue("+503420629", { countryCode: "CR" })).toBeNull();
    expect(normalizePhoneValue("+155818888631", { countryCode: "CR" })).toBeNull();
  });

  it("acepta solo telefonos de Honduras cuando la tienda es HN", () => {
    expect(normalizePhoneValue("50499998888", { countryCode: "HN" })).toBe("+50499998888");
    expect(normalizePhoneValue("99998888", { countryCode: "HN" })).toBe("+50499998888");
    expect(normalizePhoneValue("+50684254181", { countryCode: "HN" })).toBeNull();
  });
});

describe("extractPhoneFromShopifyOrderRaw", () => {
  it("ignora campos invalidos y usa la nota correcta del checkout", () => {
    const order = {
      phone: "+155818888631",
      customer: { phone: "+503420629" },
      note_attributes: [{ name: "Celular con Whatsapp", value: "50661261383" }],
    };

    expect(extractPhoneFromShopifyOrderRaw(order, { countryCode: "CR" })).toBe("+50661261383");
  });
});
