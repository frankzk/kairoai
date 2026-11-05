import { describe, expect, it } from "vitest";
import {
  buildProductInsights,
  insightBlocks,
  type FinanceOrderRowLike,
} from "../lib/marketing-product-insights";
import { buildVariantIndex } from "../lib/marketing-variant-keys";

const FAT = "Fat Burn Shorts";
const index = buildVariantIndex([
  {
    shopify_id: "1",
    title: FAT,
    variants: [
      { sku: "FAT.NEGRO", title: "Negro / Talla única" },
      { sku: "FAT.BEIGE", title: "Beige / Talla única" },
    ],
  },
]);
const now = new Date("2026-11-05T18:00:00Z");
const today = "2026-11-05";
const order = (
  date: string,
  items: Array<{ title: string; quantity: number; sku?: string }>,
  status = "delivered",
) => ({
  created_at: `${date}T15:00:00.000Z`,
  tracking_status: status,
  items: items.map((item) => ({ price: 0, sku: "", ...item })),
});
const row = (patch: Partial<FinanceOrderRowLike>): FinanceOrderRowLike => ({
  guide_number: "",
  created_at: "2026-11-03T15:00:00.000Z",
  shopify_cancelled_at: null,
  icomfly_estado: "Confirmada",
  package_items: [
    { title: `${FAT} - Negro / Talla única`, quantity: 1, price: 0 },
  ],
  ...patch,
});

describe("product insights", () => {
  it("builds 8 blocks of 7 complete days ending yesterday, newest first", () => {
    const blocks = insightBlocks(today);
    expect(blocks).toHaveLength(8);
    expect(blocks[0]).toEqual({ from: "2026-10-29", to: "2026-11-04" });
    expect(blocks[1]).toEqual({ from: "2026-10-22", to: "2026-10-28" });
    expect(blocks[7].from).toBe("2026-09-10");
  });

  it("counts real units per variant and block, excluding annulled and today", () => {
    const result = buildProductInsights({
      orders: [
        order("2026-11-04", [
          { title: `${FAT} - Negro / Talla única`, quantity: 2 },
        ]),
        order("2026-10-29", [
          { title: `${FAT} - Color: Beige · Talla: Talla única`, quantity: 1 },
        ]),
        order("2026-10-28", [
          { title: `${FAT} - Negro / Talla única`, quantity: 3 },
        ]),
        order(
          "2026-11-04",
          [{ title: `${FAT} - Negro / Talla única`, quantity: 9 }],
          "annulled",
        ),
        order("2026-11-05", [
          { title: `${FAT} - Negro / Talla única`, quantity: 9 },
        ]),
        order("2026-09-01", [
          { title: `${FAT} - Negro / Talla única`, quantity: 9 },
        ]),
      ],
      rows: [],
      index,
      today,
      now,
    });
    expect(result.units["sku:fat.negro"]).toEqual([2, 3, 0, 0, 0, 0, 0, 0]);
    expect(result.units["sku:fat.beige"]).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(result.variantUnits7d).toEqual({
      "sku:fat.negro": 2,
      "sku:fat.beige": 1,
    });
    expect(result.variantAware).toBe(true);
  });

  it("counts confirmed orders without guide older than 24 h and Producto Agotado", () => {
    const result = buildProductInsights({
      orders: [],
      rows: [
        row({}),
        row({ created_at: "2026-11-05T06:00:00.000Z" }), // 12 h: too recent
        row({ guide_number: "G1" }),
        row({ icomfly_estado: "Pendiente" }),
        row({ icomfly_estado: "Cancelado" }),
        row({ shopify_cancelled_at: "2026-11-04T00:00:00Z" }),
        row({ icomfly_estado: undefined }),
        row({
          icomfly_estado: "Enviada",
          created_at: "2026-10-31T15:00:00.000Z",
          package_items: [
            { title: `${FAT} - Negro / Talla única`, quantity: 1, price: 0 },
            { title: `${FAT} - Negro / Talla única`, quantity: 1, price: 0 },
            { title: `${FAT} - Beige / Talla única`, quantity: 1, price: 0 },
          ],
        }),
        row({
          icomfly_estado: "Producto Agotado",
          created_at: "2026-11-05T12:00:00.000Z",
        }),
      ],
      index,
      today,
      now,
    });
    expect(result.waiting).toEqual({
      "sku:fat.negro": { confirmedNoGuide: 2, agotado: 1, oldestDays: 5 },
      "sku:fat.beige": { confirmedNoGuide: 1, agotado: 0, oldestDays: 5 },
    });
  });

  it("uses plain order keys without a catalog", () => {
    const result = buildProductInsights({
      orders: [
        order("2026-11-04", [{ title: "A - Rojo", quantity: 1, sku: "A1" }]),
      ],
      rows: [],
      index: null,
      today,
      now,
    });
    expect(result.variantAware).toBe(false);
    expect(Object.keys(result.units)).toEqual(["sku:a1"]);
  });
});
