import { describe, expect, it } from "vitest";
import {
  encodeOrderFacts,
  factState,
  orderOrigin,
  orderProductNames,
  productDisplayName,
  type RawOrderFact,
} from "../lib/marketing-order-facts";

const raw = (patch: Partial<RawOrderFact> = {}): RawOrderFact => ({
  created_at: "2026-11-03T15:00:00.000Z",
  status: "Confirmada",
  cancelled_at: null,
  reason: null,
  sales_channel: null,
  labels: [],
  creator: null,
  department: "San José",
  city: "Montes de Oca",
  shopify_number: null,
  items: [{ product_name: "Her Loss – Colonia (50 ml)", quantity: 1 }],
  product_name: null,
  ...patch,
});
const range = {
  from: "2026-11-01",
  to: "2026-11-04",
  loadedFrom: "2026-10-01",
  today: "2026-11-05",
};
const now = new Date("2026-11-05T15:00:00Z");

describe("orderOrigin", () => {
  const base = {
    shopifyNumber: null,
    labels: [] as string[],
    salesChannel: null,
    creator: null,
  };
  it("follows the precedence Shopify → carrito → bot → IA → asesora → formulario", () => {
    expect(
      orderOrigin({
        ...base,
        shopifyNumber: "#MCRC1",
        labels: ["Venta por bot"],
        creator: "Ana",
      }),
    ).toBe("shopify");
    expect(
      orderOrigin({
        ...base,
        labels: ["Carrito abandonado recuperado", "Venta por bot"],
        salesChannel: "whatsapp",
      }),
    ).toBe("carrito");
    expect(orderOrigin({ ...base, labels: ["VENTA POR BOT"] })).toBe("bot");
    expect(orderOrigin({ ...base, salesChannel: "whatsapp" })).toBe("bot");
    expect(
      orderOrigin({
        ...base,
        salesChannel: "whatsapp",
        creator: "Conector IA",
      }),
    ).toBe("bot");
    expect(orderOrigin({ ...base, creator: "Conector IA" })).toBe("ia");
    expect(orderOrigin({ ...base, creator: "María" })).toBe("asesora");
    expect(orderOrigin({ ...base, labels: ["Retomó la compra"] })).toBe(
      "formulario",
    );
    expect(orderOrigin({ ...base, shopifyNumber: "  " })).toBe("formulario");
  });
});

describe("product names", () => {
  it("shortens display names at the first dash or parenthesis", () => {
    expect(productDisplayName("HER LOSS – Colonia con Feromonas (50 ml)")).toBe(
      "HER LOSS",
    );
    expect(productDisplayName("Turkesterone - Cápsulas")).toBe("Turkesterone");
    expect(productDisplayName("Gomitas de Shilajit (60 gomitas)")).toBe(
      "Gomitas de Shilajit",
    );
    expect(productDisplayName("x".repeat(80))).toHaveLength(60);
  });
  it("reads items in line order and falls back to product_name", () => {
    expect(
      orderProductNames(
        [{ product_name: "B" }, { name: "A" }, { product_name: "" }, null],
        "ignored",
      ),
    ).toEqual(["B", "A"]);
    expect(orderProductNames([], "1x Turkesterone, 2x Gomitas, 1x C")).toEqual([
      "Turkesterone",
      "Gomitas",
      "C",
    ]);
    expect(orderProductNames(null, "Her Loss, versión 2")).toEqual([
      "Her Loss, versión 2",
    ]);
  });
});

describe("factState", () => {
  it("today's iComfly status wins over cancelled_at, as in Gestión", () => {
    const at = "2026-10-29T16:00:00Z";
    expect(factState({ status: "Entregado", cancelled_at: at })).toBe(0);
    expect(factState({ status: "Devolucion", cancelled_at: at })).toBe(0);
    expect(factState({ status: "Testeos", cancelled_at: at })).toBe(2);
    expect(factState({ status: "Cancelado", cancelled_at: null })).toBe(1);
    // Still in gestión or without status: cancelled_at decides.
    expect(factState({ status: "Pendiente", cancelled_at: at })).toBe(1);
    expect(factState({ status: null, cancelled_at: at })).toBe(1);
    expect(factState({ status: "Pendiente", cancelled_at: null })).toBe(0);
  });
});

