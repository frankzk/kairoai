import { describe, expect, it } from "vitest";
import {
  buildShopifyMatchIndex,
  extractExternalOrderCodesFromText,
  findShopifyOrderForRow,
  getOrderMatchKeys,
  normalizeMatchKey,
} from "../lib/order-matching";

const orders = [
  {
    id: 1,
    name: "#MCRC10099",
    order_number: 10099,
    note: "",
    note_attributes: [],
  },
  {
    id: 2,
    name: "#MCRC6445",
    order_number: 6445,
    note: "Pedido 1777526392057",
    note_attributes: [],
  },
  {
    id: 3,
    name: "#MCRC11566",
    order_number: 11566,
    note: null,
    note_attributes: [{ name: "bot", value: "order 4120" }],
  },
];

const index = buildShopifyMatchIndex(orders);

describe("normalizeMatchKey", () => {
  it("baja a minusculas, quita # y espacios", () => {
    expect(normalizeMatchKey(" #MCRC 11566 ")).toBe("mcrc11566");
  });
});

describe("extractExternalOrderCodesFromText", () => {
  it("extrae codigos con prefijo pedido/order", () => {
    expect(extractExternalOrderCodesFromText("Pedido 1777526392057")).toEqual([
      "1777526392057",
    ]);
    expect(extractExternalOrderCodesFromText("order #4120 confirmado")).toEqual(["4120"]);
  });

  it("ignora numeros sin prefijo", () => {
    expect(extractExternalOrderCodesFromText("guia 2529494 entregada")).toEqual([]);
  });
});

describe("findShopifyOrderForRow", () => {
  it("matchea por nombre MCRC exacto con o sin #", () => {
    expect(findShopifyOrderForRow({ order_name: "#MCRC10099" }, index)?.id).toBe(1);
    expect(findShopifyOrderForRow({ order_name: "MCRC10099" }, index)?.id).toBe(1);
  });

  it("matchea guias reenviadas -V2 contra el pedido base", () => {
    expect(findShopifyOrderForRow({ order_name: "#MCRC10099-V2" }, index)?.id).toBe(1);
  });

  it("matchea codigos del bot via nota explicita", () => {
    expect(findShopifyOrderForRow({ order_name: "1777526392057" }, index)?.id).toBe(2);
    expect(findShopifyOrderForRow({ order_name: "4120" }, index)?.id).toBe(3);
  });

  it("NO matchea numeros sueltos contra order_number sin alias en nota", () => {
    // 10099 es order_number del pedido 1, pero sin nota "Pedido 10099" un
    // codigo numerico de Boxful no debe cruzar por coincidencia de numero.
    expect(findShopifyOrderForRow({ order_name: "10099" }, index)).toBeUndefined();
  });

  it("no matchea ordenes desconocidas", () => {
    expect(findShopifyOrderForRow({ order_name: "#MCRC99999" }, index)).toBeUndefined();
  });
});

describe("getOrderMatchKeys", () => {
  it("incluye la clave base para reenvios y codigos de nota propios", () => {
    const keys = getOrderMatchKeys({
      order_name: "#MCRC10099-V2",
      shopify_note: "Pedido 555444",
    });
    expect(keys).toContain("mcrc10099-v2");
    expect(keys).toContain("mcrc10099");
    expect(keys).toContain("555444");
  });
});
