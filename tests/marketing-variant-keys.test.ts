import { describe, expect, it } from "vitest";
import {
  buildVariantIndex,
  normalVariant,
  variantItemKey,
} from "../lib/marketing-variant-keys";

const FAT =
  "Fat‑Burn Shorts - Shorts para Quemar Grasa – Faja Moldeadora de Compresión y Control Abdomen";
const catalog = [
  {
    shopify_id: "1",
    title: FAT,
    variants: [
      { sku: "FAT.BURN.NEGRO.S", title: "Negro / Talla única" },
      { sku: "FAT.BURN.BEIGE.S", title: "Beige / Talla única" },
    ],
  },
  {
    shopify_id: "2",
    title: "HER LOSS – Colonia con Feromonas para Hombre (50 ml)",
    variants: [{ sku: "HER.LOSS", title: "Default Title" }],
  },
  {
    shopify_id: "3",
    title: "Bividi Camiseta de Alta Compresión",
    variants: [{ sku: "BIVIDI.UNICA", title: "Talla única" }],
  },
];
const index = buildVariantIndex(catalog);

describe("variant keys", () => {
  it("normalizes both iComfly variant formats to the same text", () => {
    expect(normalVariant("Color: Negro · Talla: Talla única")).toBe(
      "negro talla unica",
    );
    expect(normalVariant("Negro / Talla única")).toBe("negro talla unica");
  });

  it("finds the catalog variant SKU from the dataset title in both formats", () => {
    expect(
      variantItemKey(
        {
          sku: "fat.burn.negro.s",
          title: `${FAT} - Color: Beige · Talla: Talla única`,
        },
        index,
      ),
    ).toBe("sku:fat.burn.beige.s");
    expect(
      variantItemKey({ sku: "", title: `${FAT} - Negro / Talla única` }, index),
    ).toBe("sku:fat.burn.negro.s");
    // The last variant text wins (iComfly's variant field is appended last).
    expect(
      variantItemKey(
        {
          title: `${FAT} - Beige / Talla única - Color: Negro · Talla: Talla única`,
        },
        index,
      ),
    ).toBe("sku:fat.burn.negro.s");
    expect(
      variantItemKey(
        { title: "Bividi Camiseta de Alta Compresión - Talla: Talla única" },
        index,
      ),
    ).toBe("sku:bividi.unica");
  });

  it("skips Default Title and falls back to the plain order key", () => {
    expect(index.byTitle.size).toBe(3);
    expect(
      variantItemKey(
        {
          sku: "HER.LOSS",
          title: "HER LOSS – Colonia con Feromonas para Hombre (50 ml)",
        },
        index,
      ),
    ).toBe("sku:her.loss");
    expect(variantItemKey({ title: "Producto nuevo - Rojo" }, index)).toBe(
      "name:producto nuevo - rojo",
    );
    expect(
      variantItemKey({ sku: "X", title: `${FAT} - Rojo / XL` }, index),
    ).toBe("sku:x");
    expect(variantItemKey({ sku: "X", title: "A" }, null)).toBe("sku:x");
  });

  it("drops a title + variant that two SKUs share", () => {
    const twice = buildVariantIndex([
      ...catalog,
      {
        shopify_id: "4",
        title: FAT,
        variants: [{ sku: "OTHER", title: "Negro / Talla única" }],
      },
    ]);
    expect(
      variantItemKey(
        { sku: "fb", title: `${FAT} - Negro / Talla única` },
        twice,
      ),
    ).toBe("sku:fb");
  });
});