describe("encodeOrderFacts", () => {
  it("encodes state, reason code only, origin, province and principal first", () => {
    const payload = encodeOrderFacts(
      [
        raw({
          items: [
            { product_name: "Turkesterone - Cápsulas (120 Cápsulas)" },
            { product_name: "Gomitas de Shilajit" },
            { product_name: "Turkesterone - Cápsulas (120 Cápsulas)" },
          ],
          labels: [{ id: 284, name: "Venta por bot" }],
          department: "GUANCASTE",
        }),
        raw({
          created_at: "2026-11-02T15:00:00.000Z",
          status: "Cancelado",
          cancelled_at: "2026-11-02T16:00:00Z",
          reason: "cliente tiene 2 devoluciones, llamar al 8888-1234",
          items: [{ product_name: "Gomitas de Shilajit" }],
          creator: "Conector IA",
          department: "Shopify",
          city: null,
        }),
        raw({
          created_at: "2026-11-01T15:00:00.000Z",
          status: "Producto Agotado",
          reason: "algo",
        }),
        raw({
          created_at: "2026-11-01T16:00:00.000Z",
          status: "Pendiente",
          cancelled_at: "2026-11-01T17:00:00Z",
          reason: "",
        }),
      ],
      range,
      now,
    );
    expect(payload.products).toEqual([
      "Turkesterone",
      "Gomitas de Shilajit",
      "Her Loss",
    ]);
    expect(payload.facts).toEqual([
      ["2026-11-01", 2, "", "formulario", "San José", [expect.any(Number)]],
      [
        "2026-11-01",
        1,
        "sin_motivo",
        "formulario",
        "San José",
        [expect.any(Number)],
      ],
      ["2026-11-02", 1, "lista_negra", "ia", "", [expect.any(Number)]],
      [
        "2026-11-03",
        0,
        "",
        "bot",
        "Guanacaste",
        [expect.any(Number), expect.any(Number)],
      ],
    ]);
    const combo = payload.facts[3][5];
    expect(payload.products[combo[0]]).toBe("Turkesterone");
    expect(payload.products[combo[1]]).toBe("Gomitas de Shilajit");
    expect(payload.titles[combo[0]]).toBe(
      "Turkesterone - Cápsulas (120 Cápsulas)",
    );
    // Never the free text, a phone or any identifying field.
    const text = JSON.stringify(payload);
    expect(text).not.toContain("8888");
    expect(text).not.toContain("devoluciones");
    expect(Object.keys(payload).sort()).toEqual(
      [
        "facts",
        "from",
        "generatedAt",
        "loadedFrom",
        "products",
        "titles",
        "to",
        "today",
      ].sort(),
    );
  });

  it("merges variant names of the same product into one dictionary entry", () => {
    const payload = encodeOrderFacts(
      [
        raw({
          items: [
            {
              product_name:
                "Fat‑Burn Shorts - Shorts para Quemar Grasa – Faja Moldeadora",
            },
          ],
        }),
        raw({
          items: [
            {
              product_name:
                "Fat‑Burn Shorts - Shorts para Quemar Grasa – Faja Moldeadora - Beige / Talla única",
            },
          ],
        }),
        raw({
          items: [
            {
              product_name: "Bividi Camiseta de Alta Compresión (Talla única)",
            },
          ],
        }),
        raw({
          items: [
            {
              product_name: "Bividi Camiseta de Alta Compresión - Talla única",
            },
          ],
        }),
      ],
      range,
      now,
    );
    expect(payload.products).toEqual([
      "Fat‑Burn Shorts",
      "Bividi Camiseta de Alta Compresión",
    ]);
  });

  it("uses Costa Rica days (UTC−6) and drops rows outside the loaded range", () => {
    const payload = encodeOrderFacts(
      [
        raw({ created_at: "2026-11-02T05:59:59.000Z" }),
        raw({ created_at: "2026-11-02T06:00:00.000Z" }),
        raw({ created_at: "2026-09-30T15:00:00.000Z" }),
        raw({ created_at: "2026-11-05T15:00:00.000Z" }),
        raw({ created_at: "not a date" }),
      ],
      range,
      now,
    );
    expect(payload.facts.map((fact) => fact[0])).toEqual([
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});
